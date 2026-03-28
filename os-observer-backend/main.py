from __future__ import annotations

from cursor_monitor import CursorMonitor
from overlay import StatusOverlay


def main() -> None:
    monitor = CursorMonitor(window_seconds=4.0)
    monitor.start()

    overlay = StatusOverlay(payload_provider=monitor.snapshot, refresh_ms=500)
    try:
        overlay.run()
    finally:
        monitor.stop()


if __name__ == "__main__":
    main()
