"""
activity_monitor.py  (enhanced)
────────────────────────────────
Integrates all sub-monitors and computes the unified cognitive snapshot.

NEW in this version:
  • TimeTracker    → per-app and session active time
  • Enhanced CameraMonitor → blink rate and face expression
  • New score influences:
      - low blink rate  → pre_error_risk
      - furrowed brow   → confusion_risk
"""
from __future__ import annotations

import getpass
import hashlib
import json
import os
import threading
import time
from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.encoders import jsonable_encoder
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from pymongo import ASCENDING, DESCENDING, MongoClient
from pymongo.errors import PyMongoError

from app_monitor      import AppMonitor
from camera_monitor   import CameraMonitor
from classifier       import CognitiveStateClassifier, FeatureVector
from cursor_monitor   import CursorMonitor
from focus_mode_controller import FocusModeController
from keyboard_monitor import KeyboardMonitor
from time_tracker     import TimeTracker
try:
    from onnx_inference import FlowGuardianInference
except Exception:
    FlowGuardianInference = None


# ── Environment ───────────────────────────────────────────────────────────────
BASE_DIR = Path(__file__).resolve().parent
for env_path in (BASE_DIR.parent / "server" / ".env", BASE_DIR / ".env"):
    if env_path.exists():
        load_dotenv(env_path, override=env_path.name == ".env")


def env_flag(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() not in {"0", "false", "no", "off"}


@dataclass(frozen=True, slots=True)
class Settings:
    api_host:                   str
    api_port:                   int
    camera_enabled:             bool
    camera_window_seconds:      float
    handoff_idle_seconds:       int
    snapshot_interval_seconds:  float


settings = Settings(
    api_host                  = os.getenv("COGNITIVE_API_HOST",   "127.0.0.1"),
    api_port                  = int(os.getenv("COGNITIVE_API_PORT",    "8050")),
    camera_enabled            = env_flag("COGNITIVE_CAMERA_ENABLED",    True),
    camera_window_seconds     = float(os.getenv("COGNITIVE_CAMERA_WINDOW_SECONDS",    "60")),
    handoff_idle_seconds      = int(os.getenv("COGNITIVE_HANDOFF_IDLE_SECONDS",      "300")),
    snapshot_interval_seconds = float(os.getenv("COGNITIVE_SNAPSHOT_INTERVAL_SECONDS", "0.35")),
)

USER_ID   = os.getenv("COGNITIVE_USER_ID", getpass.getuser())
MONGO_URI = os.getenv("MONGO_URI", "")
DB_NAME   = os.getenv("COGNITIVE_DB_NAME", "codecraftors_3_0")

COMM_APPS = ("slack", "teams", "outlook", "gmail", "discord", "telegram", "whatsapp")
AI_APPS   = ("chatgpt", "claude", "copilot", "gemini", "perplexity")
CAL_APPS  = ("calendar", "meet", "zoom")

WINDOW_SECONDS   = 30.0
IDLE_GAP_SECONDS =  2.0
ML_INFERENCE_INTERVAL_SECONDS = WINDOW_SECONDS
ML_RESULT_STALE_SECONDS = WINDOW_SECONDS * 2.5


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def clamp(value: float, minimum: float = 0.0, maximum: float = 1.0) -> float:
    return max(minimum, min(maximum, value))


# ── API models ────────────────────────────────────────────────────────────────
class CapsuleNoteRequest(BaseModel):
    note: str = Field(min_length=1, max_length=120)


# ── MongoDB store (unchanged from original, keep all collections) ─────────────
class MongoStore:
    BUCKETS = (
        "snapshots", "events", "features_raw", "state_changes", "z_scores",
        "capsules", "interruptions", "artifacts", "twins",
        "attention_residue_events", "pre_error_events", "fatigue_events",
        "confusion_episodes", "handoff_capsules", "baselines",
        "sessions", "entities", "relations", "activity_stream",
        "context_chunks", "focus_events",
    )

    def __init__(self) -> None:
        self.enabled       = False
        self.error_message: str | None = None
        self.memory: dict[str, deque] = {b: deque(maxlen=500) for b in self.BUCKETS}

        try:
            self.client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=4_000) if MONGO_URI else None
            if self.client is None:
                raise RuntimeError("Missing MONGO_URI — running in memory-only mode.")
            self.client.admin.command("ping")
            default_db = self.client.get_default_database()
            db = default_db if default_db is not None else self.client[DB_NAME]
            for bucket in self.BUCKETS:
                setattr(self, bucket, db[f"cognitive_{bucket}"])
            self.snapshots.create_index([("user_id", DESCENDING), ("generated_at", DESCENDING)])
            self.snapshots.create_index([("state_label", ASCENDING)])
            self.state_changes.create_index([("user_id", DESCENDING), ("changed_at", DESCENDING)])
            self.attention_residue_events.create_index([("user_id", DESCENDING), ("created_at", DESCENDING)])
            self.pre_error_events.create_index([("user_id", DESCENDING), ("created_at", DESCENDING)])
            self.fatigue_events.create_index([("user_id", DESCENDING), ("created_at", DESCENDING)])
            self.artifacts.create_index([("user_id", DESCENDING), ("artifact_id", ASCENDING)])
            self.confusion_episodes.create_index([("user_id", DESCENDING), ("started_at", DESCENDING)])
            self.baselines.create_index([("user_id", ASCENDING)], unique=True)
            self.sessions.create_index([("session_id", ASCENDING)], unique=True)
            self.sessions.create_index([("user_id", DESCENDING), ("started_at", DESCENDING)])
            self.entities.create_index([("entity_id", ASCENDING)], unique=True)
            self.entities.create_index([("entity_type", ASCENDING), ("label", ASCENDING)])
            self.relations.create_index(
                [("from_id", ASCENDING), ("relation_type", ASCENDING), ("to_id", ASCENDING)],
                unique=True,
            )
            self.activity_stream.create_index([("session_id", ASCENDING), ("created_at", DESCENDING)])
            self.activity_stream.create_index([("user_id", DESCENDING), ("state_label", ASCENDING)])
            self.context_chunks.create_index([("session_id", ASCENDING), ("created_at", DESCENDING)])
            self.focus_events.create_index([("session_id", ASCENDING), ("created_at", DESCENDING)])
            self.enabled = True
        except Exception as exc:
            self.error_message = str(exc)

    def insert(self, bucket: str, document: dict[str, Any]) -> None:
        self.memory[bucket].append(document)
        if not self.enabled:
            return
        try:
            col = getattr(self, bucket, None)
            if col is not None:
                col.insert_one(document)
        except PyMongoError:
            pass

    def recent(self, bucket: str, limit: int = 20) -> list[dict[str, Any]]:
        items = list(self.memory[bucket])[-limit:]
        return [self._serialize(item) for item in items]

    def save_baseline(self, user_id: str, payload: dict[str, Any], now: datetime) -> None:
        document = {
            "user_id": user_id,
            "updated_at": now,
            "payload": payload,
        }
        self.memory["baselines"].append(document)
        if not self.enabled:
            return
        try:
            self.baselines.update_one(
                {"user_id": user_id},
                {"$set": document},
                upsert=True,
            )
        except PyMongoError:
            pass

    def load_baseline(self, user_id: str) -> dict[str, Any] | None:
        for item in reversed(self.memory["baselines"]):
            if item.get("user_id") == user_id:
                payload = item.get("payload")
                return payload if isinstance(payload, dict) else None
        if not self.enabled:
            return None
        try:
            doc = self.baselines.find_one({"user_id": user_id}, sort=[("updated_at", DESCENDING)])
        except PyMongoError:
            return None
        if not isinstance(doc, dict):
            return None
        payload = doc.get("payload")
        return payload if isinstance(payload, dict) else None

    def upsert_entity(
        self,
        entity_type: str,
        entity_id: str,
        label: str,
        properties: dict[str, Any],
        now: datetime,
    ) -> None:
        document = {
            "entity_id": entity_id,
            "entity_type": entity_type,
            "label": label,
            "updated_at": now,
            **properties,
        }
        self.memory["entities"].append(document)
        if not self.enabled:
            return
        try:
            self.entities.update_one(
                {"entity_id": entity_id},
                {
                    "$set": document,
                    "$setOnInsert": {"created_at": now},
                },
                upsert=True,
            )
        except PyMongoError:
            pass

    def upsert_relation(
        self,
        *,
        relation_type: str,
        from_id: str,
        from_type: str,
        to_id: str,
        to_type: str,
        now: datetime,
        attributes: dict[str, Any] | None = None,
    ) -> None:
        attributes = attributes or {}
        document = {
            "relation_type": relation_type,
            "from_id": from_id,
            "from_type": from_type,
            "to_id": to_id,
            "to_type": to_type,
            "updated_at": now,
            "attributes": attributes,
        }
        self.memory["relations"].append(document)
        if not self.enabled:
            return
        try:
            self.relations.update_one(
                {
                    "from_id": from_id,
                    "relation_type": relation_type,
                    "to_id": to_id,
                },
                {
                    "$set": document,
                    "$setOnInsert": {"created_at": now},
                    "$inc": {"seen_count": 1},
                },
                upsert=True,
            )
        except PyMongoError:
            pass

    def upsert_session(self, session_id: str, document: dict[str, Any], now: datetime) -> None:
        payload = {"session_id": session_id, **document}
        self.memory["sessions"].append(payload)
        if not self.enabled:
            return
        try:
            self.sessions.update_one(
                {"session_id": session_id},
                {
                    "$set": payload,
                    "$setOnInsert": {"created_at": now},
                },
                upsert=True,
            )
        except PyMongoError:
            pass

    def append_capsule_note(self, user_id: str, note: str) -> bool:
        for capsule in reversed(self.memory["capsules"]):
            if capsule.get("user_id") == user_id:
                capsule["blocker_note"] = note
                if self.enabled:
                    try:
                        self.capsules.update_one(
                            {"_id": capsule.get("_id")},
                            {"$set": {"blocker_note": note}},
                        )
                    except PyMongoError:
                        pass
                return True
        return False

    def team_rollup(self) -> dict[str, int | float]:
        latest_by_user: dict[str, dict[str, Any]] = {}
        for snap in self.recent("snapshots", 120):
            uid = str(snap.get("user_id", "")).strip()
            if uid:
                latest_by_user[uid] = snap
        members = list(latest_by_user.values())
        if not members:
            return {"team_focus_health": 0, "members_in_deep_work": 0,
                    "members_high_confusion": 0, "member_count": 0}
        focus_vals     = [float(m.get("scores", {}).get("focus_depth",    0.0)) for m in members if isinstance(m.get("scores"), dict)]
        confusion_vals = [float(m.get("scores", {}).get("confusion_risk", 0.0)) for m in members if isinstance(m.get("scores"), dict)]
        return {
            "team_focus_health":      int(round((sum(focus_vals) / max(len(focus_vals), 1)) * 100)),
            "members_in_deep_work":   sum(1 for m in members if m.get("state_label") == "deep_focus"),
            "members_high_confusion": sum(1 for v in confusion_vals if v >= 0.62),
            "member_count":           len(members),
        }

    @staticmethod
    def _serialize(doc: dict[str, Any]) -> dict[str, Any]:
        out: dict[str, Any] = {}
        for k, v in doc.items():
            if k == "_id":
                continue
            if isinstance(v, datetime):
                out[k] = v.isoformat()
            elif isinstance(v, dict):
                out[k] = MongoStore._serialize(v)
            elif isinstance(v, list):
                out[k] = [MongoStore._serialize(i) if isinstance(i, dict) else i for i in v]
            else:
                out[k] = v
        return out


