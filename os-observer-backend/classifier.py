from __future__ import annotations

import math
import time
from dataclasses import dataclass


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


@dataclass(slots=True)
class FeatureVector:
    iki_mean: float = 0.0
    iki_std: float = 0.0
    error_rate: float = 0.0
    burst_length: float = 0.0
    cursor_speed: float = 0.0
    path_linearity: float = 0.0
    click_dwell: float = 0.0
    idle_ratio: float = 0.0
    perclos: float | None = None

    def to_dict(self) -> dict[str, float | None]:
        return {
            "iki_mean": round(self.iki_mean, 3),
            "iki_std": round(self.iki_std, 3),
            "error_rate": round(self.error_rate, 3),
            "burst_length": round(self.burst_length, 2),
            "cursor_speed": round(self.cursor_speed, 2),
            "path_linearity": round(self.path_linearity, 3),
            "click_dwell": round(self.click_dwell, 3),
            "idle_ratio": round(self.idle_ratio, 3),
            "perclos": round(self.perclos, 3) if self.perclos is not None else None,
        }


@dataclass(slots=True)
class RunningStat:
    count: int = 0
    mean: float = 0.0
    m2: float = 0.0

    def update(self, value: float) -> None:
        self.count += 1
        delta = value - self.mean
        self.mean += delta / self.count
        delta2 = value - self.mean
        self.m2 += delta * delta2

    @property
    def std(self) -> float:
        if self.count < 2:
            return 0.0
        return math.sqrt(self.m2 / (self.count - 1))


@dataclass(slots=True)
class ClassificationResult:
    state: str
    confidence: float
    message: str
    scores: dict[str, int]
    z_scores: dict[str, float]
    calibration_progress: float
    baseline_ready: bool
    baseline_samples: int
    active_features: FeatureVector
    baseline_means: dict[str, float]


def clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


class CognitiveStateClassifier:
    def __init__(self, calibration_seconds: float = 300.0, minimum_samples: int = 20) -> None:
        self.calibration_seconds = calibration_seconds
        self.minimum_samples = minimum_samples
        self.started_at = time.time()
        self._stats = {name: RunningStat() for name in FEATURE_NAMES}

    def classify(self, features: FeatureVector, now: float | None = None) -> ClassificationResult:
        current_time = now if now is not None else time.time()
        progress = clamp((current_time - self.started_at) / self.calibration_seconds, 0.0, 1.0)

        if progress < 1.0:
            self._update_baseline(features)
        baseline_ready = progress >= 1.0 and self._minimum_sample_count() >= self.minimum_samples

        z_scores = {
            name: self._z_score(name, getattr(features, name))
            for name in FEATURE_NAMES
            if getattr(features, name) is not None
        }
        scores = self._score_states(features, z_scores)

        if not baseline_ready:
            state = "calibrating"
            confidence = 0.6 + (0.3 * progress)
            message = (
                f"Calibrating baseline from your normal activity "
                f"({int(progress * 100)}% complete)."
            )
        else:
            state = self._pick_state(scores)
            confidence = self._confidence_for_state(state, scores, features)
            message = self._message_for_state(state, features, z_scores)

        return ClassificationResult(
            state=state,
            confidence=round(confidence, 2),
            message=message,
            scores=scores,
            z_scores={name: round(value, 2) for name, value in z_scores.items()},
            calibration_progress=round(progress, 3),
            baseline_ready=baseline_ready,
            baseline_samples=self._minimum_sample_count(),
            active_features=features,
            baseline_means={
                name: round(stat.mean, 3) for name, stat in self._stats.items() if stat.count > 0
            },
        )

    def _update_baseline(self, features: FeatureVector) -> None:
        for name in FEATURE_NAMES:
            value = getattr(features, name)
            if value is None:
                continue
            self._stats[name].update(float(value))

    def _minimum_sample_count(self) -> int:
        counts = [stat.count for stat in self._stats.values() if stat.count > 0]
        return min(counts) if counts else 0

    def _z_score(self, name: str, value: float | None) -> float:
        if value is None:
            return 0.0
        stat = self._stats[name]
        if stat.count < 2 or stat.std < 1e-6:
            return 0.0
        return (float(value) - stat.mean) / stat.std

    @staticmethod
    def _score_states(features: FeatureVector, z_scores: dict[str, float]) -> dict[str, int]:
        focused = 0
        confused = 0
        fatigued = 0

        if z_scores.get("iki_mean", 0.0) > 1.5:
            fatigued += 2
        if z_scores.get("error_rate", 0.0) > 1.5:
            fatigued += 2
        if z_scores.get("idle_ratio", 0.0) > 1.5:
            fatigued += 2
        if features.perclos is not None and features.perclos > 0.15:
            fatigued += 3
        if z_scores.get("cursor_speed", 0.0) < -1.0:
            fatigued += 1
        if z_scores.get("click_dwell", 0.0) > 1.0:
            fatigued += 1

        if z_scores.get("iki_std", 0.0) > 1.5:
            confused += 2
        if z_scores.get("path_linearity", 0.0) < -1.5:
            confused += 2
        if z_scores.get("error_rate", 0.0) > 1.0:
            confused += 1
        if z_scores.get("click_dwell", 0.0) > 1.0:
            confused += 1
        if z_scores.get("burst_length", 0.0) < -0.5:
            confused += 1

        if z_scores.get("iki_std", 0.0) < -0.5:
            focused += 2
        if z_scores.get("path_linearity", 0.0) > 0.5:
            focused += 2
        if z_scores.get("burst_length", 0.0) > 0.5:
            focused += 1
        if z_scores.get("error_rate", 0.0) < -0.5:
            focused += 1
        if z_scores.get("click_dwell", 0.0) < -0.5:
            focused += 1

        return {
            "focused": focused,
            "confused": confused,
            "fatigued": fatigued,
        }

    @staticmethod
    def _pick_state(scores: dict[str, int]) -> str:
        ordered = sorted(scores.items(), key=lambda item: (-item[1], item[0]))
        top_state, top_score = ordered[0]
        second_score = ordered[1][1]
        if top_score <= 0:
            return "focused"
        if top_score == second_score:
            if top_state == "fatigued":
                return "confused"
            return "focused"
        return top_state

    @staticmethod
    def _confidence_for_state(
        state: str, scores: dict[str, int], features: FeatureVector
    ) -> float:
        top_score = scores[state]
        competing_score = max(score for name, score in scores.items() if name != state)
        margin = max(top_score - competing_score, 0)
        confidence = 0.5 + min(top_score, 6) * 0.06 + min(margin, 3) * 0.05
        if features.perclos is not None and state == "fatigued" and features.perclos > 0.15:
            confidence += 0.08
        return clamp(confidence, 0.5, 0.96)

    @staticmethod
    def _message_for_state(
        state: str, features: FeatureVector, z_scores: dict[str, float]
    ) -> str:
        if state == "focused":
            return (
                "Rhythm looks stable with purposeful pointer movement."
                if z_scores.get("path_linearity", 0.0) > 0
                else "Signals lean toward focused work."
            )
        if state == "confused":
            return (
                "Input looks hesitant or exploratory, with more corrections than usual."
            )
        if features.perclos is not None and features.perclos > 0.15:
            return "Fatigue indicators are elevated, especially eye-closure time."
        return "Fatigue indicators are elevated with slower or more idle interaction."
