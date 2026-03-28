#camera_monitor.py

from __future__ import annotations

import math
import threading
import time
from collections import deque
from typing import Deque


LEFT_EYE = (33, 160, 158, 133, 153, 144)
RIGHT_EYE = (362, 385, 387, 263, 373, 380)


def clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


class CameraMonitor:
    def __init__(
        self,
        window_seconds: float = 60.0,
        sample_interval_seconds: float = 0.35,
        event_callback=None,
    ) -> None:
        self.window_seconds = window_seconds
        self.sample_interval_seconds = sample_interval_seconds
        self.event_callback = event_callback
        self._lock = threading.Lock()
        self._samples: Deque[tuple[float, float]] = deque()
        self._baseline_ears: Deque[float] = deque(maxlen=120)
        self._status = "unavailable"
        self._message = "Camera monitor unavailable: install cv2 + mediapipe to enable PERCLOS."
        self._face_detected = False
        self._eye_aspect_ratio: float | None = None
        self._closed_threshold: float | None = None
        self._frames_processed = 0
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None
        self._last_status_signature: tuple[str, str] | None = None

    def start(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._probe_loop, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        if self._thread is not None:
            self._thread.join(timeout=1.0)

    def snapshot(self) -> dict[str, float | str | bool | None]:
        with self._lock:
            now = time.time()
            self._prune(now)
            closed_ratios = [value for _, value in self._samples]
            perclos = sum(closed_ratios) / len(closed_ratios) if closed_ratios else None
            return {
                "perclos": round(perclos, 3) if perclos is not None else None,
                "status": self._status,
                "message": self._message,
                "face_detected": self._face_detected,
                "eye_aspect_ratio": (
                    round(self._eye_aspect_ratio, 3)
                    if self._eye_aspect_ratio is not None
                    else None
                ),
                "closed_threshold": (
                    round(self._closed_threshold, 3)
                    if self._closed_threshold is not None
                    else None
                ),
                "sample_count": len(closed_ratios),
                "frames_processed": self._frames_processed,
            }

    def _probe_loop(self) -> None:
        try:
            import cv2  # type: ignore
            import mediapipe as mp  # type: ignore
        except Exception:
            self._set_status(
                "unavailable",
                "Camera monitor unavailable: install cv2 + mediapipe to enable PERCLOS.",
            )
            return

        self._set_status("initializing", "Opening camera and eye tracker.")
        capture = cv2.VideoCapture(0)
        if not capture.isOpened():
            self._set_status("unavailable", "Camera detected but could not be opened.")
            return

        capture.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
        capture.set(cv2.CAP_PROP_FRAME_HEIGHT, 360)
        face_mesh = mp.solutions.face_mesh.FaceMesh(
            max_num_faces=1,
            refine_landmarks=True,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5,
        )

        try:
            last_sample_at = 0.0
            while not self._stop_event.is_set():
                ok, frame = capture.read()
                now = time.time()
                if not ok:
                    self._set_status("degraded", "Camera frame read failed.")
                    time.sleep(self.sample_interval_seconds)
                    continue

                self._frames_processed += 1
                if now - last_sample_at < self.sample_interval_seconds:
                    time.sleep(0.03)
                    continue

                rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                result = face_mesh.process(rgb_frame)
                landmarks = (
                    result.multi_face_landmarks[0].landmark
                    if result.multi_face_landmarks
                    else None
                )

                if landmarks is None:
                    self._record_sample(now, None, face_detected=False)
                    self._set_status("searching", "Camera active, waiting for a face.")
                    last_sample_at = now
                    continue

                ear = self._average_ear(landmarks)
                self._baseline_ears.append(ear)
                threshold = self._closed_eye_threshold()
                closed_ratio = 1.0 if ear < threshold else 0.0
                self._record_sample(now, closed_ratio, face_detected=True, ear=ear, threshold=threshold)

                if closed_ratio >= 1.0:
                    self._set_status("tracking", "Face tracked. Eyes currently look closed.")
                else:
                    self._set_status("tracking", "Face tracked. PERCLOS sampling is active.")
                last_sample_at = now
        finally:
            face_mesh.close()
            capture.release()

    def _record_sample(
        self,
        now: float,
        closed_ratio: float | None,
        *,
        face_detected: bool,
        ear: float | None = None,
        threshold: float | None = None,
    ) -> None:
        with self._lock:
            if closed_ratio is not None:
                self._samples.append((now, closed_ratio))
            self._face_detected = face_detected
            self._eye_aspect_ratio = ear
            self._closed_threshold = threshold
            self._prune(now)

    def _closed_eye_threshold(self) -> float:
        if not self._baseline_ears:
            return 0.21
        ordered = sorted(self._baseline_ears)
        top_slice = ordered[max(len(ordered) // 2, 0) :]
        open_eye_reference = sum(top_slice) / len(top_slice)
        return clamp(open_eye_reference * 0.76, 0.18, 0.32)

    def _prune(self, now: float) -> None:
        cutoff = now - self.window_seconds
        while self._samples and self._samples[0][0] < cutoff:
            self._samples.popleft()

    def _set_status(self, status: str, message: str) -> None:
        with self._lock:
            self._status = status
            self._message = message
            signature = (status, message)

        if self.event_callback is not None and signature != self._last_status_signature:
            self.event_callback(f"Camera: {message}", persist=False)
        self._last_status_signature = signature

    @staticmethod
    def _average_ear(landmarks) -> float:
        left = CameraMonitor._eye_aspect_ratio(landmarks, LEFT_EYE)
        right = CameraMonitor._eye_aspect_ratio(landmarks, RIGHT_EYE)
        return (left + right) / 2.0

    @staticmethod
    def _eye_aspect_ratio(landmarks, eye_indices: tuple[int, int, int, int, int, int]) -> float:
        p1, p2, p3, p4, p5, p6 = [landmarks[index] for index in eye_indices]
        horizontal = CameraMonitor._distance(p1, p4)
        if horizontal <= 1e-6:
            return 0.0
        vertical = CameraMonitor._distance(p2, p6) + CameraMonitor._distance(p3, p5)
        return vertical / (2.0 * horizontal)

    @staticmethod
    def _distance(point_a, point_b) -> float:
        return math.hypot(point_a.x - point_b.x, point_a.y - point_b.y)
