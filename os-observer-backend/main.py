from __future__ import annotations

import threading

import uvicorn

from activity_monitor import ActivityMonitor, create_api_app, settings
from overlay import StatusOverlay, ONNXViewerWindow


def run_api(activity_monitor: ActivityMonitor) -> None:
    app = create_api_app(activity_monitor)
    uvicorn.run(app, host=settings.api_host, port=settings.api_port, log_level="warning")


def main() -> None:
    monitor = ActivityMonitor()
    monitor.start()

    api_thread = threading.Thread(
        target=run_api, args=(monitor,), daemon=True, name="UvicornAPI"
    )
    api_thread.start()

    overlay = StatusOverlay(payload_provider=monitor.snapshot, refresh_ms=200)

    # Launch the ONNX Inference Viewer as a separate Toplevel window
    ONNXViewerWindow(parent=overlay.root, payload_provider=monitor.snapshot, refresh_ms=500)

    try:
        overlay.run()
    finally:
        monitor.stop()


if __name__ == "__main__":
    main()
