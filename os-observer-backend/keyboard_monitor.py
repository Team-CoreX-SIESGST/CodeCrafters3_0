from __future__ import annotations

import threading
import time
from collections import deque
from dataclasses import dataclass
from typing import Deque

from pynput import keyboard


@dataclass(slots=True)
class KeySample:
    timestamp: float
    is_printable: bool
    is_backspace: bool
    is_modifier: bool


class KeyboardMonitor:
    def __init__(self, window_seconds: float = 20.0, event_callback=None) -> None:
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

        if sample.is_backspace:
            self.event_callback("Keyboard: backspace used")
            return

        if key == keyboard.Key.enter:
            self.event_callback("Keyboard: enter pressed")
            return

        if sample.is_printable and now - self._last_typing_log > 2.0:
            self.event_callback("Keyboard: typing activity")
            self._last_typing_log = now

    def snapshot(self) -> dict[str, float | int | None]:
        with self._lock:
            now = time.time()
            self._prune(now)
            samples = list(self.samples)

        if not samples:
            return {
                "wpm": 0.0,
                "keys_per_minute": 0.0,
                "backspace_count": 0,
                "modifier_count": 0,
                "total_keys": 0,
                "seconds_since_last_key": round(now - self._last_key_timestamp, 1)
                if self._last_key_timestamp
                else None,
            }

        duration = max(samples[-1].timestamp - samples[0].timestamp, 1.0)
        printable_chars = sum(1 for sample in samples if sample.is_printable)
        total_keys = len(samples)
        backspace_count = sum(1 for sample in samples if sample.is_backspace)
        modifier_count = sum(1 for sample in samples if sample.is_modifier)
        wpm = (printable_chars / 5.0) / (duration / 60.0)
        keys_per_minute = total_keys / duration * 60.0

        return {
            "wpm": round(wpm, 1),
            "keys_per_minute": round(keys_per_minute, 1),
            "backspace_count": backspace_count,
            "modifier_count": modifier_count,
            "total_keys": total_keys,
            "seconds_since_last_key": round(now - self._last_key_timestamp, 1)
            if self._last_key_timestamp
            else None,
        }

    def _prune(self, now: float) -> None:
        cutoff = now - self.window_seconds
        while self.samples and self.samples[0].timestamp < cutoff:
            self.samples.popleft()

    @staticmethod
    def _is_printable(key) -> bool:
        char = getattr(key, "char", None)
        return isinstance(char, str) and len(char) == 1 and char.isprintable()