# ── Main activity monitor ─────────────────────────────────────────────────────
class ActivityMonitor:
    def __init__(self) -> None:
        self.user_id      = USER_ID
        self.store        = MongoStore()
        self._baseline_cache_path = (
            BASE_DIR / ".baseline-cache" / f"{hashlib.sha1(self.user_id.encode()).hexdigest()[:16]}.json"
        )

        self._events       : deque = deque(maxlen=60)
        self._events_lock   = threading.Lock()
        self._snapshot_lock = threading.Lock()

        self._last_snapshot_at   = 0.0
        self._cached_payload: dict[str, Any] | None = None

        # Artifact tracking
        self._artifact_stats: dict[str, dict[str, float | int]] = defaultdict(
            lambda: {"visits": 0, "revisits": 0, "friction_score": 0.0,
                     "first_seen": utcnow().isoformat()}
        )
        self._last_artifact_id: str | None = None
        self._artifact_entered_at_ts = time.time()
        self._app_switch_timestamps: deque[float] = deque(maxlen=240)

        # Session timing
        self._session_started_at = utcnow()
        self.session_id          = hashlib.sha1(
            f"{self.user_id}::{self._session_started_at.isoformat()}".encode()
        ).hexdigest()[:16]
        self._last_break_at      = utcnow()
        self._debt               = 0.05

        # Interruption queue
        self._pending_interruptions: list[dict[str, Any]] = []

        # State tracking
        self._last_state:        str | None = None
        self._last_state_label:  str | None = None
        self._last_cursor_state: str | None = None

        # Confusion episode tracking
        self._confusion_episode_start:  datetime | None = None
        self._confusion_episode_id:     str | None = None
        self._last_baseline_persist_at: float = 0.0
        self._last_focus_context: dict[str, Any] | None = None

        # --- ML Integration ---
        if FlowGuardianInference is None:
            print("Warning: ONNX Engine unavailable (missing optional ML dependencies).")
            self.inference_engine = None
        else:
            try:
                self.inference_engine = FlowGuardianInference()
            except Exception as e:
                print(f"Warning: ONNX Engine failed to load ({e}).")
                self.inference_engine = None
            
        self.last_inference_time = 0.0
        self.latest_ml_state = None
        self.last_ml_result_time = 0.0
        self.latest_ml_features: dict[str, float] | None = None

        # ── Sub-monitors ──────────────────────────────────────────────────
        self.cursor_monitor   = CursorMonitor(window_seconds=WINDOW_SECONDS, event_callback=self.record_event)
        self.keyboard_monitor = KeyboardMonitor(window_seconds=WINDOW_SECONDS, event_callback=self.record_event)
        self.camera_monitor   = CameraMonitor(window_seconds=settings.camera_window_seconds, event_callback=self.record_event)
        self.app_monitor      = AppMonitor(poll_interval=2.0,              event_callback=self.record_event)
        self.time_tracker     = TimeTracker()
        self.focus_mode       = FocusModeController(event_callback=self.record_event)
        self.classifier       = CognitiveStateClassifier(calibration_seconds=90.0, minimum_samples=20)
        self._restore_classifier_baseline()

    # ── Lifecycle ─────────────────────────────────────────────────────────────
    def start(self) -> None:
        self.cursor_monitor.start()
        self.keyboard_monitor.start()
        if settings.camera_enabled:
            self.camera_monitor.start()
        else:
            self.record_event("Camera monitor disabled by configuration.", persist=False)
        self.app_monitor.start()
        self.record_event("Flow Guardian activity monitor started.")

    def stop(self) -> None:
        self._persist_classifier_baseline(force=True)
        self.focus_mode.restore()
        self.cursor_monitor.stop()
        self.keyboard_monitor.stop()
        if settings.camera_enabled:
            self.camera_monitor.stop()
        self.app_monitor.stop()

    def _restore_classifier_baseline(self) -> None:
        payload = self.store.load_baseline(self.user_id)
        source = "mongo"
        if payload is None:
            payload = self._load_baseline_from_disk()
            source = "disk"
        restored = self.classifier.load_baseline(payload, now=time.time())
        if restored:
            message = (
                f"Loaded saved cognitive baseline from {source}; calibration skipped."
                if self.classifier.is_baseline_ready()
                else f"Loaded partial baseline from {source}; calibration resumed."
            )
            self.record_event(message, persist=False)

    def _persist_classifier_baseline(self, *, force: bool = False) -> None:
        if not self.classifier.is_baseline_ready():
            return
        now_ts = time.time()
        if not force and now_ts - self._last_baseline_persist_at < 15.0:
            return
        payload = self.classifier.export_baseline()
        now = utcnow()
        self.store.save_baseline(self.user_id, payload, now)
        if not self.store.enabled:
            self._write_baseline_to_disk(payload)
        self._last_baseline_persist_at = now_ts

    def _load_baseline_from_disk(self) -> dict[str, Any] | None:
        try:
            if not self._baseline_cache_path.exists():
                return None
            with self._baseline_cache_path.open("r", encoding="utf-8") as handle:
                payload = json.load(handle)
            return payload if isinstance(payload, dict) else None
        except (OSError, json.JSONDecodeError):
            return None

    def _write_baseline_to_disk(self, payload: dict[str, Any]) -> None:
        try:
            self._baseline_cache_path.parent.mkdir(parents=True, exist_ok=True)
            with self._baseline_cache_path.open("w", encoding="utf-8") as handle:
                json.dump(payload, handle, indent=2)
        except OSError:
            pass

    def _graph_id(self, kind: str, *parts: Any) -> str:
        normalized = "||".join(str(part).strip().lower() for part in parts if str(part).strip())
        digest = hashlib.sha1(f"{kind}::{normalized or 'unknown'}".encode()).hexdigest()[:16]
        return f"{kind}:{digest}"

    def _build_context_chunk(
        self,
        *,
        active_app: str,
        active_window: str,
        state_label: str,
        classification,
        scores_payload: dict[str, Any],
        keyboard: dict[str, Any],
        cursor: dict[str, Any],
        camera: dict[str, Any],
        open_app_refs: list[dict[str, Any]],
    ) -> str:
        open_apps_text = ", ".join(item["name"] for item in open_app_refs[:5]) or "none"
        return (
            f"User {self.user_id} in session {self.session_id} worked in '{active_app}' "
            f"on '{active_window[:180]}'. State label '{state_label}', classifier "
            f"'{classification.state}' with confidence {classification.confidence:.2f}. "
            f"Focus depth {float(scores_payload.get('focus_depth', 0.0)):.2f}, confusion risk "
            f"{float(scores_payload.get('confusion_risk', 0.0)):.2f}, fatigue risk "
            f"{float(scores_payload.get('fatigue_risk', 0.0)):.2f}, attention residue "
            f"{float(scores_payload.get('attention_residue', 0.0)):.2f}. Typing "
            f"{float(keyboard.get('keys_per_minute', 0.0)):.1f} keys/min with error rate "
            f"{float(keyboard.get('error_rate', 0.0)):.2f}. Cursor speed "
            f"{float(cursor.get('cursor_speed', 0.0)):.1f}, path linearity "
            f"{float(cursor.get('path_linearity', 0.0)):.2f}. Camera expression "
            f"'{camera.get('expression', 'neutral')}' and perclos {float(camera.get('perclos') or 0.0):.2f}. "
            f"Visible apps: {open_apps_text}."
        )

    def _store_session_graph(
        self,
        *,
        now: datetime,
        snapshot: dict[str, Any],
        system: dict[str, Any],
        keyboard: dict[str, Any],
        cursor: dict[str, Any],
        camera: dict[str, Any],
        classification,
        scores_payload: dict[str, Any],
        artifact_id: str,
        active_app: str,
        active_window: str,
        state_label: str,
    ) -> None:
        active_pid = int(system.get("active_pid") or 0)
        active_exe = str(system.get("active_exe", "") or "")
        user_node_id = self._graph_id("user", self.user_id)
        session_node_id = self._graph_id("session", self.user_id, self.session_id)
        app_node_id = self._graph_id("app", active_exe or active_app)
        window_node_id = self._graph_id("window", active_app, active_window, active_pid)
        artifact_node_id = self._graph_id("artifact", artifact_id)
        state_node_id = self._graph_id("state", state_label)
        classifier_node_id = self._graph_id("classifier_state", classification.state)
        cursor_state = str(cursor.get("state", "steady"))
        cursor_state_node_id = self._graph_id("cursor_state", cursor_state)
        expression = str(camera.get("expression", "neutral"))
        expression_node_id = self._graph_id("expression", expression)
        snapshot_node_id = self._graph_id("snapshot", self.session_id, snapshot.get("generated_at", ""), artifact_id)

        self.store.upsert_entity("user", user_node_id, self.user_id, {"user_id": self.user_id}, now)
        self.store.upsert_entity(
            "session",
            session_node_id,
            f"Session {self.session_id}",
            {
                "session_id": self.session_id,
                "user_id": self.user_id,
                "started_at": self._session_started_at,
                "last_seen_at": now,
                "current_state_label": state_label,
                "active_app": active_app,
                "active_window": active_window,
            },
            now,
        )
        self.store.upsert_entity(
            "app",
            app_node_id,
            active_app,
            {"app_name": active_app, "exe": active_exe, "pid": active_pid},
            now,
        )
        self.store.upsert_entity(
            "window",
            window_node_id,
            active_window[:180],
            {
                "app_name": active_app,
                "window_title": active_window,
                "pid": active_pid,
                "exe": active_exe,
            },
            now,
        )
        self.store.upsert_entity(
            "artifact",
            artifact_node_id,
            f"{active_app} :: {active_window[:80]}",
            {
                "artifact_id": artifact_id,
                "app_name": active_app,
                "window_title": active_window,
                "friction_score": snapshot.get("artifact", {}).get("friction_score", 0.0),
            },
            now,
        )
        self.store.upsert_entity("state", state_node_id, state_label, {"state_label": state_label}, now)
        self.store.upsert_entity(
            "classifier_state",
            classifier_node_id,
            classification.state,
            {"classifier_state": classification.state},
            now,
        )
        self.store.upsert_entity(
            "cursor_state",
            cursor_state_node_id,
            cursor_state,
            {"cursor_state": cursor_state},
            now,
        )
        self.store.upsert_entity(
            "expression",
            expression_node_id,
            expression,
            {"expression": expression},
            now,
        )
        self.store.upsert_entity(
            "snapshot",
            snapshot_node_id,
            str(snapshot.get("generated_at", "")),
            {
                "session_id": self.session_id,
                "user_id": self.user_id,
                "artifact_id": artifact_id,
                "state_label": state_label,
                "classifier_state": classification.state,
                "generated_at": now,
            },
            now,
        )

        relations = [
            ("HAS_SESSION", user_node_id, "user", session_node_id, "session", {"current": True}),
            ("GENERATED", session_node_id, "session", snapshot_node_id, "snapshot", {"state_label": state_label}),
            ("USED_APP", session_node_id, "session", app_node_id, "app", {"active": True, "pid": active_pid}),
            ("FOCUSED_WINDOW", session_node_id, "session", window_node_id, "window", {"active": True}),
            ("HOSTS_WINDOW", app_node_id, "app", window_node_id, "window", {"pid": active_pid}),
            ("REPRESENTS_ARTIFACT", window_node_id, "window", artifact_node_id, "artifact", {"artifact_id": artifact_id}),
            ("OBSERVED_STATE", snapshot_node_id, "snapshot", state_node_id, "state", {"confidence": classification.confidence}),
            ("CLASSIFIED_AS", snapshot_node_id, "snapshot", classifier_node_id, "classifier_state", {"confidence": classification.confidence}),
            ("CURSOR_BEHAVIOR", snapshot_node_id, "snapshot", cursor_state_node_id, "cursor_state", {"cursor_entropy": cursor.get("cursor_entropy", 0.0)}),
            ("FACE_EXPRESSION", snapshot_node_id, "snapshot", expression_node_id, "expression", {"perclos": camera.get("perclos"), "blink_rate": camera.get("blink_rate_per_min", 0.0)}),
        ]
        for relation_type, from_id, from_type, to_id, to_type, attributes in relations:
            self.store.upsert_relation(
                relation_type=relation_type,
                from_id=from_id,
                from_type=from_type,
                to_id=to_id,
                to_type=to_type,
                now=now,
                attributes=attributes,
            )

        open_app_refs: list[dict[str, Any]] = []
        open_apps = system.get("open_apps", [])
        if isinstance(open_apps, list):
            for item in open_apps[:8]:
                if not isinstance(item, dict):
                    continue
                open_name = str(item.get("name", "Unknown") or "Unknown")
                open_title = str(item.get("title", "Unknown") or "Unknown")
                open_pid = int(item.get("pid") or 0)
                open_exe = str(item.get("exe", "") or "")
                open_app_id = self._graph_id("app", open_exe or open_name)
                open_window_id = self._graph_id("window", open_name, open_title, open_pid)
                self.store.upsert_entity(
                    "app",
                    open_app_id,
                    open_name,
                    {"app_name": open_name, "exe": open_exe, "pid": open_pid},
                    now,
                )
                self.store.upsert_entity(
                    "window",
                    open_window_id,
                    open_title[:180],
                    {"app_name": open_name, "window_title": open_title, "pid": open_pid, "exe": open_exe},
                    now,
                )
                self.store.upsert_relation(
                    relation_type="HAS_OPEN_APP",
                    from_id=session_node_id,
                    from_type="session",
                    to_id=open_app_id,
                    to_type="app",
                    now=now,
                    attributes={"visible": True},
                )
                self.store.upsert_relation(
                    relation_type="HAS_VISIBLE_WINDOW",
                    from_id=open_app_id,
                    from_type="app",
                    to_id=open_window_id,
                    to_type="window",
                    now=now,
                    attributes={"pid": open_pid},
                )
                open_app_refs.append(
                    {
                        "app_id": open_app_id,
                        "window_id": open_window_id,
                        "name": open_name,
                        "title": open_title,
                        "pid": open_pid,
                    }
                )

        self.store.upsert_session(
            self.session_id,
            {
                "user_id": self.user_id,
                "started_at": self._session_started_at,
                "last_seen_at": now,
                "state_label": state_label,
                "active_app": active_app,
                "active_window": active_window,
                "artifact_id": artifact_id,
            },
            now,
        )
        self.store.insert(
            "activity_stream",
            {
                "user_id": self.user_id,
                "session_id": self.session_id,
                "created_at": now,
                "snapshot_id": snapshot_node_id,
                "entity_refs": {
                    "user": user_node_id,
                    "session": session_node_id,
                    "app": app_node_id,
                    "window": window_node_id,
                    "artifact": artifact_node_id,
                    "state": state_node_id,
                    "classifier_state": classifier_node_id,
                    "cursor_state": cursor_state_node_id,
                    "expression": expression_node_id,
                },
                "open_app_refs": open_app_refs,
                "metrics": {
                    "scores": scores_payload,
                    "keyboard": {
                        "wpm": keyboard.get("wpm", 0.0),
                        "keys_per_minute": keyboard.get("keys_per_minute", 0.0),
                        "error_rate": keyboard.get("error_rate", 0.0),
                        "total_keys": keyboard.get("total_keys", 0),
                        "burst_length": keyboard.get("burst_length", 0.0),
                        "backspace_count": keyboard.get("backspace_count", 0),
                        "delete_count": keyboard.get("delete_count", 0),
                        "modifier_count": keyboard.get("modifier_count", 0),
                        "iki_mean": keyboard.get("iki_mean", 0.0),
                        "iki_std": keyboard.get("iki_std", 0.0),
                    },
                    "mouse": {
                        "cursor_speed": cursor.get("cursor_speed", 0.0),
                        "path_linearity": cursor.get("path_linearity", 0.0),
                        "click_count": cursor.get("click_count", 0),
                        "scroll_count": cursor.get("scroll_count", 0),
                        "click_dwell": cursor.get("click_dwell", 0.0),
                        "total_distance": cursor.get("total_distance", 0.0),
                        "cursor_entropy": cursor.get("cursor_entropy", 0.0),
                    },
                    "camera": {
                        "perclos": camera.get("perclos"),
                        "blink_rate_per_min": camera.get("blink_rate_per_min", 0.0),
                        "expression": expression,
                        "status": camera.get("status", "unknown"),
                    },
                },
            },
        )
        self.store.insert(
            "context_chunks",
            {
                "user_id": self.user_id,
                "session_id": self.session_id,
                "created_at": now,
                "snapshot_id": snapshot_node_id,
                "state_label": state_label,
                "entity_refs": {
                    "user": user_node_id,
                    "session": session_node_id,
                    "app": app_node_id,
                    "window": window_node_id,
                    "artifact": artifact_node_id,
                },
                "chunk_text": self._build_context_chunk(
                    active_app=active_app,
                    active_window=active_window,
                    state_label=state_label,
                    classification=classification,
                    scores_payload=scores_payload,
                    keyboard=keyboard,
                    cursor=cursor,
                    camera=camera,
                    open_app_refs=open_app_refs,
                ),
            },
        )

        focus_context = {
            "artifact_id": artifact_id,
            "active_app": active_app,
            "active_window": active_window,
            "app_id": app_node_id,
            "window_id": window_node_id,
        }
        if self._last_focus_context and self._last_focus_context["artifact_id"] != artifact_id:
            self.store.insert(
                "focus_events",
                {
                    "user_id": self.user_id,
                    "session_id": self.session_id,
                    "created_at": now,
                    "from_context": self._last_focus_context,
                    "to_context": focus_context,
                    "state_label": state_label,
                    "classifier_state": classification.state,
                },
            )
        self._last_focus_context = focus_context

    # ── Core snapshot ─────────────────────────────────────────────────────────
    def _prune_switch_history(self, now_ts: float) -> None:
        cutoff = now_ts - WINDOW_SECONDS
        while self._app_switch_timestamps and self._app_switch_timestamps[0] < cutoff:
            self._app_switch_timestamps.popleft()

    def _active_ml_state(self, now_ts: float) -> dict[str, Any] | None:
        if not isinstance(self.latest_ml_state, dict):
            return None
        if now_ts - self.last_ml_result_time > ML_RESULT_STALE_SECONDS:
            return None
        return self.latest_ml_state

    def _build_ml_features(
        self,
        *,
        keyboard: dict[str, Any],
        cursor: dict[str, Any],
        camera: dict[str, Any],
        idle_ratio: float,
        app_switches: int,
        dwell_seconds: float,
    ) -> dict[str, float]:
        perclos = camera.get("perclos")
        ear_mean = camera.get("ear_mean", camera.get("eye_aspect_ratio"))
        return {
            "iki_mean_ms": float(keyboard.get("iki_mean", 0.0)) * 1000.0,
            "iki_std_ms": float(keyboard.get("iki_std", 0.0)) * 1000.0,
            "hold_mean_ms": float(keyboard.get("hold_mean_ms", 0.0)),
            "backspace_ratio": float(keyboard.get("backspace_ratio", 0.0)),
            "burst_length": float(keyboard.get("burst_length", 0.0)),
            "wpm": float(keyboard.get("wpm", 0.0)),
            "pause_freq_per_min": float(keyboard.get("pause_freq_per_min", 0.0)),
            "mouse_speed_px_s": float(cursor.get("cursor_speed", 0.0)),
            "path_linearity": float(cursor.get("path_linearity", 0.0)),
            "click_dwell_ms": float(cursor.get("click_dwell", 0.0)) * 1000.0,
            "direction_changes": float(cursor.get("direction_changes", 0.0)),
            "idle_ratio": float(idle_ratio),
            "scroll_reversals": float(cursor.get("scroll_reversals", 0.0)),
            "perclos": float(perclos) if isinstance(perclos, (int, float)) else 0.0,
            "blink_rate_per_min": float(camera.get("blink_rate_per_min", 0.0)),
            "ear_mean": float(ear_mean) if isinstance(ear_mean, (int, float)) else 0.0,
            "app_switches": float(app_switches),
            "dwell_seconds": float(max(dwell_seconds, 0.0)),
        }

    def _run_ml_inference(self, *, now_ts: float, ml_features: dict[str, float]) -> None:
        if not self.inference_engine:
            return
        if now_ts - self.last_inference_time < ML_INFERENCE_INTERVAL_SECONDS:
            return

        self.last_inference_time = now_ts
        self.latest_ml_features = ml_features
        try:
            ml_result = self.inference_engine.infer(ml_features)
        except Exception as exc:
            print(f"ML Inference Error: {exc}")
            return

        if not ml_result:
            print(f"[ONNX] Warming up — collecting context windows ({len(self.inference_engine.history)}/{self.inference_engine.seq_len})")
            return

        previous_state = (
            str(self.latest_ml_state.get("cognitive_state", ""))
            if isinstance(self.latest_ml_state, dict)
            else ""
        )
        self.latest_ml_state = ml_result
        self.last_ml_result_time = now_ts
        current_state = str(ml_result.get("cognitive_state", ""))

        # ── Real-time ONNX output (visible in terminal) ───────────────────
        print(
            f"[ONNX] {time.strftime('%H:%M:%S')} "
            f"state={current_state:<10} "
            f"attention_residue={ml_result.get('attention_residue', 0.0):.3f}  "
            f"pre_error_prob={ml_result.get('pre_error_prob', 0.0):.3f}  "
            f"interruptibility={ml_result.get('interruptibility', 0.0):.3f}  "
            f"confusion_friction={ml_result.get('confusion_friction', 0.0):.3f}  "
            f"struggle={ml_result.get('struggle_type', 'n/a')}"
        )

        if current_state and current_state != previous_state:
            self.record_event(f"ML State inferred: {current_state.capitalize()}")

    def snapshot(self) -> dict[str, Any]:
        with self._snapshot_lock:
            now_ts = time.time()
            if (self._cached_payload is not None
                    and now_ts - self._last_snapshot_at < settings.snapshot_interval_seconds):
                return self._cached_payload

            # ── Raw sub-system snapshots ──────────────────────────────────
            cursor   = self.cursor_monitor.snapshot()
            keyboard = self.keyboard_monitor.snapshot()
            camera   = (self.camera_monitor.snapshot()
                        if settings.camera_enabled
                        else _camera_disabled_snapshot())
            system   = self.app_monitor.snapshot()

            # ── Active time tracking ──────────────────────────────────────
            active_app    = str(system.get("active_app",    "Unknown"))
            active_window = str(system.get("active_window", "Unknown"))
            self.time_tracker.tick(active_app, active_window)
            time_data = self.time_tracker.snapshot()

            # ── Derived cursor signals ────────────────────────────────────
            cursor_state     = _cursor_state(cursor)
            cursor_entropy   = _cursor_entropy(cursor)
            scroll_reversals = _scroll_reversal_proxy(cursor)
            cursor["state"]            = cursor_state
            cursor["cursor_entropy"]   = cursor_entropy
            cursor["scroll_reversals"] = scroll_reversals

            # ── Derived keyboard signals ──────────────────────────────────
            typing_speed_variance = _typing_speed_variance(keyboard)
            iki_entropy           = _iki_entropy(keyboard)
            frustration           = _frustration_index(keyboard, iki_entropy)
            negative_hits, uncertainty_hits = _emotion_hits(keyboard, frustration)

            keyboard.setdefault("paste_count", 0)
            keyboard.setdefault("search_shortcut_count", 0)
            keyboard["typing_speed_variance"] = typing_speed_variance
            keyboard["iki_entropy"]           = iki_entropy
            keyboard["emotional_load"] = {
                "frustration_index": frustration,
                "negative_hits":     negative_hits,
                "uncertainty_hits":  uncertainty_hits,
            }

            # ── Idle ratio ────────────────────────────────────────────────
            activity_timestamps = sorted(
                list(cursor.get("activity_timestamps", []))
                + list(keyboard.get("activity_timestamps", []))
            )
            idle_ratio = _compute_idle_ratio(now_ts, activity_timestamps, WINDOW_SECONDS)

            artifact_id = hashlib.sha1(f"{active_app}::{active_window}".encode()).hexdigest()[:16]
            switched = artifact_id != self._last_artifact_id
            stats = self._artifact_stats[artifact_id]
            self._prune_switch_history(now_ts)
            preview_switches = list(self._app_switch_timestamps)
            if switched:
                preview_switches.append(now_ts)
            app_switches_window = len([ts for ts in preview_switches if ts >= now_ts - WINDOW_SECONDS])
            dwell_seconds_window = 0.0 if switched else max(now_ts - self._artifact_entered_at_ts, 0.0)
            ml_features = self._build_ml_features(
                keyboard=keyboard,
                cursor=cursor,
                camera=camera,
                idle_ratio=idle_ratio,
                app_switches=app_switches_window,
                dwell_seconds=dwell_seconds_window,
            )
            self._run_ml_inference(now_ts=now_ts, ml_features=ml_features)
            ml_state = self._active_ml_state(now_ts)

            # ── Feature vector ────────────────────────────────────────────
            perclos = camera.get("perclos")
            features = FeatureVector(
                iki_mean       = float(keyboard.get("iki_mean",       0.0)),
                iki_std        = float(keyboard.get("iki_std",        0.0)),
                error_rate     = float(keyboard.get("error_rate",     0.0)),
                burst_length   = float(keyboard.get("burst_length",   0.0)),
                cursor_speed   = float(cursor.get("cursor_speed",     0.0)),
                path_linearity = float(cursor.get("path_linearity",   0.0)),
                click_dwell    = float(cursor.get("click_dwell",      0.0)),
                idle_ratio     = idle_ratio,
                perclos        = float(perclos) if isinstance(perclos, (int, float)) else None,
            )

            # ── Classify ──────────────────────────────────────────────────
            classification = self.classifier.classify(features, now=now_ts)
            now = utcnow()

            if classification.state != self._last_state:
                self._on_state_change(classification.state, self._last_state, now)
                self._last_state = classification.state
            if cursor_state != self._last_cursor_state:
                self.record_event(f"Cursor state: {cursor_state.replace('_', ' ')}", persist=False)
                self._last_cursor_state = cursor_state

            # ── Session / break timing ────────────────────────────────────
            idle_candidates = [
                v for v in (cursor.get("seconds_since_last_input"),
                            keyboard.get("seconds_since_last_key"))
                if isinstance(v, (int, float))
            ]
            idle_seconds = round(min(idle_candidates), 1) if idle_candidates else 0.0
            if idle_seconds >= settings.handoff_idle_seconds:
                self._last_break_at = now

            session_age = max((now - self._session_started_at).total_seconds() / 60.0, 0.1)
            break_age   = max((now - self._last_break_at).total_seconds()      / 60.0, 0.1)

            # ── Artifact fingerprinting ───────────────────────────────────
            if switched:
                if int(stats["visits"]) > 0:
                    stats["revisits"] = int(stats["revisits"]) + 1
                stats["visits"] = int(stats["visits"]) + 1
                self._app_switch_timestamps.append(now_ts)
                self._artifact_entered_at_ts = now_ts
                self.record_event(f"Task switch → {active_app}")
                self._emit_recovery_capsule(active_app, active_window, artifact_id, now)
                self._last_artifact_id = artifact_id

            # ── Raw signal counts for scoring ─────────────────────────────
            backspaces       = float(keyboard.get("backspace_count",      0))
            paste_count      = float(keyboard.get("paste_count",          0))
            search_shortcuts = float(keyboard.get("search_shortcut_count",0))
            perclos_f        = float(features.perclos) if features.perclos is not None else 0.0

            # ── NEW: camera-derived signals ───────────────────────────────
            blink_rate     = float(camera.get("blink_rate_per_min", 15.0))
            expression     = str(camera.get("expression",           "neutral"))
            low_blink_rate = bool(camera.get("low_blink_rate",      False))

            # ── Time-of-day modifier ──────────────────────────────────────
            tod_modifier = time_modifier(now)
            cal_pressure = calendar_pressure(system.get("open_apps", []))

            # ══════════════════════════════════════════════════════════════
            # SCORE CALCULATIONS
            # ══════════════════════════════════════════════════════════════

            # ── Attention Residue ─────────────────────────────────────────
            residue_base   = 0.08
            residue_switch = 0.32 if switched else 0.0
            residue_scroll = clamp(scroll_reversals / 8.0,  0, 0.14)
            residue_break  = clamp(break_age / 90.0,        0, 0.18)
            attention_residue = clamp(residue_base + residue_switch + residue_scroll + residue_break)

            # ── Pre-Error Risk ────────────────────────────────────────────
            session_fatigue_curve = clamp(session_age / 120.0)
            low_blink_penalty     = 0.12 if low_blink_rate else 0.0   # eye strain = errors ↑
            pre_error_risk = clamp(
                0.10
                + clamp(backspaces / 12.0,              0, 0.22)
                + clamp(typing_speed_variance / 150_000, 0, 0.18)
                + clamp(iki_entropy / 1.8,               0, 0.18)
                + clamp(cursor_entropy / 1.8,            0, 0.14)
                + session_fatigue_curve * 0.18
                + tod_modifier          * 0.06
                + low_blink_penalty
            )

            # ── Focus Depth ───────────────────────────────────────────────
            focus_depth = clamp(
                0.80
                - pre_error_risk    * 0.30
                - attention_residue * 0.20
                - frustration       * 0.15
                + (0.10 if cursor_state == "steady" else -0.08)
                - idle_ratio        * 0.12
            )
            if classification.state == "focused" and classification.baseline_ready:
                focus_depth = clamp(focus_depth + 0.06)
            elif classification.state in ("confused", "fatigued") and classification.baseline_ready:
                focus_depth = clamp(focus_depth - 0.08)

            # ── Fatigue Risk ──────────────────────────────────────────────
            fatigue_risk = clamp(
                0.08
                + session_fatigue_curve * 0.38
                + clamp(break_age / 90.0,    0, 0.22)
                + clamp(idle_seconds / 60.0, 0, 0.14)
                + clamp(perclos_f * 1.6,     0, 0.28)
                + tod_modifier    * 0.08
            )
            if classification.state == "fatigued" and classification.baseline_ready:
                fatigue_risk = clamp(fatigue_risk + 0.10)

            # ── Confusion Risk ────────────────────────────────────────────
            brow_furrow_penalty = 0.08 if expression == "concerned" else 0.0
            confusion_risk = clamp(
                0.12
                + attention_residue * 0.22
                + pre_error_risk    * 0.20
                + clamp(search_shortcuts / 4.0,       0, 0.10)
                + clamp(int(stats["revisits"]) / 10.0,0, 0.12)
                + frustration       * 0.18
                + brow_furrow_penalty
                + (0.10 if classification.state == "confused" and classification.baseline_ready else 0.0)
            )

            # ── Emotional Load ────────────────────────────────────────────
            emotional_load_score = clamp(frustration)

            # ── Decision Fatigue ──────────────────────────────────────────
            decision_fatigue = clamp(
                0.08
                + fatigue_risk    * 0.38
                + cursor_entropy  * 0.16
                + clamp(scroll_reversals / 6.0, 0, 0.14)
                + clamp(session_age / 180.0,    0, 0.14)
            )

            # ── Interruptibility ──────────────────────────────────────────
            interruptibility = clamp(
                1.0
                - focus_depth       * 0.40
                - attention_residue * 0.20
                - confusion_risk    * 0.18
                - fatigue_risk      * 0.12
            )

            # ── Passive Comprehension Gap ─────────────────────────────────
            if ml_state:
                ml_attention = clamp(float(ml_state.get("attention_residue", attention_residue)))
                ml_pre_error = clamp(float(ml_state.get("pre_error_prob", pre_error_risk)))
                ml_interrupt = clamp(float(ml_state.get("interruptibility", interruptibility)))
                ml_friction = clamp(float(ml_state.get("confusion_friction", confusion_risk)))
                ml_cognitive = str(ml_state.get("cognitive_state", "")).lower()
                ml_struggle = str(ml_state.get("struggle_type", "")).lower()

                attention_residue = clamp(attention_residue * 0.45 + ml_attention * 0.55)
                pre_error_risk = clamp(pre_error_risk * 0.45 + ml_pre_error * 0.55)
                interruptibility = clamp(interruptibility * 0.45 + ml_interrupt * 0.55)

                confusion_target = clamp(
                    ml_friction
                    + (0.20 if ml_cognitive == "confused" else 0.0)
                    + (0.12 if ml_struggle == "harmful" else 0.0)
                    - (0.06 if ml_struggle == "productive" else 0.0)
                )
                confusion_risk = clamp(confusion_risk * 0.60 + confusion_target * 0.40)

                if ml_cognitive == "focused":
                    focus_depth = clamp(focus_depth + 0.10)
                    fatigue_risk = clamp(fatigue_risk - 0.04)
                elif ml_cognitive == "confused":
                    focus_depth = clamp(focus_depth - 0.10)
                elif ml_cognitive == "fatigued":
                    fatigue_risk = clamp(fatigue_risk + 0.14)
                    focus_depth = clamp(focus_depth - 0.16)

                if ml_struggle == "harmful":
                    focus_depth = clamp(focus_depth - 0.06)
                elif ml_struggle == "productive":
                    focus_depth = clamp(focus_depth + 0.03)

            passive_gap = clamp(
                0.06
                + clamp(scroll_reversals / 6.0,         0, 0.22)
                + clamp(int(stats["revisits"]) / 12.0,  0, 0.18)
                + pre_error_risk * 0.12
            )

            # ── AI Reliance Drift ─────────────────────────────────────────
            ai_drift = clamp(
                0.04
                + clamp(paste_count / 5.0, 0, 0.28)
                + (0.18 if any(t in active_window.lower() for t in AI_APPS) else 0.0)
                + pre_error_risk * 0.14
            )

            # ── Cognitive Debt ────────────────────────────────────────────
            self._debt = clamp(
                self._debt * 0.94
                + confusion_risk    * 0.06
                + attention_residue * 0.04
                + fatigue_risk      * 0.03
            )

            # ── Focus Debt Forecast ───────────────────────────────────────
            focus_forecast = clamp(
                fatigue_risk        * 0.40
                + attention_residue * 0.22
                + pre_error_risk    * 0.20
                + self._debt        * 0.12
                + tod_modifier      * 0.06
            )

            # ── Artifact Friction Score ───────────────────────────────────
            stats["friction_score"] = round(
                max(
                    float(stats["friction_score"]) * 0.84,
                    confusion_risk      * 0.40
                    + passive_gap       * 0.24
                    + attention_residue * 0.18
                    + ai_drift          * 0.18,
                ), 3,
            )

            # ══════════════════════════════════════════════════════════════
            # INTERRUPTION BROKER
            # ══════════════════════════════════════════════════════════════
            if focus_depth >= 0.60 and interruptibility <= 0.40:
                for app in _open_comm_apps(system.get("open_apps", []))[:3]:
                    if not any(i["source"] == app for i in self._pending_interruptions):
                        self._pending_interruptions.append({
                            "source": app, "urgency": "low",
                            "captured_at": now.isoformat(),
                        })
            elif self._pending_interruptions and focus_depth < 0.45:
                self._flush_interruption_queue(now)

            # ══════════════════════════════════════════════════════════════
            # HAND-OFF MODE
            # ══════════════════════════════════════════════════════════════
            handoff_triggered = idle_seconds >= settings.handoff_idle_seconds
            if handoff_triggered:
                self._emit_handoff_capsule(active_app, active_window, artifact_id, now, focus_forecast)

            # ══════════════════════════════════════════════════════════════
            # THRESHOLD EVENTS
            # ══════════════════════════════════════════════════════════════
            self._store_threshold_events(
                now=now, attention_residue=attention_residue,
                pre_error_risk=pre_error_risk, fatigue_risk=fatigue_risk,
                confusion_risk=confusion_risk,
                active_app=active_app, active_window=active_window,
                artifact_id=artifact_id,
            )

            # ══════════════════════════════════════════════════════════════
            # CONFUSION EPISODE TRACKING
            # ══════════════════════════════════════════════════════════════
            self._track_confusion_episode(confusion_risk, now, active_app, active_window)

            # ══════════════════════════════════════════════════════════════
            # SCREEN ALERT UPDATE
            # ══════════════════════════════════════════════════════════════
            state_label = _state_label(
                classifier_state = classification.state,
                keyboard         = keyboard,
                camera           = camera,
                idle_seconds     = idle_seconds,
            )
            if state_label != self._last_state_label:
                self.focus_mode.sync(state_label)
                self._last_state_label = state_label

            # ── Store artifact friction ───────────────────────────────────
            self.store.insert("artifacts", {
                "user_id": self.user_id, "artifact_id": artifact_id,
                "artifact_label": f"{active_app} :: {active_window}",
                "friction_score": stats["friction_score"],
                "visits": stats["visits"], "revisits": stats["revisits"],
                "first_seen": stats.get("first_seen"), "created_at": now,
            })

            # ── Scores payload ────────────────────────────────────────────
            scores_payload = {
                "focus_depth":               round(focus_depth,           3),
                "attention_residue":         round(attention_residue,     3),
                "pre_error_risk":            round(pre_error_risk,        3),
                "confusion_risk":            round(confusion_risk,        3),
                "fatigue_risk":              round(fatigue_risk,          3),
                "interruptibility":          round(interruptibility,      3),
                "interruption_cost":         round(1.0 - interruptibility,3),
                "decision_fatigue":          round(decision_fatigue,      3),
                "cognitive_debt":            round(self._debt,            3),
                "passive_comprehension_gap": round(passive_gap,           3),
                "ai_reliance_drift":         round(ai_drift,              3),
                "emotional_load":            round(emotional_load_score,  3),
                "focus_debt_forecast":       round(focus_forecast,        3),
            }

            # ── Recent events ─────────────────────────────────────────────
            with self._events_lock:
                recent_events = [
                    f"{e['timestamp']}  {e['message']}"
                    for e in self._events
                ][-12:]

            # ── Full snapshot payload ─────────────────────────────────────
            snapshot: dict[str, Any] = {
                "user_id":        self.user_id,
                "generated_at":   now.isoformat(),
                "state_label":    state_label,
                "active_app":     active_app,
                "active_window":  active_window,

                "state": {
                    "name":                 classification.state,
                    "detection_source":     "ml_assisted" if ml_state else "heuristic",
                    "confidence":           classification.confidence,
                    "message":              classification.message,
                    "scores":               classification.scores,
                    "z_scores":             classification.z_scores,
                    "rule_hits":            getattr(classification, "rule_hits", {}),
                    "calibration_progress": classification.calibration_progress,
                    "baseline_ready":       classification.baseline_ready,
                    "baseline_samples":     classification.baseline_samples,
                    "baseline_means":       classification.baseline_means,
                    "baseline_stds":        getattr(classification, "baseline_stds", {}),
                },

                "features":  classification.active_features.to_dict(),
                "keyboard":  keyboard,
                "mouse":     {k: v for k, v in cursor.items() if k != "activity_timestamps"},
                "camera":    camera,
                "system":    system,
                "cursor":    cursor,
                "time_tracker": time_data,

                "idle_seconds":  idle_seconds,
                "recent_events": recent_events,
                "scores":        scores_payload,
                "ml_state":      ml_state,

                "artifact": {
                    "artifact_id":    artifact_id,
                    "artifact_label": f"{active_app} :: {active_window}",
                    "friction_score": stats["friction_score"],
                    "visits":         stats["visits"],
                    "revisits":       stats["revisits"],
                },

                "contextual_enrichment": {
                    "session_age_minutes":      round(session_age,  1),
                    "time_since_break_minutes": round(break_age,    1),
                    "time_of_day_modifier":     tod_modifier,
                    "calendar_pressure":        cal_pressure,
                    "session_fatigue_curve":    round(session_fatigue_curve, 3),
                },

                "core_features": {
                    "attention_residue_meter": {
                        "score":            round(attention_residue, 3),
                        "switch_intent":    "forced" if switched else "voluntary",
                        "scroll_reversals": scroll_reversals,
                        "break_age_minutes":round(break_age, 1),
                    },
                    "pre_error_sentinel": {
                        "score":                 round(pre_error_risk,        3),
                        "session_fatigue_curve": round(session_fatigue_curve, 3),
                        "typing_entropy":        round(iki_entropy,           3),
                        "cursor_entropy":        round(cursor_entropy,        3),
                        "typing_speed_variance": round(typing_speed_variance, 1),
                        "low_blink_penalty":     low_blink_penalty,
                    },
                    "interruption_broker": {
                        "interruptibility":  round(interruptibility, 3),
                        "interruption_cost": round(1.0 - interruptibility, 3),
                        "pending_count":     len(self._pending_interruptions),
                        "pending_queue":     self._pending_interruptions[-5:],
                    },
                    "recovery_capsule": {
                        "current_goal":             _current_goal(active_app, active_window),
                        "likely_next_step":         _next_step(active_app),
                        "last_capsule_artifact_id": artifact_id,
                    },
                    "productive_struggle_engine": {
                        "mode": (
                            "productive_struggle" if 0.40 <= confusion_risk < 0.62
                            else "harmful_confusion" if confusion_risk >= 0.62
                            else "stable"
                        ),
                        "progress_velocity": round(clamp(0.5 - pre_error_risk, -1.0, 1.0), 3),
                        "confusion_risk":    round(confusion_risk, 3),
                    },
                    "camera_enhanced": {
                        "blink_rate_per_min": blink_rate,
                        "blink_rate_class":   camera.get("blink_rate_class", "no_data"),
                        "low_blink_rate":     low_blink_rate,
                        "expression":         expression,
                        "perclos":            round(perclos_f, 3),
                        "ear_mean":           camera.get("ear_mean"),
                        "cam_status":         camera.get("status", "unavailable"),
                    },
                    "onnx_inference": {
                        "enabled": bool(self.inference_engine),
                        "ready": ml_state is not None,
                        "interval_seconds": ML_INFERENCE_INTERVAL_SECONDS,
                        "app_switches_window": app_switches_window,
                        "dwell_seconds_window": round(dwell_seconds_window, 1),
                        "last_result_age_seconds": (
                            round(now_ts - self.last_ml_result_time, 1)
                            if self.last_ml_result_time
                            else None
                        ),
                        "features": ml_features,
                    },
                    "cognitive_twin": {
                        "baseline_ready":             classification.baseline_ready,
                        "baseline_samples":           classification.baseline_samples,
                        "personalization_confidence": round(
                            clamp(len(self.store.memory["snapshots"]) / 30.0), 3
                        ),
                        "ewma_means": classification.baseline_means,
                    },
                },

                "add_ons": {
                    "semantic_friction_map":          stats["friction_score"],
                    "decision_fatigue_guard":         round(decision_fatigue, 3),
                    "cognitive_debt_ledger":          round(self._debt,       3),
                    "passive_comprehension_verifier": round(passive_gap,      3),
                    "ai_reliance_drift_detector":     round(ai_drift,         3),
                    "confusion_replay_timeline":      len(self._events),
                    "cognitive_handoff_mode":         handoff_triggered,
                    "focus_debt_forecast": {
                        "score":                round(focus_forecast, 3),
                        "risk_peak_in_minutes": max(5, int(55 - focus_depth * 20 + fatigue_risk * 22)),
                    },
                    "camera_fatigue_boost": round(clamp(perclos_f * 1.8), 3),
                },
            }

            self._store_session_graph(
                now=now,
                snapshot=snapshot,
                system=system,
                keyboard=keyboard,
                cursor=cursor,
                camera=camera,
                classification=classification,
                scores_payload=scores_payload,
                artifact_id=artifact_id,
                active_app=active_app,
                active_window=active_window,
                state_label=state_label,
            )

            # ── Store core snapshot ───────────────────────────────────────
            self.store.insert("snapshots", {
                "user_id": self.user_id, "generated_at": now,
                "state_label": state_label,
                "active_app": active_app, "active_window": active_window,
                "scores": scores_payload,
                "classifier": {"state": classification.state, "confidence": classification.confidence,
                               "scores": classification.scores},
                "camera":  {"perclos": camera.get("perclos"), "status": camera.get("status"),
                            "blink_rate": blink_rate, "expression": expression},
                "contextual": {"session_age_minutes": round(session_age, 1),
                               "time_of_day_modifier": tod_modifier},
                "ml_state": ml_state,
            })
            self.store.insert("features_raw", {
                "user_id": self.user_id, "created_at": now, "state_label": state_label,
                "features": features.to_dict(), "z_scores": classification.z_scores,
                "rule_hits": getattr(classification, "rule_hits", {}),
                "baseline_means": classification.baseline_means,
                "baseline_stds":  getattr(classification, "baseline_stds", {}),
            })
            self.store.insert("z_scores", {
                "user_id": self.user_id, "created_at": now,
                "state_label": state_label, "z_scores": classification.z_scores,
                "scores": classification.scores,
            })
            self.store.insert("twins", {
                "user_id": self.user_id, "created_at": now,
                "baseline_ready": classification.baseline_ready,
                "baseline_samples": classification.baseline_samples,
                "personalization_confidence": round(clamp(len(self.store.memory["snapshots"]) / 30.0), 3),
                "ewma_means": classification.baseline_means,
            })
            self._persist_classifier_baseline()

            self._cached_payload   = snapshot
            self._last_snapshot_at = now_ts
            return snapshot

    # ── Dashboard ─────────────────────────────────────────────────────────────
    def dashboard_payload(self) -> dict[str, Any]:
        current = self.snapshot()
        return {
            "current": current,
            "history": self.store.recent("snapshots", 60),
            "events":  self.store.recent("events",     20),
            "capsules":self.store.recent("capsules",    6),
            "interruption_batches": self.store.recent("interruptions", 6),
            "friction_hotspots": sorted(
                self.store.recent("artifacts", 30),
                key=lambda x: x.get("friction_score", 0),
                reverse=True,
            )[:8],
            "cognitive_twin": (
                self.store.recent("twins", 1)[-1]
                if self.store.recent("twins", 1) else None
            ),
            "team_rollup":          self.store.team_rollup(),
            "confusion_episodes":   self.store.recent("confusion_episodes", 5),
            "attention_residue_events": self.store.recent("attention_residue_events", 10),
            "pre_error_events":     self.store.recent("pre_error_events",  10),
            "fatigue_events":       self.store.recent("fatigue_events",    10),
            "handoff_capsules":     self.store.recent("handoff_capsules",   3),
            "mongo_enabled":        self.store.enabled,
            "mongo_error":          self.store.error_message,
            "time_tracker":         self.time_tracker.snapshot(),
        }

    # ── Event recorder ────────────────────────────────────────────────────────
    def record_event(self, message: str, persist: bool = True) -> None:
        event = {
            "user_id": self.user_id, "created_at": utcnow(),
            "timestamp": time.strftime("%H:%M:%S"), "message": message,
        }
        with self._events_lock:
            if self._events and self._events[-1]["message"] == message:
                return
            self._events.append(event)
        if persist:
            self.store.insert("events", event)

    # ── Internal helpers (same as before) ─────────────────────────────────────
    def _on_state_change(self, new_state: str, old_state: str | None, now: datetime) -> None:
        self.record_event(f"State → {new_state.replace('_', ' ')}")
        self.store.insert("state_changes", {
            "user_id": self.user_id, "changed_at": now,
            "from_state": old_state or "none", "to_state": new_state,
        })

    def _emit_recovery_capsule(self, active_app, active_window, artifact_id, now):
        self.store.insert("capsules", {
            "user_id": self.user_id, "created_at": now,
            "artifact_id": artifact_id,
            "artifact_label": f"{active_app} :: {active_window}",
            "current_goal": _current_goal(active_app, active_window),
            "likely_next_step": _next_step(active_app),
            "type": "recovery", "blocker_note": None,
        })

    def _emit_handoff_capsule(self, active_app, active_window, artifact_id, now, focus_forecast):
        recent = self.store.recent("handoff_capsules", 1)
        if recent:
            last_ts = recent[-1].get("created_at", "")
            try:
                last_dt = datetime.fromisoformat(last_ts.replace("Z", "+00:00"))
                if (now - last_dt).total_seconds() < settings.handoff_idle_seconds:
                    return
            except (ValueError, TypeError):
                pass
        self.store.insert("handoff_capsules", {
            "user_id": self.user_id, "created_at": now,
            "artifact_id": artifact_id,
            "artifact_label": f"{active_app} :: {active_window}",
            "current_goal": _current_goal(active_app, active_window),
            "likely_next_step": _next_step(active_app),
            "focus_forecast": round(focus_forecast, 3),
            "type": "handoff", "blocker_note": None,
        })
        self.record_event("Handoff capsule saved — context preserved before break.")

    def _flush_interruption_queue(self, now):
        if not self._pending_interruptions:
            return
        summary = ", ".join(i["source"] for i in self._pending_interruptions)
        self.store.insert("interruptions", {
            "user_id": self.user_id, "created_at": now,
            "summary": summary, "count": len(self._pending_interruptions),
            "items": list(self._pending_interruptions),
        })
        self.record_event(f"Interruption batch delivered: {len(self._pending_interruptions)} held items.")
        self._pending_interruptions.clear()

    def _store_threshold_events(self, *, now, attention_residue, pre_error_risk,
                                 fatigue_risk, confusion_risk, active_app, active_window, artifact_id):
        base = {"user_id": self.user_id, "created_at": now,
                "active_app": active_app, "active_window": active_window,
                "artifact_id": artifact_id}
        if attention_residue > 0.50:
            self.store.insert("attention_residue_events", {
                **base, "attention_residue": round(attention_residue, 3),
                "severity": "high" if attention_residue > 0.70 else "medium",
            })
        if pre_error_risk > 0.60:
            self.store.insert("pre_error_events", {
                **base, "pre_error_risk": round(pre_error_risk, 3),
                "severity": "high" if pre_error_risk > 0.75 else "medium",
            })
        if fatigue_risk > 0.60:
            self.store.insert("fatigue_events", {
                **base, "fatigue_risk": round(fatigue_risk, 3),
                "severity": "high" if fatigue_risk > 0.75 else "medium",
            })

    def _track_confusion_episode(self, confusion_risk, now, active_app, active_window):
        IN_CONFUSION = confusion_risk >= 0.50
        episode_id   = self._confusion_episode_id
        if IN_CONFUSION and episode_id is None:
            self._confusion_episode_start = now
            self._confusion_episode_id    = hashlib.sha1(
                f"{self.user_id}::{now.isoformat()}".encode()
            ).hexdigest()[:12]
            self.store.insert("confusion_episodes", {
                "user_id": self.user_id, "episode_id": self._confusion_episode_id,
                "started_at": now, "resolved_at": None, "duration_s": None,
                "active_app": active_app, "active_window": active_window,
                "peak_confusion": round(confusion_risk, 3), "status": "ongoing",
            })
            self.record_event(f"Confusion episode started in {active_app}.")
        elif IN_CONFUSION and episode_id is not None:
            for ep in reversed(self.store.memory["confusion_episodes"]):
                if ep.get("episode_id") == episode_id:
                    ep["peak_confusion"] = max(float(ep.get("peak_confusion", 0.0)),
                                               round(confusion_risk, 3))
                    break
        elif not IN_CONFUSION and episode_id is not None:
            duration = (now - self._confusion_episode_start).total_seconds() if self._confusion_episode_start else 0
            for ep in reversed(self.store.memory["confusion_episodes"]):
                if ep.get("episode_id") == episode_id:
                    ep["resolved_at"] = now.isoformat()
                    ep["duration_s"]  = round(duration, 1)
                    ep["status"]      = "resolved"
                    break
            self.record_event(f"Confusion episode resolved after {int(duration)}s.")
            self._confusion_episode_id    = None
            self._confusion_episode_start = None


