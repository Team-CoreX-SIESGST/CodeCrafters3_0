from __future__ import annotations

import math
import time
from dataclasses import dataclass, field
from collections import deque
from typing import Deque

# ---------------------------------------------------------------------------
# Feature names used throughout the classifier
# ---------------------------------------------------------------------------
FEATURE_NAMES = (
    "iki_mean",
    "iki_std",
    "error_rate",
    "burst_length",
    "cursor_speed",
    "path_linearity",
    "click_dwell",
    "idle_ratio",
    "perclos",
)

# ---------------------------------------------------------------------------
# Scoring weights per state — tuned to HCI research signatures
# Higher weight = stronger signal for that state
# ---------------------------------------------------------------------------
FOCUSED_RULES: list[tuple[str, str, float, int]] = [
    # (feature, direction, z_threshold, points)
    ("iki_std",       "below", -0.5,  2),
    ("path_linearity","above",  0.5,  2),
    ("burst_length",  "above",  0.5,  2),
    ("error_rate",    "below", -0.5,  1),
    ("click_dwell",   "below", -0.5,  1),
    ("idle_ratio",    "below", -0.5,  1),
]

CONFUSED_RULES: list[tuple[str, str, float, int]] = [
    ("iki_std",        "above",  1.5,  3),
    ("path_linearity", "below", -1.5,  3),
    ("error_rate",     "above",  1.0,  2),
    ("click_dwell",    "above",  1.0,  2),
    ("burst_length",   "below", -0.5,  1),
    ("idle_ratio",     "above",  0.8,  1),
]

FATIGUED_RULES: list[tuple[str, str, float, int]] = [
    ("iki_mean",    "above",  1.5,  3),
    ("error_rate",  "above",  1.5,  3),
    ("idle_ratio",  "above",  1.5,  3),
    ("cursor_speed","below", -1.0,  2),
    ("click_dwell", "above",  1.0,  2),
    ("iki_std",     "above",  0.8,  1),
]

# PERCLOS bonus points applied separately (not z-score based)
PERCLOS_FATIGUE_BONUS   = 5   # perclos > 0.15
PERCLOS_FATIGUE_LIGHT   = 2   # perclos > 0.08
PERCLOS_CONFUSED_BONUS  = 1   # perclos > 0.05 (drowsy eyes = harder to focus = confusion-like)


# ---------------------------------------------------------------------------
# Welford online running statistics — numerically stable mean + std
# ---------------------------------------------------------------------------
@dataclass(slots=True)
class RunningStat:
    count: int   = 0
    mean:  float = 0.0
    m2:    float = 0.0

    def update(self, value: float) -> None:
        self.count += 1
        delta        = value - self.mean
        self.mean   += delta / self.count
        delta2       = value - self.mean
        self.m2     += delta * delta2

    @property
    def std(self) -> float:
        if self.count < 2:
            return 0.0
        return math.sqrt(self.m2 / (self.count - 1))

    @property
    def variance(self) -> float:
        if self.count < 2:
            return 0.0
        return self.m2 / (self.count - 1)


# ---------------------------------------------------------------------------
# Exponential-weighted moving average stat for adaptive baseline
# After calibration the baseline slowly drifts with the user's behaviour
# ---------------------------------------------------------------------------
@dataclass(slots=True)
class EWMAStat:
    alpha:      float = 0.05   # slow drift — 0.05 = ~20-sample window
    mean:       float = 0.0
    var:        float = 0.0
    initialised: bool = False

    def update(self, value: float) -> None:
        if not self.initialised:
            self.mean        = value
            self.var         = 0.0
            self.initialised = True
            return
        diff       = value - self.mean
        self.mean += self.alpha * diff
        self.var   = (1 - self.alpha) * (self.var + self.alpha * diff * diff)

    @property
    def std(self) -> float:
        return math.sqrt(max(self.var, 1e-9))


