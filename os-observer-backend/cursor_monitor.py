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
    def __init__(self, window_seconds: float = 4.0) -> None:
        self.window_seconds = window_seconds
        self.samples: Deque[CursorSample] = deque()
        self._lock = threading.Lock()
        self._last_position: tuple[int, int] | None = None
        self._last_timestamp: float | None = None
        self.listener: mouse.Listener | None = None

    def start(self) -> None:
        self.listener = mouse.Listener(on_move=self._on_move)
        self.listener.daemon = True
        self.listener.start()

    def stop(self) -> None:
        if self.listener is not None:
            self.listener.stop()

    def _on_move(self, x: int, y: int) -> None:
        now = time.time()
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

    def _prune(self, now: float) -> None:
        cutoff = now - self.window_seconds
        while self.samples and self.samples[0].timestamp < cutoff:
            self.samples.popleft()

    def snapshot(self) -> dict[str, object]:
        with self._lock:
            now = time.time()
            self._prune(now)
            samples = list(self.samples)

        features = self._compute_features(samples)
        state, confidence, message = classify_cursor_activity(features)
        return {
            "state": state,
            "confidence": confidence,
            "message": message,
            "features": features,
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