# ── Pure functions ────────────────────────────────────────────────────────────
def _cursor_state(cursor):
    speed     = float(cursor.get("cursor_speed",    0.0))
    linearity = float(cursor.get("path_linearity",  0.0))
    clicks    = int(cursor.get("click_count",       0))
    if speed >= 1_200 and linearity < 0.45: return "in_a_hurry"
    if linearity < 0.34 or clicks >= 4:    return "searching"
    return "steady"

def _cursor_entropy(cursor):
    linearity     = float(cursor.get("path_linearity", 0.0))
    click_density = clamp(int(cursor.get("click_count",  0)) / 8.0,  0, 0.25)
    scroll_density= clamp(int(cursor.get("scroll_count", 0)) / 10.0, 0, 0.20)
    return round(clamp((1.0 - linearity) * 0.70 + click_density + scroll_density), 3)

def _scroll_reversal_proxy(cursor):
    explicit = cursor.get("scroll_reversals")
    if isinstance(explicit, (int, float)):
        return int(explicit)
    count     = int(cursor.get("scroll_count",    0))
    linearity = float(cursor.get("path_linearity",0.0))
    if count < 2: return 0
    return max(int(round(count * (1.0 - linearity) * 0.55)), 0)

def _typing_speed_variance(keyboard):
    kpm     = float(keyboard.get("keys_per_minute", 0.0))
    iki_std = float(keyboard.get("iki_std",         0.0))
    return round((kpm * max(iki_std, 0.01) * 4.0) ** 2, 3)

