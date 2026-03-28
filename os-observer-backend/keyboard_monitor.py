#keyboard_monitor.py

from __future__ import annotations

import math
import threading
import time
from collections import deque
from dataclasses import dataclass
from typing import Deque

from pynput import keyboard


BURST_PAUSE_SECONDS = 1.0


@dataclass(slots=True)
class KeySample:
    timestamp: float
    is_printable: bool
    is_backspace: bool
    is_delete: bool
    is_modifier: bool


class KeyboardMonitor:
    def __init__(self, window_seconds: float = 30.0, event_callback=None) -> None:
        self.window_seconds = window_seconds
        self.event_callback = event_callback
        self.samples: Deque[KeySample] = deque()
        self._lock = threading.Lock()
        self._last_key_timestamp: float | None = None
        self._last_typing_log: float = 0.0
        self.listener: keyboard.Listener | None = None

    def start(self) -> None:
        self.listener = keyboard.Listener(on_press=self._on_press)
        self.listener.daemon = True
        self.listener.start()

    def stop(self) -> None:
        if self.listener is not None:
            self.listener.stop()

    def _on_press(self, key) -> None:
        now = time.time()
        self._last_key_timestamp = now

        sample = KeySample(
            timestamp=now,
            is_printable=self._is_printable(key),
            is_backspace=key == keyboard.Key.backspace,
            is_delete=key == keyboard.Key.delete,
            is_modifier=key in {
                keyboard.Key.ctrl,
                keyboard.Key.ctrl_l,
                keyboard.Key.ctrl_r,
                keyboard.Key.alt,
                keyboard.Key.alt_l,
                keyboard.Key.alt_r,
                keyboard.Key.shift,
                keyboard.Key.shift_l,
                keyboard.Key.shift_r,
                keyboard.Key.cmd,
            },
        )

        with self._lock:
            self.samples.append(sample)
            self._prune(now)

        if self.event_callback is None:
            return

        if sample.is_backspace or sample.is_delete:
            self.event_callback("Keyboard: correction key used")
            return

        if key == keyboard.Key.enter:
            self.event_callback("Keyboard: enter pressed")
            return

        if sample.is_printable and now - self._last_typing_log > 2.0:
            self.event_callback("Keyboard: typing activity")
            self._last_typing_log = now

    def snapshot(self) -> dict[str, float | int | None | list[float]]:
        with self._lock:
            now = time.time()
            self._prune(now)
            samples = list(self.samples)

        if not samples:
            return self._empty_snapshot(now)

        intervals = self._inter_key_intervals(samples)
        iki_mean = sum(intervals) / len(intervals) if intervals else 0.0
        iki_std = self._std(intervals)
        total_keys = len(samples)
        printable_chars = sum(1 for sample in samples if sample.is_printable)
        error_count = sum(1 for sample in samples if sample.is_backspace or sample.is_delete)
        modifier_count = sum(1 for sample in samples if sample.is_modifier)
        duration = max(samples[-1].timestamp - samples[0].timestamp, 1.0)
        burst_lengths = self._burst_lengths(samples)
        burst_length = sum(burst_lengths) / len(burst_lengths) if burst_lengths else 0.0
        wpm = (printable_chars / 5.0) / (duration / 60.0)
        keys_per_minute = total_keys / duration * 60.0

        return {
            "wpm": round(wpm, 1),
            "keys_per_minute": round(keys_per_minute, 1),
            "backspace_count": sum(1 for sample in samples if sample.is_backspace),
            "delete_count": sum(1 for sample in samples if sample.is_delete),
            "modifier_count": modifier_count,
            "total_keys": total_keys,
            "error_rate": round(error_count / total_keys, 3) if total_keys else 0.0,
            "iki_mean": round(iki_mean, 3),
            "iki_std": round(iki_std, 3),
            "burst_length": round(burst_length, 2),
            "burst_count": len(burst_lengths),
            "seconds_since_last_key": round(now - self._last_key_timestamp, 1)
            if self._last_key_timestamp
            else None,
            "activity_timestamps": [sample.timestamp for sample in samples],
        }

    def _empty_snapshot(self, now: float) -> dict[str, float | int | None | list[float]]:
        return {
            "wpm": 0.0,
            "keys_per_minute": 0.0,
            "backspace_count": 0,
            "delete_count": 0,
            "modifier_count": 0,
            "total_keys": 0,
            "error_rate": 0.0,
            "iki_mean": 0.0,
            "iki_std": 0.0,
            "burst_length": 0.0,
            "burst_count": 0,
            "seconds_since_last_key": round(now - self._last_key_timestamp, 1)
            if self._last_key_timestamp
            else None,
            "activity_timestamps": [],
        }

    def _prune(self, now: float) -> None:
        cutoff = now - self.window_seconds
        while self.samples and self.samples[0].timestamp < cutoff:
            self.samples.popleft()

    @staticmethod
    def _inter_key_intervals(samples: list[KeySample]) -> list[float]:
        intervals: list[float] = []
        previous_timestamp: float | None = None
        for sample in samples:
            if previous_timestamp is not None:
                intervals.append(sample.timestamp - previous_timestamp)
            previous_timestamp = sample.timestamp
        return intervals

    @staticmethod
    def _burst_lengths(samples: list[KeySample]) -> list[int]:
        burst_lengths: list[int] = []
        current_burst = 0
        previous_timestamp: float | None = None

        for sample in samples:
            if previous_timestamp is None or sample.timestamp - previous_timestamp <= BURST_PAUSE_SECONDS:
                current_burst += 1
            else:
                burst_lengths.append(current_burst)
                current_burst = 1
            previous_timestamp = sample.timestamp

        if current_burst:
            burst_lengths.append(current_burst)

        return burst_lengths

    @staticmethod
    def _std(values: list[float]) -> float:
        if len(values) < 2:
            return 0.0
        mean = sum(values) / len(values)
        variance = sum((value - mean) ** 2 for value in values) / (len(values) - 1)
        return math.sqrt(max(variance, 0.0))

    @staticmethod
    def _is_printable(key) -> bool:
        char = getattr(key, "char", None)
        return isinstance(char, str) and len(char) == 1 and char.isprintable()
