from __future__ import annotations

from dataclasses import dataclass


@dataclass(slots=True)
class CursorFeatures:
    duration_seconds: float
    total_distance: float
    average_speed: float
    peak_speed: float
    direction_changes: int
    event_count: int


def clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def classify_cursor_activity(features: CursorFeatures) -> tuple[str, float, str]:
    if features.event_count < 6 or features.total_distance < 250:
        return "steady", 0.88, "Cursor movement is calm."

    hurry_score = 0.0
    search_score = 0.0

    if features.average_speed >= 1800:
        hurry_score += 0.45
    if features.peak_speed >= 3200:
        hurry_score += 0.35
    if features.total_distance >= 3800:
        hurry_score += 0.20

    if features.direction_changes >= 7:
        search_score += 0.40
    if features.total_distance >= 2200:
        search_score += 0.25
    if 700 <= features.average_speed <= 1900:
        search_score += 0.20
    if features.event_count >= 20:
        search_score += 0.15

    if hurry_score >= max(search_score + 0.1, 0.55):
        confidence = clamp(hurry_score, 0.55, 0.98)
        return "in_a_hurry", confidence, "Fast cursor bursts detected."

    if search_score >= 0.55:
        confidence = clamp(search_score, 0.55, 0.95)
        return "searching", confidence, "Cursor looks like it is scanning around."

    return "steady", 0.72, "Cursor movement is normal."
