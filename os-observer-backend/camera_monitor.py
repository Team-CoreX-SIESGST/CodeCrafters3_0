"""
camera_monitor.py  (enhanced)
──────────────────────────────
Extends the original PERCLOS monitor with:

  BLINK DETECTION
    • Counts blinks over a rolling 60-second window.
    • Normal rate: 12-20 blinks/min.
    • LOW  (<8/min)  -> intense focus, possible eye strain signal.
    • HIGH (>30/min) -> fatigue signal.
    • Uses an EAR-threshold state machine (OPEN -> CLOSING -> BLINK).

  FACIAL EXPRESSION HINTS
    • "neutral"   - baseline
    • "concerned" - inner eyebrows furrowed (confusion proxy)
    • "surprised" - eyebrows raised (discovery / alertness)
    • "squinting" - eyes partially closed without full closure (strain)

MediaPipe landmark indices used:
  LEFT_EYE  = (33, 160, 158, 133, 153, 144)
  RIGHT_EYE = (362, 385, 387, 263, 373, 380)
  MOUTH     = (61, 291, 0, 17)
  INNER_BROW_L = 105   INNER_BROW_R = 334
  EYE_TOP_L    = 159   EYE_TOP_R    = 386
"""
from __future__ import annotations

import math
import threading
import time
from collections import deque
from typing import Deque, Optional


NOSE_TIP      = 1
LEFT_EYE      = (33, 160, 158, 133, 153, 144)
RIGHT_EYE     = (362, 385, 387, 263, 373, 380)
MOUTH_CORNERS = (61, 291)
MOUTH_LIP_TOP = 0
MOUTH_LIP_BOT = 17
INNER_BROW_L  = 105
INNER_BROW_R  = 334
EYE_TOP_L     = 159
EYE_TOP_R     = 386

EAR_OPEN_RATIO         = 0.76
MIN_BLINK_FRAMES       = 2
MAX_BLINK_FRAMES       = 14
BLINK_ROLLING_WINDOW_S = 60.0
HEAD_MOVEMENT_WINDOW_S = 5.0

BROW_FURROW_RATIO = 0.88
BROW_RAISE_RATIO  = 1.08  # Lowered from 1.14 to make 'surprised' easier to trigger!
EAR_SQUINT_RATIO  = 0.85
RIGOROUS_HEAD_MOVEMENT_THRESHOLD = 0.12


def clamp(value: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, value))


