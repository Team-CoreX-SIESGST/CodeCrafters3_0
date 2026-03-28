from __future__ import annotations

import threading
import time
from collections import deque
from typing import Deque


class CameraMonitor:
    def __init__(self, window_seconds: float = 60.0, event_callback=None) -> None:
        self.window_seconds = window_seconds
        self.event_callback = event_callback
        self._lock = threading.Lock()
        self._samples: Deque[tuple[float, float]] = deque()
        self._status = "unavailable"
        self._message = "Camera monitor unavailable: install cv2 + mediapipe to enable PERCLOS."
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        self._thread = threading.Thread(target=self._probe_loop, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        if self._thread is not None:
            self._thread.join(timeout=1.0)

    def snapshot(self) -> dict[str, float | str | None]:
        with self._lock:
            now = time.time()
            self._prune(now)
            closed_ratios = [value for _, value in self._samples]

            if closed_ratios:
                perclos = sum(closed_ratios) / len(closed_ratios)
            else:
                perclos = None

            return {
                "perclos": round(perclos, 3) if perclos is not None else None,
                "status": self._status,
                "message": self._message,
            }

    def _probe_loop(self) -> None:
        try:
            import cv2  # type: ignore
            import mediapipe as mp  # type: ignore  # noqa: F401
        except Exception:
            return

        self._set_status("ready", "Camera libraries detected, but live eye tracking is not configured yet.")

        capture = cv2.VideoCapture(0)
        if not capture.isOpened():
            self._set_status("unavailable", "Camera detected but could not be opened.")
            return

        self._set_status("ready", "Camera opened. PERCLOS placeholder is active.")
        try:
            while not self._stop_event.is_set():
                ok, _frame = capture.read()
                now = time.time()
                if ok:
                    with self._lock:
                        self._samples.append((now, 0.0))
                        self._prune(now)
                time.sleep(1.0)
        finally:
            capture.release()

    def _prune(self, now: float) -> None:
        cutoff = now - self.window_seconds
        while self._samples and self._samples[0][0] < cutoff:
            self._samples.popleft()

    def _set_status(self, status: str, message: str) -> None:
        with self._lock:
            self._status = status
            self._message = message
