from __future__ import annotations

import math
import time
from collections import deque
from dataclasses import dataclass
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

FEATURE_STD_FLOORS: dict[str, float] = {
    "iki_mean": 0.04,
    "iki_std": 0.04,
    "error_rate": 0.02,
    "burst_length": 0.75,
    "cursor_speed": 25.0,
    "path_linearity": 0.08,
    "click_dwell": 0.03,
    "idle_ratio": 0.03,
    "perclos": 0.03,
}

# ---------------------------------------------------------------------------
# Scoring weights per state — tuned to HCI research signatures
# Higher weight = stronger signal for that state
# ---------------------------------------------------------------------------
FOCUSED_RULES: list[tuple[str, str, float, int]] = [
    ("iki_std",        "below", -0.5, 2),
    ("path_linearity", "above",  0.5, 2),
    ("burst_length",   "above",  0.5, 1),
]

CONFUSED_RULES: list[tuple[str, str, float, int]] = [
    ("iki_std",        "above",  1.5, 2),
    ("path_linearity", "below", -1.5, 2),
    ("error_rate",     "above",  1.0, 1),
]

FATIGUED_RULES: list[tuple[str, str, float, int]] = [
    ("iki_mean",   "above",  1.5, 2),
    ("error_rate", "above",  1.5, 2),
    ("idle_ratio", "above",  1.5, 2),
]