class CameraMonitor:
    def __init__(
        self,
        window_seconds: float = 60.0,
        sample_interval_seconds: float = 0.30,
        event_callback=None,
    ) -> None:
        self.window_seconds = window_seconds
        self.sample_interval_seconds = sample_interval_seconds
        self.event_callback = event_callback

        self._lock = threading.Lock()
        self._samples: Deque[tuple[float, float]] = deque()
        self._ear_samples: Deque[tuple[float, float]] = deque()
        self._baseline_ears: Deque[float] = deque(maxlen=120)
        self._face_centers: Deque[tuple[float, float, float]] = deque()

        self._blink_state = "open"
        self._blink_frames = 0
        self._blink_events: Deque[float] = deque()

        self._brow_baseline: Optional[float] = None

        self._status = "unavailable"
        self._message = "Camera monitor unavailable: install cv2 + mediapipe."
        self._face_detected = False
        self._eye_aspect_ratio: Optional[float] = None
        self._mouth_open_ratio: Optional[float] = None
        self._closed_threshold: Optional[float] = None
        self._expression = "neutral"
        self._frames_processed = 0
        self._last_status_sig: Optional[tuple[str, str]] = None

        self._stop_event = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self.latest_frame_rgb = None

    def get_latest_frame(self):
        with self._lock:
            return self.latest_frame_rgb

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._probe_loop, daemon=True, name="CameraMonitor")
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=1.5)

    def snapshot(self) -> dict:
        with self._lock:
            now = time.time()
            self._prune_all(now)

            closed_vals = [v for _, v in self._samples]
            ear_vals = [v for _, v in self._ear_samples]
            perclos = sum(closed_vals) / len(closed_vals) if closed_vals else None
            ear_mean = sum(ear_vals) / len(ear_vals) if ear_vals else None

            blink_window = [t for t in self._blink_events if t >= now - BLINK_ROLLING_WINDOW_S]
            elapsed_min = min(BLINK_ROLLING_WINDOW_S, now - (blink_window[0] if blink_window else now)) / 60.0
            blink_rate = len(blink_window) / max(elapsed_min, 1 / 60) if blink_window else 0.0
            low_blink = self._face_detected and blink_rate < 8 and len(blink_window) > 0
            head_motion = self._head_movement_intensity()
            rigorous_head_movement = self._face_detected and head_motion > RIGOROUS_HEAD_MOVEMENT_THRESHOLD

            return {
                "perclos": round(perclos, 3) if perclos is not None else None,
                "ear_mean": round(ear_mean, 3) if ear_mean is not None else None,
                "status": self._status,
                "message": self._message,
                "face_detected": self._face_detected,
                "eye_aspect_ratio": round(self._eye_aspect_ratio, 3) if self._eye_aspect_ratio is not None else None,
                "mouth_open_ratio": round(self._mouth_open_ratio, 3) if self._mouth_open_ratio is not None else None,
                "closed_threshold": round(self._closed_threshold, 3) if self._closed_threshold is not None else None,
                "sample_count": len(closed_vals),
                "frames_processed": self._frames_processed,
                "blink_rate_per_min": round(blink_rate, 1),
                "blink_count_60s": len(blink_window),
                "low_blink_rate": low_blink,
                "blink_rate_class": _classify_blink_rate(blink_rate, self._face_detected),
                "head_movement_intensity": round(head_motion, 3),
                "head_movement_class": _classify_head_movement(head_motion, self._face_detected),
                "rigorous_head_movement": rigorous_head_movement,
                "expression": self._expression,
            }

    def _probe_loop(self) -> None:
        try:
            import cv2  # type: ignore
            import mediapipe as mp  # type: ignore
            
            try:
                from ultralytics import YOLO
                self.yolo_model = YOLO("yolov8n.pt")
            except ImportError:
                self.yolo_model = None
                
        except Exception:
            self._set_status("unavailable", "Camera unavailable: install cv2 + mediapipe.")
            return

        self._set_status("initializing", "Opening camera...")
        cap = cv2.VideoCapture(0)
        if not cap.isOpened():
            self._set_status("unavailable", "Camera detected but could not open.")
            return

        cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 360)

        face_mesh = mp.solutions.face_mesh.FaceMesh(
            max_num_faces=1,
            refine_landmarks=True,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5,
        )

        last_sample_at = 0.0
        try:
            while not self._stop_event.is_set():
                ok, frame = cap.read()
                now = time.time()
                if not ok:
                    self._set_status("degraded", "Camera frame read failed.")
                    time.sleep(self.sample_interval_seconds)
                    continue

                self._frames_processed += 1
                
                if now - last_sample_at < self.sample_interval_seconds:
                    continue

                rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                
                with self._lock:
                    self.latest_frame_rgb = rgb.copy()
                    
                res = face_mesh.process(rgb)
                lm = res.multi_face_landmarks[0].landmark if res.multi_face_landmarks else None

                if lm is None:
                    self._record_no_face(now)
                    self._set_status("searching", "Camera active - no face detected.")
                    last_sample_at = now
                    continue

                ear = self._average_ear(lm)
                self._record_face_center(now, lm)
                self._baseline_ears.append(ear)
                threshold = self._closed_threshold_from_baseline()
                is_closed = float(ear < threshold)
                self._record_sample(now, is_closed, ear=ear, threshold=threshold)

                self._update_blink_state(ear, threshold, now)

                mar = self._mouth_aspect_ratio(lm)
                expr = self._detect_expression(lm, ear, threshold, mar)

                # --- YOLO Object Detection for Phone ---
                if hasattr(self, 'yolo_model') and self.yolo_model is not None and self._frames_processed % 4 == 0:
                    try:
                        results = self.yolo_model(rgb, classes=[67], verbose=False)
                        if len(results[0].boxes) > 0:
                            expr = "distracted (phone in hand)"
                    except Exception:
                        pass
                # ---------------------------------------

                with self._lock:
                    self._face_detected = True
                    self._eye_aspect_ratio = ear
                    self._mouth_open_ratio = mar
                    self._closed_threshold = threshold
                    self._expression = expr
                    self.latest_frame_rgb = rgb.copy()

                self._set_status("tracking", f"Tracking - {expr}")
                last_sample_at = now
        finally:
            face_mesh.close()
            cap.release()

    def _update_blink_state(self, ear: float, threshold: float, now: float) -> None:
        closing = ear < threshold

        with self._lock:
            if self._blink_state == "open":
                if closing:
                    self._blink_state = "closing"
                    self._blink_frames = 1
            elif self._blink_state == "closing":
                if closing:
                    self._blink_frames += 1
                    if self._blink_frames > MAX_BLINK_FRAMES:
                        self._blink_state = "open"
                else:
                    if self._blink_frames >= MIN_BLINK_FRAMES:
                        self._blink_events.append(now)
                    self._blink_state = "open"
                    self._blink_frames = 0

    def _detect_expression(self, lm, ear: float, threshold: float, mar: float) -> str:
        # 1. Check Head Pose (Pitch) to detect looking down at phone
        try:
            nose_y = lm[1].y
            chin_y = lm[152].y
            forehead_y = lm[10].y
            
            nose_to_chin = abs(chin_y - nose_y)
            forehead_to_nose = abs(nose_y - forehead_y)
            
            # If the distance from forehead to nose is vastly larger than nose to chin, 
            # the user's head is pitched severely downward (looking at phone/lap).
            if nose_to_chin > 0 and (forehead_to_nose / nose_to_chin) > 1.35:
                return "distracted (phone)"
        except Exception:
            pass

        # 2. Check expressions
        open_ref = self._open_eye_reference()
        if open_ref and threshold < ear < open_ref * EAR_SQUINT_RATIO:
            return "squinting"

        try:
            il = lm[INNER_BROW_L]
            ir = lm[INNER_BROW_R]
            el = lm[EYE_TOP_L]
            er = lm[EYE_TOP_R]

            brow_gap = math.hypot(il.x - ir.x, il.y - ir.y)

            if self._brow_baseline is None:
                self._brow_baseline = brow_gap
            else:
                self._brow_baseline = self._brow_baseline * 0.98 + brow_gap * 0.02

            baseline = self._brow_baseline
            ratio = brow_gap / max(baseline, 1e-6)

            if ratio < BROW_FURROW_RATIO:
                return "concerned"
            if ratio > BROW_RAISE_RATIO:
                return "surprised"
        except (IndexError, AttributeError):
            pass

        return "neutral"

    def _record_sample(self, now: float, closed: float, *, ear: float, threshold: float) -> None:
        with self._lock:
            self._samples.append((now, closed))
            self._ear_samples.append((now, ear))
            self._face_detected = True
            self._closed_threshold = threshold
            self._prune_all(now)

    def _record_no_face(self, now: float) -> None:
        with self._lock:
            self._face_detected = False
            self._expression = "neutral"
            self._prune_all(now)

    def _record_face_center(self, now: float, lm) -> None:
        try:
            nose = lm[NOSE_TIP]
        except (IndexError, TypeError):
            return
        with self._lock:
            self._face_centers.append((now, float(nose.x), float(nose.y)))
            self._prune_all(now)

    def _prune_all(self, now: float) -> None:
        cutoff = now - self.window_seconds
        while self._samples and self._samples[0][0] < cutoff:
            self._samples.popleft()
        while self._ear_samples and self._ear_samples[0][0] < cutoff:
            self._ear_samples.popleft()
        head_cutoff = now - HEAD_MOVEMENT_WINDOW_S
        while self._face_centers and self._face_centers[0][0] < head_cutoff:
            self._face_centers.popleft()
        blink_cutoff = now - BLINK_ROLLING_WINDOW_S
        while self._blink_events and self._blink_events[0] < blink_cutoff:
            self._blink_events.popleft()

    def _head_movement_intensity(self) -> float:
        if len(self._face_centers) < 2:
            return 0.0
        total_motion = 0.0
        start_ts = self._face_centers[0][0]
        end_ts = self._face_centers[-1][0]
        previous = self._face_centers[0]
        for current in list(self._face_centers)[1:]:
            total_motion += math.hypot(current[1] - previous[1], current[2] - previous[2])
            previous = current
        elapsed = max(end_ts - start_ts, 1e-3)
        return total_motion / elapsed

    def _closed_threshold_from_baseline(self) -> float:
        if not self._baseline_ears:
            return 0.21
        ordered = sorted(self._baseline_ears)
        top_half = ordered[len(ordered) // 2 :]
        open_ref = sum(top_half) / len(top_half)
        return clamp(open_ref * EAR_OPEN_RATIO, 0.17, 0.30)

    def _open_eye_reference(self) -> Optional[float]:
        if not self._baseline_ears:
            return None
        ordered = sorted(self._baseline_ears)
        top_half = ordered[len(ordered) // 2 :]
        return sum(top_half) / len(top_half)

    def _set_status(self, status: str, message: str) -> None:
        with self._lock:
            self._status = status
            self._message = message
        sig = (status, message)
        if self.event_callback and sig != self._last_status_sig:
            self.event_callback(f"Camera: {message}", persist=False)
        self._last_status_sig = sig

    @staticmethod
    def _average_ear(lm) -> float:
        return (
            CameraMonitor._eye_aspect_ratio(lm, LEFT_EYE)
            + CameraMonitor._eye_aspect_ratio(lm, RIGHT_EYE)
        ) / 2.0

    @staticmethod
    def _eye_aspect_ratio(lm, idxs: tuple[int, int, int, int, int, int]) -> float:
        p1, p2, p3, p4, p5, p6 = [lm[i] for i in idxs]
        horiz = CameraMonitor._dist(p1, p4)
        if horiz <= 1e-6:
            return 0.0
        vert = CameraMonitor._dist(p2, p6) + CameraMonitor._dist(p3, p5)
        return vert / (2.0 * horiz)

    @staticmethod
    def _mouth_aspect_ratio(lm) -> float:
        left = lm[MOUTH_CORNERS[0]]
        right = lm[MOUTH_CORNERS[1]]
        top = lm[MOUTH_LIP_TOP]
        bottom = lm[MOUTH_LIP_BOT]
        width = CameraMonitor._dist(left, right)
        if width <= 1e-6:
            return 0.0
        return CameraMonitor._dist(top, bottom) / width

    @staticmethod
    def _dist(a, b) -> float:
        return math.hypot(a.x - b.x, a.y - b.y)


def _classify_blink_rate(blink_rate: float, face_detected: bool) -> str:
    if not face_detected:
        return "no_data"
    if blink_rate < 8:
        return "low"
    if blink_rate > 30:
        return "high"
    if 12 <= blink_rate <= 20:
        return "normal"
    return "moderate"


def _classify_head_movement(head_motion: float, face_detected: bool) -> str:
    if not face_detected:
        return "no_data"
    if head_motion > RIGOROUS_HEAD_MOVEMENT_THRESHOLD:
        return "rigorous"
    if head_motion > RIGOROUS_HEAD_MOVEMENT_THRESHOLD * 0.55:
        return "active"
    return "steady"