def _iki_entropy(keyboard):
    iki_mean = float(keyboard.get("iki_mean", 0.0))
    iki_std  = float(keyboard.get("iki_std",  0.0))
    return round(clamp(iki_std / max(iki_mean + 0.05, 0.05)), 3)

def _frustration_index(keyboard, iki_entropy):
    backspaces     = float(keyboard.get("backspace_count", 0))
    deletes        = float(keyboard.get("delete_count",    0))
    error_rate     = float(keyboard.get("error_rate",      0.0))
    modifier_count = float(keyboard.get("modifier_count",  0))
    return round(clamp(
        error_rate     * 0.50
        + clamp((backspaces + deletes) / 14.0, 0, 0.30)
        + iki_entropy  * 0.22
        + clamp(modifier_count / 30.0, 0, 0.10)
    ), 3)

def _emotion_hits(keyboard, frustration):
    corrections      = int(keyboard.get("backspace_count", 0)) + int(keyboard.get("delete_count", 0))
    negative_hits    = max(int(round(corrections * frustration * 1.3)), 0)
    uncertainty_hits = max(int(round(float(keyboard.get("modifier_count", 0)) * 0.15 + frustration * 3)), 0)
    return negative_hits, uncertainty_hits

def _compute_idle_ratio(now, activity_timestamps, window_seconds):
    window_start = now - window_seconds
    stamps = [t for t in activity_timestamps if t >= window_start]
    if not stamps: return 1.0
    idle_time = max(stamps[0] - window_start, 0.0)
    prev = stamps[0]
    for t in stamps[1:]:
        if t - prev > IDLE_GAP_SECONDS:
            idle_time += (t - prev)
        prev = t
    tail = now - prev
    if tail > IDLE_GAP_SECONDS:
        idle_time += tail
    return round(clamp(idle_time / window_seconds), 3)

