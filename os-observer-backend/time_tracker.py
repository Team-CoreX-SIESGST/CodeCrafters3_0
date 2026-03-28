"""
time_tracker.py
───────────────
Per-application and per-window active-time accumulation.

Tracks:
  • Total session duration
  • Total "active" time (time spent in any tracked window)
  • Time in the currently-focused window
  • Per-app time leaderboard (top N apps)
  • Time-in-app for current session

Call `update(app, window)` every time the focused window changes.
Call `tick(app, window)` periodically (e.g. every 3 s) to accumulate
time for the currently-focused window.
Call `snapshot()` to get a serialisable dict of all metrics.
"""
from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from typing import Optional


# ── Data structures ───────────────────────────────────────────────────────────
@dataclass
class AppRecord:
    app_name:      str
    window_title:  str
    total_seconds: float = 0.0
    visit_count:   int   = 0
    last_seen:     float = field(default_factory=time.time)


# ── Main class ────────────────────────────────────────────────────────────────
class TimeTracker:
    """
    Thread-safe per-window time accumulator.

    Usage pattern in ActivityMonitor.snapshot():

        tracker.tick(active_app, active_window)          # every snapshot cycle
        time_data = tracker.snapshot()
    """

    IDLE_CUTOFF_SECONDS = 30.0   # gap bigger than this = idle, not active

    def __init__(self) -> None:
        self._lock           = threading.Lock()
        self._records: dict[str, AppRecord] = {}          # key = "app::window"
        self._current_key:    Optional[str]   = None
        self._current_start:  float           = 0.0
        self._session_start:  float           = time.time()
        self._last_tick_time: float           = 0.0

    # ── Public API ────────────────────────────────────────────────────────────
    def tick(self, app_name: str, window_title: str) -> None:
        """
        Call periodically with the currently-focused app/window.
        Accumulates elapsed time into the correct record.
        """
        now = time.time()
        key = f"{app_name}::{window_title[:80]}"

        with self._lock:
            elapsed = now - self._last_tick_time if self._last_tick_time else 0.0

            # Clamp elapsed to avoid jumps after resume/unlock
            if elapsed > self.IDLE_CUTOFF_SECONDS:
                elapsed = 0.0

            # Switch detection
            if key != self._current_key:
                if self._current_key and self._current_key in self._records:
                    # don't double-add; just update last_seen
                    self._records[self._current_key].last_seen = now

                if key not in self._records:
                    self._records[key] = AppRecord(
                        app_name     = app_name,
                        window_title = window_title[:80],
                        visit_count  = 1,
                    )
                else:
                    self._records[key].visit_count += 1

                self._records[key].last_seen = now
                self._current_key   = key
                self._current_start = now

            # Accumulate time for current window
            if elapsed > 0 and self._current_key in self._records:
                self._records[self._current_key].total_seconds += elapsed

            self._last_tick_time = now

    def snapshot(self) -> dict:
        now = time.time()
        with self._lock:
            session_s = now - self._session_start

            # Current window elapsed
            current_elapsed = 0.0
            current_app     = ""
            current_window  = ""
            if self._current_key and self._current_key in self._records:
                rec = self._records[self._current_key]
                current_elapsed = rec.total_seconds
                current_app     = rec.app_name
                current_window  = rec.window_title

            # Total active time across all windows
            total_active = sum(r.total_seconds for r in self._records.values())

            # Top apps (sorted by total time)
            app_totals: dict[str, float] = {}
            for rec in self._records.values():
                app_totals[rec.app_name] = app_totals.get(rec.app_name, 0.0) + rec.total_seconds

            top_apps = sorted(
                [{"app": k, "seconds": round(v), "label": fmt(v)}
                 for k, v in app_totals.items()],
                key=lambda x: x["seconds"],
                reverse=True,
            )[:6]

            # Recent windows (last 5 unique)
            recent_windows = sorted(
                self._records.values(),
                key=lambda r: r.last_seen,
                reverse=True,
            )[:5]

            return {
                "session_seconds":         round(session_s),
                "session_label":           fmt(session_s),
                "total_active_seconds":    round(total_active),
                "total_active_label":      fmt(total_active),
                "current_app":             current_app,
                "current_window":          current_window[:50],
                "current_app_seconds":     round(current_elapsed),
                "current_app_label":       fmt(current_elapsed),
                "idle_fraction":           round(
                    max(0.0, 1.0 - total_active / max(session_s, 1.0)), 3
                ),
                "top_apps": top_apps,
                "recent_windows": [
                    {
                        "app":     r.app_name,
                        "window":  r.window_title[:40],
                        "seconds": round(r.total_seconds),
                        "label":   fmt(r.total_seconds),
                        "visits":  r.visit_count,
                    }
                    for r in recent_windows
                ],
            }


# ── Helpers ───────────────────────────────────────────────────────────────────
def fmt(seconds: float) -> str:
    """Human-readable duration: '2h 03m 15s'."""
    s = max(0, int(seconds))
    h, rem = divmod(s, 3600)
    m, sec = divmod(rem, 60)
    if h > 0:
        return f"{h}h {m:02d}m {sec:02d}s"
    if m > 0:
        return f"{m}m {sec:02d}s"
    return f"{sec}s"