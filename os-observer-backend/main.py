from __future__ import annotations

import threading
import tkinter as tk
from tkinter import messagebox

import uvicorn

from activity_monitor import ActivityMonitor, create_api_app, settings
from overlay import StatusOverlay


def run_api(activity_monitor: ActivityMonitor) -> None:
    app = create_api_app(activity_monitor)
    uvicorn.run(app, host=settings.api_host, port=settings.api_port, log_level="warning")


def ask_camera_consent() -> bool:
    if not settings.camera_enabled:
        return False

    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)
    try:
        return bool(
            messagebox.askyesno(
                "Camera Access",
                "Flow Guardian can use your camera for blink and face tracking.\n\nDo you want to allow camera access?",
                parent=root,
            )
        )
    finally:
        root.destroy()


def main() -> None:
    camera_allowed = ask_camera_consent()
    monitor = ActivityMonitor(camera_enabled_override=camera_allowed)
    monitor.start()

    api_thread = threading.Thread(
        target=run_api, args=(monitor,), daemon=True, name="UvicornAPI"
    )
    api_thread.start()

    overlay = StatusOverlay(
        payload_provider=monitor.snapshot, 
        camera_provider=monitor.camera_monitor.get_latest_frame, 
        refresh_ms=100
    )

    try:
        overlay.run()
    finally:
        monitor.stop()


if __name__ == "__main__":
    main()
