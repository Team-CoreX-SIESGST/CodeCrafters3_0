from __future__ import annotations

import threading
import time
from collections import deque

from app_monitor import AppMonitor
from camera_monitor import CameraMonitor
from classifier import CognitiveStateClassifier, FeatureVector
from cursor_monitor import CursorMonitor
from keyboard_monitor import KeyboardMonitor


WINDOW_SECONDS = 30.0
IDLE_GAP_SECONDS = 2.0


class ActivityMonitor:
    def __init__(self) -> None:
        self._events = deque(maxlen=10)
        self._events_lock = threading.Lock()
        self._last_state: str | None = None

        self.cursor_monitor = CursorMonitor(window_seconds=WINDOW_SECONDS, event_callback=self.record_event)
        self.keyboard_monitor = KeyboardMonitor(window_seconds=WINDOW_SECONDS, event_callback=self.record_event)
        self.camera_monitor = CameraMonitor(window_seconds=60.0, event_callback=self.record_event)
        self.app_monitor = AppMonitor(poll_interval=2.0, event_callback=self.record_event)
        self.classifier = CognitiveStateClassifier(calibration_seconds=300.0, minimum_samples=20)

    def start(self) -> None:
        self.cursor_monitor.start()
        self.keyboard_monitor.start()
        self.camera_monitor.start()
        self.app_monitor.start()
        self.record_event("OS activity monitor started")

    def stop(self) -> None:
        self.cursor_monitor.stop()
        self.keyboard_monitor.stop()
        self.camera_monitor.stop()
        self.app_monitor.stop()

    def snapshot(self) -> dict[str, object]:
        now = time.time()
        cursor = self.cursor_monitor.snapshot()
        keyboard = self.keyboard_monitor.snapshot()
        camera = self.camera_monitor.snapshot()
        system = self.app_monitor.snapshot()

        activity_timestamps = sorted(
            list(cursor["activity_timestamps"]) + list(keyboard["activity_timestamps"])
        )
        idle_ratio = self._compute_idle_ratio(now, activity_timestamps, WINDOW_SECONDS)

        features = FeatureVector(
            iki_mean=float(keyboard["iki_mean"]),
            iki_std=float(keyboard["iki_std"]),
            error_rate=float(keyboard["error_rate"]),
            burst_length=float(keyboard["burst_length"]),
            cursor_speed=float(cursor["cursor_speed"]),
            path_linearity=float(cursor["path_linearity"]),
            click_dwell=float(cursor["click_dwell"]),
            idle_ratio=idle_ratio,
            perclos=float(camera["perclos"]) if camera["perclos"] is not None else None,
        )
        classification = self.classifier.classify(features, now=now)

        if classification.state != self._last_state:
            state_label = classification.state.replace("_", " ")
            self.record_event(f"State changed: {state_label}")
            self._last_state = classification.state

        idle_candidates = [
            value
            for value in (
                cursor.get("seconds_since_last_input"),
                keyboard.get("seconds_since_last_key"),
            )
            if isinstance(value, (int, float))
        ]
        idle_seconds = round(min(idle_candidates), 1) if idle_candidates else None

        with self._events_lock:
            recent_events = list(self._events)

        return {
            "state": {
                "name": classification.state,
                "confidence": classification.confidence,
                "message": classification.message,
                "scores": classification.scores,
                "z_scores": classification.z_scores,
                "calibration_progress": classification.calibration_progress,
                "baseline_ready": classification.baseline_ready,
                "baseline_samples": classification.baseline_samples,
            },
            "features": classification.active_features.to_dict(),
            "keyboard": keyboard,
            "mouse": {
                key: value
                for key, value in cursor.items()
                if key != "activity_timestamps"
            },
            "camera": camera,
            "system": system,
            "idle_seconds": idle_seconds,
            "recent_events": recent_events,
        }

    def record_event(self, message: str) -> None:
        timestamp = time.strftime("%H:%M:%S")
        with self._events_lock:
            if self._events and self._events[-1].endswith(message):
                return
            self._events.append(f"{timestamp}  {message}")

    @staticmethod
    def _compute_idle_ratio(
        now: float, activity_timestamps: list[float], window_seconds: float
    ) -> float:
        window_start = now - window_seconds
        timestamps = [timestamp for timestamp in activity_timestamps if timestamp >= window_start]
        if not timestamps:
            return 1.0

        idle_time = max(timestamps[0] - window_start, 0.0)
        previous = timestamps[0]
        for timestamp in timestamps[1:]:
            gap = timestamp - previous
            if gap > IDLE_GAP_SECONDS:
                idle_time += gap
            previous = timestamp

        tail_gap = now - previous
        if tail_gap > IDLE_GAP_SECONDS:
            idle_time += tail_gap

        return round(min(max(idle_time / window_seconds, 0.0), 1.0), 3)
