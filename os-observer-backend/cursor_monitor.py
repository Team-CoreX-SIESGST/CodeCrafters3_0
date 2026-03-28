from __future__ import annotations

import math
import threading
import time
from collections import deque
from dataclasses import dataclass
from typing import Deque

from pynput import mouse

from classifier import CursorFeatures, classify_cursor_activity


@dataclass(slots=True)
class CursorSample:
    timestamp: float
    distance: float
    speed: float
    angle: float


class CursorMonitor:
    def __init__(self, window_seconds: float = 4.0, event_callback=None) -> None:
        self.window_seconds = window_seconds
        self.event_callback = event_callback
        self.samples: Deque[CursorSample] = deque()
        self.click_times: Deque[float] = deque()
        self.scroll_times: Deque[float] = deque()
        self._lock = threading.Lock()
        self._last_position: tuple[int, int] | None = None
        self._last_timestamp: float | None = None
        self._last_input_timestamp: float | None = None
        self._last_scroll_log: float = 0.0
        self.listener: mouse.Listener | None = None

    def start(self) -> None:
        self.listener = mouse.Listener(
            on_move=self._on_move,
            on_click=self._on_click,
            on_scroll=self._on_scroll,
        )
        self.listener.daemon = True
        self.listener.start()

    def stop(self) -> None:
        if self.listener is not None:
            self.listener.stop()

    def _on_move(self, x: int, y: int) -> None:
        now = time.time()
        self._last_input_timestamp = now
        if self._last_position is None or self._last_timestamp is None:
            self._last_position = (x, y)
            self._last_timestamp = now
            return

        dt = now - self._last_timestamp
        if dt <= 0:
            return

        dx = x - self._last_position[0]
        dy = y - self._last_position[1]
        distance = math.hypot(dx, dy)
        if distance <= 0:
            self._last_position = (x, y)
            self._last_timestamp = now
            return

        speed = distance / dt
        angle = math.atan2(dy, dx)
        sample = CursorSample(timestamp=now, distance=distance, speed=speed, angle=angle)

        with self._lock:
            self.samples.append(sample)
            self._prune(now)

        self._last_position = (x, y)
        self._last_timestamp = now

    def _on_click(self, x: int, y: int, button, pressed: bool) -> None:
        if not pressed:
            return

        now = time.time()
        self._last_input_timestamp = now
        with self._lock:
            self.click_times.append(now)
            self._prune(now)

        if self.event_callback is not None:
            self.event_callback(f"Mouse click: {button.name}")

    def _on_scroll(self, x: int, y: int, dx: int, dy: int) -> None:
        now = time.time()
        self._last_input_timestamp = now
        with self._lock:
            self.scroll_times.append(now)
            self._prune(now)

        if self.event_callback is not None and now - self._last_scroll_log > 1.0:
            direction = "down" if dy < 0 else "up"
            self.event_callback(f"Mouse scroll: {direction}")
            self._last_scroll_log = now

    def _prune(self, now: float) -> None:
        cutoff = now - self.window_seconds
        while self.samples and self.samples[0].timestamp < cutoff:
            self.samples.popleft()
        while self.click_times and self.click_times[0] < cutoff:
            self.click_times.popleft()
        while self.scroll_times and self.scroll_times[0] < cutoff:
            self.scroll_times.popleft()

    def snapshot(self) -> dict[str, object]:
        with self._lock:
            now = time.time()
            self._prune(now)
            samples = list(self.samples)
            click_count = len(self.click_times)
            scroll_count = len(self.scroll_times)

        features = self._compute_features(samples)
        state, confidence, message = classify_cursor_activity(features)
        return {
            "state": state,
            "confidence": confidence,
            "message": message,
            "features": features,
            "click_count": click_count,
            "scroll_count": scroll_count,
            "seconds_since_last_input": round(
                now - self._last_input_timestamp, 1
            ) if self._last_input_timestamp else None,
        }

    def _compute_features(self, samples: list[CursorSample]) -> CursorFeatures:
        if not samples:
            return CursorFeatures(
                duration_seconds=self.window_seconds,
                total_distance=0.0,
                average_speed=0.0,
                peak_speed=0.0,
                direction_changes=0,
                event_count=0,
            )

        total_distance = sum(sample.distance for sample in samples)
        peak_speed = max(sample.speed for sample in samples)
        duration_seconds = max(samples[-1].timestamp - samples[0].timestamp, 0.1)
        average_speed = total_distance / duration_seconds

        direction_changes = 0
        previous_angle = samples[0].angle
        for sample in samples[1:]:
            delta = abs(sample.angle - previous_angle)
            delta = min(delta, (2 * math.pi) - delta)
            if delta > math.radians(55):
                direction_changes += 1
            previous_angle = sample.angle

        return CursorFeatures(
            duration_seconds=duration_seconds,
            total_distance=round(total_distance, 2),
            average_speed=round(average_speed, 2),
            peak_speed=round(peak_speed, 2),
            direction_changes=direction_changes,
            event_count=len(samples),
        )
