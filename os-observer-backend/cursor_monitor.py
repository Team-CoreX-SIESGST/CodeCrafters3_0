from __future__ import annotations

import math
import threading
import time
from collections import deque
from dataclasses import dataclass
from typing import Deque

from pynput import mouse


@dataclass(slots=True)
class CursorSample:
    timestamp: float
    x: int
    y: int
    distance: float
    speed: float


class CursorMonitor:
    def __init__(self, window_seconds: float = 30.0, event_callback=None) -> None:
        self.window_seconds = window_seconds
        self.event_callback = event_callback
        self.samples: Deque[CursorSample] = deque()
        self.click_times: Deque[float] = deque()
        self.scroll_times: Deque[float] = deque()
        self.click_dwells: Deque[tuple[float, float]] = deque()
        self._press_times: dict[str, float] = {}
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
        speed = distance / dt if distance > 0 else 0.0
        sample = CursorSample(timestamp=now, x=x, y=y, distance=distance, speed=speed)

        with self._lock:
            self.samples.append(sample)
            self._prune(now)

        self._last_position = (x, y)
        self._last_timestamp = now

    def _on_click(self, x: int, y: int, button, pressed: bool) -> None:
        now = time.time()
        self._last_input_timestamp = now
        button_name = getattr(button, "name", str(button))

        with self._lock:
            if pressed:
                self.click_times.append(now)
                self._press_times[button_name] = now
            else:
                pressed_at = self._press_times.pop(button_name, None)
                if pressed_at is not None:
                    self.click_dwells.append((now, max(now - pressed_at, 0.0)))
            self._prune(now)

        if pressed and self.event_callback is not None:
            self.event_callback(f"Mouse click: {button_name}")

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
        while self.click_dwells and self.click_dwells[0][0] < cutoff:
            self.click_dwells.popleft()

    def snapshot(self) -> dict[str, object]:
        with self._lock:
            now = time.time()
            self._prune(now)
            samples = list(self.samples)
            click_times = list(self.click_times)
            scroll_times = list(self.scroll_times)
            click_dwell_values = [value for _, value in self.click_dwells]

        duration_seconds = self.window_seconds
        if samples:
            duration_seconds = max(samples[-1].timestamp - samples[0].timestamp, 0.1)

        total_distance = sum(sample.distance for sample in samples)
        cursor_speed = total_distance / duration_seconds if duration_seconds else 0.0
        straight_line_distance = 0.0
        if samples:
            straight_line_distance = math.hypot(
                samples[-1].x - samples[0].x,
                samples[-1].y - samples[0].y,
            )
        path_linearity = (
            straight_line_distance / total_distance if total_distance > 0 else 0.0
        )
        click_dwell = (
            sum(click_dwell_values) / len(click_dwell_values) if click_dwell_values else 0.0
        )

        return {
            "cursor_speed": round(cursor_speed, 2),
            "path_linearity": round(min(max(path_linearity, 0.0), 1.0), 3),
            "click_dwell": round(click_dwell, 3),
            "total_distance": round(total_distance, 2),
            "straight_line_distance": round(straight_line_distance, 2),
            "click_count": len(click_times),
            "scroll_count": len(scroll_times),
            "seconds_since_last_input": round(
                now - self._last_input_timestamp, 1
            ) if self._last_input_timestamp else None,
            "activity_timestamps": [sample.timestamp for sample in samples] + click_times + scroll_times,
        }
