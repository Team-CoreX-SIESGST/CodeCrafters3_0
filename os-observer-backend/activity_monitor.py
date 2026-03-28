from __future__ import annotations

import threading
import time
from collections import deque

from app_monitor import AppMonitor
from cursor_monitor import CursorMonitor
from keyboard_monitor import KeyboardMonitor


class ActivityMonitor:
    def __init__(self) -> None:
        self._events = deque(maxlen=10)
        self._events_lock = threading.Lock()
        self._last_cursor_state: str | None = None

        self.cursor_monitor = CursorMonitor(window_seconds=4.0, event_callback=self.record_event)
        self.keyboard_monitor = KeyboardMonitor(window_seconds=20.0, event_callback=self.record_event)
        self.app_monitor = AppMonitor(poll_interval=2.0, event_callback=self.record_event)

    def start(self) -> None:
        self.cursor_monitor.start()
        self.keyboard_monitor.start()
        self.app_monitor.start()
        self.record_event("OS activity monitor started")

    def stop(self) -> None:
        self.cursor_monitor.stop()
        self.keyboard_monitor.stop()
        self.app_monitor.stop()

    def snapshot(self) -> dict[str, object]:
        cursor = self.cursor_monitor.snapshot()
        keyboard = self.keyboard_monitor.snapshot()
        system = self.app_monitor.snapshot()

        if cursor["state"] != self._last_cursor_state:
            state_label = str(cursor["state"]).replace("_", " ")
            self.record_event(f"Cursor state: {state_label}")
            self._last_cursor_state = str(cursor["state"])

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
            "cursor": cursor,
            "keyboard": keyboard,
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