def _state_label(*, classifier_state, keyboard, camera, idle_seconds):
    camera_status = str(camera.get("status", "disabled")).lower()
    face_detected = bool(camera.get("face_detected", False))
    camera_available = camera_status not in {"disabled", "unavailable"}
    blink_rate = float(camera.get("blink_rate_per_min", 0.0) or 0.0)
    rigorous_head_movement = bool(camera.get("rigorous_head_movement", False))
    recent_backspaces = int(keyboard.get("recent_backspace_count_5s", 0) or 0)
    recent_printable = int(keyboard.get("recent_printable_count_5s", 0) or 0)

    if idle_seconds > 10:
        if camera_available and not face_detected:
            return "user_not_present"
        return "deep_focus"

    if idle_seconds > 5:
        return "ideal"

    if recent_backspaces > recent_printable:
        return "confused"

    if camera_available and face_detected and (blink_rate > 30 or rigorous_head_movement):
        return "fatigued"

    if classifier_state == "confused":
        return "confused"
    return "focused"

def _current_goal(active_app, active_window):
    app = active_app.lower()
    if any(t in app for t in ("code", "studio", "pycharm", "vim", "nvim")):
        return "Resolve the active coding task without losing implementation context."
    if any(t in app for t in ("chrome", "edge", "firefox", "brave")):
        return f"Extract the needed answer from: {active_window[:50]}."
    return f"Continue the current workflow in {active_app}."