# ---------------------------------------------------------------------------
# Data containers
# ---------------------------------------------------------------------------
@dataclass(slots=True)
class FeatureVector:
    iki_mean:       float        = 0.0
    iki_std:        float        = 0.0
    error_rate:     float        = 0.0
    burst_length:   float        = 0.0
    cursor_speed:   float        = 0.0
    path_linearity: float        = 0.0
    click_dwell:    float        = 0.0
    idle_ratio:     float        = 0.0
    perclos:        float | None = None

    def to_dict(self) -> dict[str, float | None]:
        return {
            "iki_mean":       round(self.iki_mean,       3),
            "iki_std":        round(self.iki_std,        3),
            "error_rate":     round(self.error_rate,     3),
            "burst_length":   round(self.burst_length,   2),
            "cursor_speed":   round(self.cursor_speed,   2),
            "path_linearity": round(self.path_linearity, 3),
            "click_dwell":    round(self.click_dwell,    3),
            "idle_ratio":     round(self.idle_ratio,     3),
            "perclos":        round(self.perclos, 3) if self.perclos is not None else None,
        }


@dataclass
class ClassificationResult:
    state:                str
    confidence:           float
    message:              str
    scores:               dict[str, int]
    z_scores:             dict[str, float]
    calibration_progress: float
    baseline_ready:       bool
    baseline_samples:     int
    active_features:      FeatureVector
    baseline_means:       dict[str, float]
    baseline_stds:        dict[str, float]
    rule_hits:            dict[str, list[str]]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def clamp(value: float, minimum: float = 0.0, maximum: float = 1.0) -> float:
    return max(minimum, min(maximum, value))


def _apply_rules(
    rules: list[tuple[str, str, float, int]],
    z_scores: dict[str, float],
) -> tuple[int, list[str]]:
    """Return (total_points, list_of_triggered_rule_descriptions)."""
    total = 0
    hits: list[str] = []
    for feature, direction, threshold, points in rules:
        z = z_scores.get(feature, 0.0)
        if direction == "above" and z >= threshold:
            total += points
            hits.append(f"{feature} z={z:.2f} ≥ {threshold} (+{points})")
        elif direction == "below" and z <= threshold:
            total += points
            hits.append(f"{feature} z={z:.2f} ≤ {threshold} (+{points})")
    return total, hits


