#app_monitor.py

from __future__ import annotations

import ctypes
import threading
import time
from ctypes import wintypes

import psutil


class AppMonitor:
    def __init__(self, poll_interval: float = 2.0, event_callback=None) -> None:
        self.poll_interval = poll_interval
        self.event_callback = event_callback
        self._lock = threading.Lock()
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None
        self._active_app = "Unknown"
        self._active_window = "Unknown"
        self._open_apps: list[dict[str, str]] = []
        self._last_seen_active: tuple[str, str] | None = None

    def start(self) -> None:
        self._thread = threading.Thread(target=self._poll_loop, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        if self._thread is not None:
            self._thread.join(timeout=1.0)

    def snapshot(self) -> dict[str, object]:
        with self._lock:
            return {
                "active_app": self._active_app,
                "active_window": self._active_window,
                "open_apps": list(self._open_apps),
            }

    def _poll_loop(self) -> None:
        while not self._stop_event.is_set():
            active_app, active_window = self._get_active_window()
            open_apps = self._get_open_apps()

            with self._lock:
                self._active_app = active_app
                self._active_window = active_window
                self._open_apps = open_apps

            active_signature = (active_app, active_window)
            if (
                self.event_callback is not None
                and active_window
                and active_signature != self._last_seen_active
            ):
                self.event_callback(f"App focus: {active_app}")
                self._last_seen_active = active_signature

            time.sleep(self.poll_interval)

    def _get_active_window(self) -> tuple[str, str]:
        if hasattr(ctypes, "windll"):
            user32 = ctypes.windll.user32
            hwnd = user32.GetForegroundWindow()
            if hwnd:
                title = self._window_title(hwnd)
                pid = wintypes.DWORD()
                user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
                process_name = self._process_name(pid.value)
                return process_name or "Unknown", title or "Unknown"

        return "Unknown", "Unknown"

    def _get_open_apps(self) -> list[dict[str, str]]:
        if not hasattr(ctypes, "windll"):
            return []

        user32 = ctypes.windll.user32
        apps: list[dict[str, str]] = []
        seen: set[tuple[str, str]] = set()

        enum_windows_proc = ctypes.WINFUNCTYPE(
            wintypes.BOOL, wintypes.HWND, wintypes.LPARAM
        )

        @enum_windows_proc
        def enum_window(hwnd, _lparam):
            if not user32.IsWindowVisible(hwnd):
                return True

            title = self._window_title(hwnd)
            if not title:
                return True

            pid = wintypes.DWORD()
            user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
            process_name = self._process_name(pid.value)
            signature = (process_name, title)
            if signature in seen:
                return True

            seen.add(signature)
            apps.append(
                {
                    "name": process_name or "Unknown",
                    "title": title,
                }
            )
            return len(apps) < 8

        user32.EnumWindows(enum_window, 0)
        return apps

    @staticmethod
    def _window_title(hwnd) -> str:
        user32 = ctypes.windll.user32
        length = user32.GetWindowTextLengthW(hwnd)
        if length <= 0:
            return ""
        buffer = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(hwnd, buffer, length + 1)
        return buffer.value.strip()

    @staticmethod
    def _process_name(pid: int) -> str:
        if not pid:
            return "Unknown"
        try:
            return psutil.Process(pid).name()
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            return "Unknown"