PERCLOS_FATIGUE_BONUS = 3


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

    def export_baseline(self) -> dict[str, object]:
        return {
            "version": 1,
            "calibration_seconds": self.calibration_seconds,
            "minimum_samples": self.minimum_samples,
            "started_at": self.started_at,
            "baseline_ready": self.is_baseline_ready(),
            "calibration_stats": {
                name: {
                    "count": stat.count,
                    "mean": stat.mean,
                    "m2": stat.m2,
                }
                for name, stat in self._cal_stats.items()
                if stat.count > 0
            },
            "ewma_stats": {
                name: {
                    "alpha": stat.alpha,
                    "mean": stat.mean,
                    "var": stat.var,
                    "initialised": stat.initialised,
                }
                for name, stat in self._ewma_stats.items()
                if stat.initialised
            },
            "ewma_ready": self._ewma_ready,
            "state_buffer": list(self._state_buffer),
        }

    def load_baseline(
        self,
        payload: dict[str, object] | None,
        *,
        now: float | None = None,
    ) -> bool:
        if not isinstance(payload, dict):
            return False

        cal_stats = payload.get("calibration_stats")
        ewma_stats = payload.get("ewma_stats")
        if not isinstance(cal_stats, dict) or not isinstance(ewma_stats, dict):
            return False

        restored_any = False
        for name in FEATURE_NAMES:
            item = cal_stats.get(name)
            if not isinstance(item, dict):
                continue
            stat = self._cal_stats[name]
            stat.count = int(item.get("count", 0) or 0)
            stat.mean = float(item.get("mean", 0.0) or 0.0)
            stat.m2 = float(item.get("m2", 0.0) or 0.0)
            restored_any = restored_any or stat.count > 0

        for name in FEATURE_NAMES:
            item = ewma_stats.get(name)
            if not isinstance(item, dict):
                continue
            stat = self._ewma_stats[name]
            stat.alpha = float(item.get("alpha", stat.alpha) or stat.alpha)
            stat.mean = float(item.get("mean", 0.0) or 0.0)
            stat.var = float(item.get("var", 0.0) or 0.0)
            stat.initialised = bool(item.get("initialised", False))
            restored_any = restored_any or stat.initialised

        self._ewma_ready = bool(payload.get("ewma_ready", False))
        self._state_buffer.clear()
        for state in payload.get("state_buffer", []):
            if isinstance(state, str) and state:
                self._state_buffer.append(state)

        if not restored_any:
            return False

        ready = bool(payload.get("baseline_ready", False)) or self.is_baseline_ready()
        current_time = now if now is not None else time.time()
        saved_started_at = float(payload.get("started_at", self.started_at) or self.started_at)
        if ready:
            self.started_at = min(saved_started_at, current_time - self.calibration_seconds)
            self._ewma_ready = True
        else:
            self.started_at = saved_started_at
        return True

    def is_baseline_ready(self) -> bool:
        return self._ewma_ready and self._min_sample_count() >= self.minimum_samples

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
        progress     = 1.0 if self.calibration_seconds <= 0 else clamp(elapsed / self.calibration_seconds)
        self._update_calibration(features)
        min_samples = self._min_sample_count()

        # ---- Phase 1: calibration ----------------------------------------
        if progress < 1.0 or min_samples < self.minimum_samples:
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
        z_scores   = self._compute_z_scores(features)
        scores, rule_hits = self._score_all_states(features, z_scores)
        raw_state  = self._pick_state(scores)

        # Temporal smoothing
        self._state_buffer.append(raw_state)
        smoothed_state = self._smooth_state()
        self._update_ewma(features)

        confidence = self._compute_confidence(smoothed_state, scores, features)
        message    = self._build_message(smoothed_state, features, z_scores)

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
            std = max(stat.std, FEATURE_STD_FLOORS.get(name, 1e-3))
            if not stat.initialised:
                z[name] = 0.0
            else:
                z[name] = (float(value) - stat.mean) / std
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

        if features.perclos is not None:
            if features.perclos > 0.15:
                fatigued_pts += PERCLOS_FATIGUE_BONUS
                fatigued_hits.append(
                    f"PERCLOS={features.perclos:.3f} > 0.15 (+{PERCLOS_FATIGUE_BONUS})"
                )

        scores    = {"focused": focused_pts, "confused": confused_pts, "fatigued": fatigued_pts}
        rule_hits = {"focused": focused_hits, "confused": confused_hits, "fatigued": fatigued_hits}
        return scores, rule_hits

    def _pick_state(self, scores: dict[str, int]) -> str:
        """
        Pick the highest-scoring state.
        If no rule fires, keep the last stable state when possible.
        For ties, preserve the most recent state first, then prefer focused.
        """
        top_score = max(scores.values())
        if top_score <= 0:
            return self._state_buffer[-1] if self._state_buffer else "focused"

        top_states = [state for state, pts in scores.items() if pts == top_score]

        if len(top_states) == 1:
            return top_states[0]

        if self._state_buffer and self._state_buffer[-1] in top_states:
            return self._state_buffer[-1]
        if "focused" in top_states:
            return "focused"
        if "confused" in top_states:
            return "confused"
        return top_states[0]

    def _smooth_state(self) -> str:
        """Return the majority state in the recent smoothing buffer."""
        if not self._state_buffer:
            return "focused"
        counts: dict[str, int] = {}
        for s in self._state_buffer:
            counts[s] = counts.get(s, 0) + 1
        best_count = max(counts.values())
        winners = [state for state, count in counts.items() if count == best_count]
        if len(winners) == 1:
            return winners[0]
        for state in reversed(self._state_buffer):
            if state in winners:
                return state
        return winners[0]

    # ------------------------------------------------------------------
    # Confidence
    # ------------------------------------------------------------------
    @staticmethod
    def _compute_confidence(
        state: str,
        scores: dict[str, int],
        features: FeatureVector,
    ) -> float:
        top_score      = scores.get(state, 0)
        other_max      = max((v for k, v in scores.items() if k != state), default=0)
        margin         = max(top_score - other_max, 0)

        confidence = 0.45 + clamp(top_score / 7.0) * 0.30 + clamp(margin / 3.0) * 0.20

        if features.perclos is not None and state == "fatigued" and features.perclos > 0.15:
            confidence += 0.10
        if features.perclos is not None and state == "focused" and features.perclos < 0.08:
            confidence += 0.05

        return clamp(confidence, 0.45, 0.95)

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
            parts: list[str] = []
            if z_scores.get("iki_std", 0.0) <= -0.5:
                parts.append("stable typing rhythm")
            if z_scores.get("path_linearity", 0.0) >= 0.5:
                parts.append("purposeful pointer movement")
            if z_scores.get("burst_length", 0.0) >= 0.5:
                parts.append("longer typing bursts")
            base = "Focused pattern detected"
            return f"{base}: {', '.join(parts)}." if parts else f"{base}."

        if state == "confused":
            parts: list[str] = []
            if z_scores.get("iki_std", 0.0) > 1.5:
                parts.append("irregular typing rhythm")
            if z_scores.get("path_linearity", 0.0) < -1.5:
                parts.append("wandering mouse path")
            if z_scores.get("error_rate", 0.0) > 1.0:
                parts.append("elevated error rate")
            base = "Signals suggest confusion or exploration"
            return f"{base}: {', '.join(parts)}." if parts else f"{base}."

        if features.perclos is not None and features.perclos > 0.15:
            return (
                f"Fatigue detected: PERCLOS reached {int(features.perclos * 100)}% "
                f"over the recent camera window."
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