# ---------------------------------------------------------------------------
# Main classifier
# ---------------------------------------------------------------------------
class CognitiveStateClassifier:
    """
    Two-phase classifier:

    Phase 1 – Calibration (first `calibration_seconds`):
        Collects Welford statistics to build a solid personal baseline.
        Reports state = "calibrating" during this phase.

    Phase 2 – Classification (after calibration):
        Computes z-scores against the personal baseline.
        Applies weighted rule-based scoring for focused / confused / fatigued.
        EWMA gently updates the baseline to track long-term drift.

    Stability:
        A temporal smoothing deque of the last N raw states prevents
        single-window flicker.  The final label must appear in the majority
        of recent windows before it is emitted.
    """

    SMOOTHING_WINDOW = 5   # number of recent windows to smooth over

    def __init__(
        self,
        calibration_seconds: float = 300.0,
        minimum_samples: int = 20,
    ) -> None:
        self.calibration_seconds = calibration_seconds
        self.minimum_samples     = minimum_samples
        self.started_at          = time.time()

        # Welford stats — used during calibration
        self._cal_stats:  dict[str, RunningStat] = {n: RunningStat() for n in FEATURE_NAMES}

        # EWMA stats — used after calibration to slowly adapt
        self._ewma_stats: dict[str, EWMAStat]    = {n: EWMAStat()    for n in FEATURE_NAMES}
        self._ewma_ready = False

        # Temporal smoothing buffer
        self._state_buffer: Deque[str] = deque(maxlen=self.SMOOTHING_WINDOW)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------
    def classify(
        self,
        features: FeatureVector,
        now: float | None = None,
    ) -> ClassificationResult:
        current_time = now if now is not None else time.time()
        elapsed      = current_time - self.started_at
        progress     = clamp(elapsed / self.calibration_seconds)

        # ---- Phase 1: calibration ----------------------------------------
        if progress < 1.0:
            self._update_calibration(features)
            min_samples = self._min_sample_count()
            result = ClassificationResult(
                state                = "calibrating",
                confidence           = 0.55 + 0.35 * progress,
                message              = (
                    f"Calibrating your personal baseline "
                    f"({int(progress * 100)}% — {min_samples} samples)."
                ),
                scores               = {"focused": 0, "confused": 0, "fatigued": 0},
                z_scores             = {},
                calibration_progress = round(progress, 3),
                baseline_ready       = False,
                baseline_samples     = min_samples,
                active_features      = features,
                baseline_means       = self._cal_means(),
                baseline_stds        = self._cal_stds(),
                rule_hits            = {},
            )
            return result

        # ---- Seed EWMA from calibration stats once -----------------------
        if not self._ewma_ready:
            self._seed_ewma_from_calibration()
            self._ewma_ready = True

        # ---- Phase 2: classify -------------------------------------------
        self._update_ewma(features)
        z_scores   = self._compute_z_scores(features)
        scores, rule_hits = self._score_all_states(features, z_scores)
        raw_state  = self._pick_state(scores)

        # Temporal smoothing
        self._state_buffer.append(raw_state)
        smoothed_state = self._smooth_state()

        confidence = self._compute_confidence(smoothed_state, scores, features)
        message    = self._build_message(smoothed_state, features, z_scores)
        min_samples = self._min_sample_count()

        return ClassificationResult(
            state                = smoothed_state,
            confidence           = round(confidence, 2),
            message              = message,
            scores               = scores,
            z_scores             = {k: round(v, 2) for k, v in z_scores.items()},
            calibration_progress = round(progress, 3),
            baseline_ready       = True,
            baseline_samples     = min_samples,
            active_features      = features,
            baseline_means       = self._ewma_means(),
            baseline_stds        = self._ewma_stds(),
            rule_hits            = rule_hits,
        )

    # ------------------------------------------------------------------
    # Calibration helpers
    # ------------------------------------------------------------------
    def _update_calibration(self, features: FeatureVector) -> None:
        for name in FEATURE_NAMES:
            value = getattr(features, name)
            if value is None:
                continue
            self._cal_stats[name].update(float(value))

    def _seed_ewma_from_calibration(self) -> None:
        for name in FEATURE_NAMES:
            stat = self._cal_stats[name]
            if stat.count == 0:
                continue
            ewma = self._ewma_stats[name]
            ewma.mean        = stat.mean
            ewma.var         = stat.variance
            ewma.initialised = True

    def _min_sample_count(self) -> int:
        counts = [s.count for s in self._cal_stats.values() if s.count > 0]
        return min(counts) if counts else 0

    def _cal_means(self) -> dict[str, float]:
        return {n: round(s.mean, 3) for n, s in self._cal_stats.items() if s.count > 0}

    def _cal_stds(self) -> dict[str, float]:
        return {n: round(s.std, 3) for n, s in self._cal_stats.items() if s.count > 0}

    # ------------------------------------------------------------------
    # EWMA helpers
    # ------------------------------------------------------------------
    def _update_ewma(self, features: FeatureVector) -> None:
        for name in FEATURE_NAMES:
            value = getattr(features, name)
            if value is None:
                continue
            self._ewma_stats[name].update(float(value))

    def _ewma_means(self) -> dict[str, float]:
        return {n: round(s.mean, 3) for n, s in self._ewma_stats.items() if s.initialised}

    def _ewma_stds(self) -> dict[str, float]:
        return {n: round(s.std, 3) for n, s in self._ewma_stats.items() if s.initialised}

    # ------------------------------------------------------------------
    # Z-score computation
    # ------------------------------------------------------------------
    def _compute_z_scores(self, features: FeatureVector) -> dict[str, float]:
        z: dict[str, float] = {}
        for name in FEATURE_NAMES:
            value = getattr(features, name)
            if value is None:
                continue
            stat = self._ewma_stats[name]
            if not stat.initialised or stat.std < 1e-6:
                z[name] = 0.0
            else:
                z[name] = (float(value) - stat.mean) / stat.std
        return z

    # ------------------------------------------------------------------
    # Scoring
    # ------------------------------------------------------------------
    def _score_all_states(
        self,
        features: FeatureVector,
        z_scores: dict[str, float],
    ) -> tuple[dict[str, int], dict[str, list[str]]]:
        focused_pts,  focused_hits  = _apply_rules(FOCUSED_RULES,  z_scores)
        confused_pts, confused_hits = _apply_rules(CONFUSED_RULES, z_scores)
        fatigued_pts, fatigued_hits = _apply_rules(FATIGUED_RULES, z_scores)

        # PERCLOS bonus — camera is more reliable than typing when available
        if features.perclos is not None:
            if features.perclos > 0.15:
                fatigued_pts += PERCLOS_FATIGUE_BONUS
                fatigued_hits.append(f"PERCLOS={features.perclos:.3f} > 0.15 (+{PERCLOS_FATIGUE_BONUS})")
            elif features.perclos > 0.08:
                fatigued_pts += PERCLOS_FATIGUE_LIGHT
                fatigued_hits.append(f"PERCLOS={features.perclos:.3f} > 0.08 (+{PERCLOS_FATIGUE_LIGHT})")
            if features.perclos > 0.05:
                confused_pts += PERCLOS_CONFUSED_BONUS
                confused_hits.append(f"PERCLOS={features.perclos:.3f} > 0.05 (+{PERCLOS_CONFUSED_BONUS})")

        scores    = {"focused": focused_pts, "confused": confused_pts, "fatigued": fatigued_pts}
        rule_hits = {"focused": focused_hits, "confused": confused_hits, "fatigued": fatigued_hits}
        return scores, rule_hits

    @staticmethod
    def _pick_state(scores: dict[str, int]) -> str:
        """
        Pick the highest-scoring state.
        Tie-break: confused > fatigued > focused
        (confusion is the most actionable state for a hackathon demo)
        """
        top_score = max(scores.values())
        if top_score <= 0:
            return "focused"   # default when no signals fire

        # Collect all states at the top score
        top_states = [state for state, pts in scores.items() if pts == top_score]

        if len(top_states) == 1:
            return top_states[0]

        # Tie-break priority
        for preferred in ("confused", "fatigued", "focused"):
            if preferred in top_states:
                return preferred
        return top_states[0]

    def _smooth_state(self) -> str:
        """Return the majority state in the recent smoothing buffer."""
        if not self._state_buffer:
            return "focused"
        counts: dict[str, int] = {}
        for s in self._state_buffer:
            counts[s] = counts.get(s, 0) + 1
        return max(counts, key=lambda k: counts[k])

    # ------------------------------------------------------------------
    # Confidence
    # ------------------------------------------------------------------
    @staticmethod
    def _compute_confidence(
        state: str,
        scores: dict[str, int],
        features: FeatureVector,
    ) -> float:
        top_score      = scores[state]
        other_max      = max((v for k, v in scores.items() if k != state), default=0)
        margin         = max(top_score - other_max, 0)

        # Base: 0.50 floor, rises with score magnitude and margin
        confidence = 0.50 + clamp(top_score / 14.0) * 0.30 + clamp(margin / 6.0) * 0.15

        # Camera gives a hard boost when it agrees with the classification
        if features.perclos is not None and state == "fatigued" and features.perclos > 0.15:
            confidence += 0.10
        if features.perclos is not None and state == "focused" and features.perclos < 0.05:
            confidence += 0.05

        return clamp(confidence, 0.50, 0.97)

    # ------------------------------------------------------------------
    # Human-readable messages
    # ------------------------------------------------------------------
    @staticmethod
    def _build_message(
        state: str,
        features: FeatureVector,
        z_scores: dict[str, float],
    ) -> str:
        if state == "focused":
            rhythm_note = (
                "Typing rhythm is consistent and pointer movement is purposeful."
                if z_scores.get("iki_std", 0.0) < -0.3
                else "Signals are within your focused baseline."
            )
            return rhythm_note

        if state == "confused":
            parts: list[str] = []
            if z_scores.get("iki_std", 0.0) > 1.5:
                parts.append("irregular typing rhythm")
            if z_scores.get("path_linearity", 0.0) < -1.5:
                parts.append("wandering mouse path")
            if z_scores.get("error_rate", 0.0) > 1.0:
                parts.append("elevated error rate")
            if z_scores.get("click_dwell", 0.0) > 1.0:
                parts.append("long hover hesitation")
            base = "Signals suggest confusion or exploration"
            return f"{base}: {', '.join(parts)}." if parts else f"{base}."

        # fatigued
        if features.perclos is not None and features.perclos > 0.15:
            return (
                f"Fatigue detected — eyes closed {int(features.perclos * 100)}% "
                f"of the last 60 s (PERCLOS). Consider a break."
            )
        parts = []
        if z_scores.get("iki_mean", 0.0) > 1.5:
            parts.append("typing is slowing down")
        if z_scores.get("idle_ratio", 0.0) > 1.5:
            parts.append("more idle gaps than usual")
        if z_scores.get("error_rate", 0.0) > 1.5:
            parts.append("rising error rate")
        base = "Fatigue signals are elevated"
        return f"{base}: {', '.join(parts)}." if parts else f"{base}."