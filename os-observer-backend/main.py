from __future__ import annotations

from activity_monitor import ActivityMonitor
from overlay import StatusOverlay


def main() -> None:
    monitor = ActivityMonitor()
    monitor.start()

    overlay = StatusOverlay(payload_provider=monitor.snapshot, refresh_ms=500)
    try:
        overlay.run()
    finally:
        monitor.stop()


if __name__ == "__main__":
    main()