def _next_step(active_app):
    app = active_app.lower()
    if any(t in app for t in ("code", "studio", "pycharm")):
        return "Test the last change and adjust one function at a time."
    return "Continue with the next concrete action in the current artifact."

def _camera_disabled_snapshot():
    return {
        "perclos": None, "status": "disabled",
        "message": "Camera monitor disabled by configuration.",
        "face_detected": False, "eye_aspect_ratio": None,
        "ear_mean": None,
        "closed_threshold": None, "sample_count": 0,
        "blink_rate_per_min": 0.0, "blink_rate_class": "no_data",
        "low_blink_rate": False,
        "head_movement_intensity": 0.0,
        "head_movement_class": "no_data",
        "rigorous_head_movement": False,
        "expression": "neutral",
    }

def time_modifier(now):
    hour = now.astimezone().hour
    if 13 <= hour <= 15:            return 0.55
    if hour >= 21 or hour <= 6:     return 0.65
    if 10 <= hour <= 12:            return 0.18
    return 0.32

def calendar_pressure(open_apps):
    hits = 0
    for app in open_apps:
        haystack = f"{app.get('name', '')} {app.get('title', '')}".lower()
        if any(t in haystack for t in CAL_APPS + COMM_APPS):
            hits += 1
    return round(clamp(hits / 5.0), 3)

