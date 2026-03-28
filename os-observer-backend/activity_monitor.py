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
from keyboard_monitor import KeyboardMonitor
from time_tracker     import TimeTracker


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
    snapshot_interval_seconds = float(os.getenv("COGNITIVE_SNAPSHOT_INTERVAL_SECONDS", "3")),
)

USER_ID   = os.getenv("COGNITIVE_USER_ID", getpass.getuser())
MONGO_URI = os.getenv("MONGO_URI", "")
DB_NAME   = os.getenv("COGNITIVE_DB_NAME", "codecraftors_3_0")

COMM_APPS = ("slack", "teams", "outlook", "gmail", "discord", "telegram", "whatsapp")
AI_APPS   = ("chatgpt", "claude", "copilot", "gemini", "perplexity")
CAL_APPS  = ("calendar", "meet", "zoom")

WINDOW_SECONDS   = 30.0
IDLE_GAP_SECONDS =  2.0


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
        "confusion_episodes", "handoff_capsules",
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
            db = self.client.get_default_database() or self.client[DB_NAME]
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

        # Session timing
        self._session_started_at = utcnow()
        self._last_break_at      = utcnow()
        self._debt               = 0.05

        # Interruption queue
        self._pending_interruptions: list[dict[str, Any]] = []

        # State tracking
        self._last_state:        str | None = None
        self._last_cursor_state: str | None = None

        # Confusion episode tracking
        self._confusion_episode_start:  datetime | None = None
        self._confusion_episode_id:     str | None = None

        # ── Sub-monitors ──────────────────────────────────────────────────
        self.cursor_monitor   = CursorMonitor(window_seconds=WINDOW_SECONDS, event_callback=self.record_event)
        self.keyboard_monitor = KeyboardMonitor(window_seconds=WINDOW_SECONDS, event_callback=self.record_event)
        self.camera_monitor   = CameraMonitor(window_seconds=settings.camera_window_seconds, event_callback=self.record_event)
        self.app_monitor      = AppMonitor(poll_interval=2.0,              event_callback=self.record_event)
        self.time_tracker     = TimeTracker()
        self.classifier       = CognitiveStateClassifier(calibration_seconds=90.0, minimum_samples=20)

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
        self.cursor_monitor.stop()
        self.keyboard_monitor.stop()
        if settings.camera_enabled:
            self.camera_monitor.stop()
        self.app_monitor.stop()

    # ── Core snapshot ─────────────────────────────────────────────────────────
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
            artifact_id = hashlib.sha1(f"{active_app}::{active_window}".encode()).hexdigest()[:16]
            switched    = artifact_id != self._last_artifact_id
            stats       = self._artifact_stats[artifact_id]

            if switched:
                if int(stats["visits"]) > 0:
                    stats["revisits"] = int(stats["revisits"]) + 1
                stats["visits"] = int(stats["visits"]) + 1
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
                attention_residue = attention_residue,
                focus_depth      = focus_depth,
                confusion_risk   = confusion_risk,
                fatigue_risk     = fatigue_risk,
                classifier_state = classification.state,
                perclos          = perclos_f,
            )

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
                        "cam_status":         camera.get("status", "unavailable"),
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

def _state_label(*, attention_residue, focus_depth, confusion_risk, fatigue_risk, classifier_state, perclos):
    if classifier_state == "calibrating":
        return "calibrating"
    if perclos >= 0.18 or classifier_state == "fatigued" or fatigue_risk >= 0.68:
        return "fatigued"
    if classifier_state == "confused":
        if confusion_risk >= 0.62:
            return "harmful_confusion"
        if confusion_risk >= 0.42:
            return "productive_struggle"
        return "confused"
    if classifier_state == "focused":
        if focus_depth >= 0.72 and attention_residue <= 0.32 and fatigue_risk <= 0.40:
            return "deep_focus"
        if focus_depth >= 0.55:
            return "focused"
    if confusion_risk >= 0.62:
        return "harmful_confusion"
    if confusion_risk >= 0.42:
        return "productive_struggle"
    return "steady"

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
        "closed_threshold": None, "sample_count": 0,
        "blink_rate_per_min": 0.0, "blink_rate_class": "no_data",
        "low_blink_rate": False, "expression": "neutral",
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