def _open_comm_apps(open_apps):
    results = []
    for app in open_apps:
        haystack = f"{app.get('name', '')} {app.get('title', '')}".lower()
        if any(t in haystack for t in COMM_APPS):
            results.append(str(app.get("name", "unknown")))
    return results


# ── FastAPI application ───────────────────────────────────────────────────────
def create_api_app(monitor: ActivityMonitor) -> FastAPI:
    app = FastAPI(title="Flow Guardian Cognitive API", version="2.0.0")
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True,
                       allow_methods=["*"], allow_headers=["*"])

    @app.get("/health")
    def health():
        return {"ok": True, "mongo_enabled": monitor.store.enabled,
                "mongo_error": monitor.store.error_message, "user_id": monitor.user_id}

    @app.get("/api/state")
    def state():
        return jsonable_encoder(monitor.snapshot())

    @app.get("/api/dashboard")
    def dashboard():
        return jsonable_encoder(monitor.dashboard_payload())

    @app.get("/api/scores")
    def scores():
        snap = monitor.snapshot()
        return jsonable_encoder({"state_label": snap["state_label"],
                                  "scores": snap["scores"], "classifier": snap["state"]})

    @app.get("/api/friction")
    def friction():
        return jsonable_encoder({"hotspots": sorted(
            monitor.store.recent("artifacts", 30),
            key=lambda x: x.get("friction_score", 0), reverse=True)[:10]})

    @app.get("/api/confusion_episodes")
    def confusion_episodes():
        return jsonable_encoder(monitor.store.recent("confusion_episodes", 10))

    @app.get("/api/events/residue")
    def residue_events():
        return jsonable_encoder(monitor.store.recent("attention_residue_events", 20))

    @app.get("/api/events/pre_error")
    def pre_error_events():
        return jsonable_encoder(monitor.store.recent("pre_error_events", 20))

    @app.get("/api/events/fatigue")
    def fatigue_events():
        return jsonable_encoder(monitor.store.recent("fatigue_events", 20))

    @app.get("/api/activity-stream")
    def activity_stream():
        return jsonable_encoder(monitor.store.recent("activity_stream", 50))

    @app.get("/api/context-chunks")
    def context_chunks():
        return jsonable_encoder(monitor.store.recent("context_chunks", 50))

    @app.get("/api/graph/entities")
    def graph_entities():
        return jsonable_encoder(monitor.store.recent("entities", 80))

    @app.get("/api/graph/relations")
    def graph_relations():
        return jsonable_encoder(monitor.store.recent("relations", 120))

    @app.get("/api/focus-events")
    def focus_events():
        return jsonable_encoder(monitor.store.recent("focus_events", 40))

    @app.get("/api/handoff")
    def handoff():
        return jsonable_encoder(monitor.store.recent("handoff_capsules", 5))

    @app.get("/api/time")
    def time_tracking():
        return jsonable_encoder(monitor.time_tracker.snapshot())

    @app.get("/api/camera")
    def camera():
        snap = monitor.snapshot()
        return jsonable_encoder(snap.get("camera", {}))

    @app.post("/api/capsules/blocker")
    def add_blocker(payload: CapsuleNoteRequest):
        updated = monitor.store.append_capsule_note(monitor.user_id, payload.note)
        if updated:
            monitor.record_event("Micro-journal blocker note saved.", persist=True)
        return {"ok": updated}

    @app.get("/api/team")
    def team():
        return jsonable_encoder(monitor.store.team_rollup())

    return app
