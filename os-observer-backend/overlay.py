from __future__ import annotations

import tkinter as tk
from dataclasses import dataclass

from classifier import CursorFeatures


STATE_STYLES = {
    "steady": {
        "badge": "STEADY",
        "bg": "#143127",
        "accent": "#4ade80",
        "text": "#f8fafc",
    },
    "searching": {
        "badge": "SEARCHING",
        "bg": "#3a2b0a",
        "accent": "#facc15",
        "text": "#fff7ed",
    },
    "in_a_hurry": {
        "badge": "IN A HURRY",
        "bg": "#3f1217",
        "accent": "#fb7185",
        "text": "#fff1f2",
    },
}


@dataclass(slots=True)
class OverlayPayload:
    state: str
    confidence: float
    message: str
    features: CursorFeatures


class StatusOverlay:
    def __init__(self, payload_provider, refresh_ms: int = 500) -> None:
        self.payload_provider = payload_provider
        self.refresh_ms = refresh_ms

        self.root = tk.Tk()
        self.root.title("Observi Cursor Activity")
        self.root.overrideredirect(True)
        self.root.attributes("-topmost", True)
        self.root.attributes("-alpha", 0.94)
        self.root.configure(bg="#0b1220")

        width = 360
        height = 138
        screen_width = self.root.winfo_screenwidth()
        x = max(screen_width - width - 20, 0)
        y = 20
        self.root.geometry(f"{width}x{height}+{x}+{y}")

        container = tk.Frame(self.root, bg="#0b1220", padx=16, pady=14)
        container.pack(fill="both", expand=True)

        self.badge = tk.Label(
            container,
            text="OBSERVING",
            font=("Segoe UI", 10, "bold"),
            anchor="w",
            padx=10,
            pady=4,
            bd=0,
        )
        self.badge.pack(anchor="w")

        self.title = tk.Label(
            container,
            text="Waiting for cursor movement...",
            font=("Segoe UI", 16, "bold"),
            bg="#0b1220",
            fg="#f8fafc",
            anchor="w",
        )
        self.title.pack(anchor="w", pady=(12, 2), fill="x")

        self.message = tk.Label(
            container,
            text="Move the cursor to let the OS-level detector classify activity.",
            font=("Segoe UI", 10),
            bg="#0b1220",
            fg="#cbd5e1",
            anchor="w",
            justify="left",
            wraplength=320,
        )
        self.message.pack(anchor="w", fill="x")

        self.metrics = tk.Label(
            container,
            text="speed: 0 px/s | distance: 0 px | turns: 0",
            font=("Consolas", 9),
            bg="#0b1220",
            fg="#94a3b8",
            anchor="w",
        )
        self.metrics.pack(anchor="w", pady=(10, 0), fill="x")

        self.hint = tk.Label(
            container,
            text="Press Ctrl+C in the terminal to stop.",
            font=("Segoe UI", 9),
            bg="#0b1220",
            fg="#64748b",
            anchor="w",
        )
        self.hint.pack(anchor="w", pady=(4, 0), fill="x")

    def run(self) -> None:
        self._refresh()
        self.root.mainloop()

    def close(self) -> None:
        self.root.destroy()

    def _refresh(self) -> None:
        snapshot = self.payload_provider()
        payload = OverlayPayload(
            state=str(snapshot["state"]),
            confidence=float(snapshot["confidence"]),
            message=str(snapshot["message"]),
            features=snapshot["features"],
        )
        self._render(payload)
        self.root.after(self.refresh_ms, self._refresh)

    def _render(self, payload: OverlayPayload) -> None:
        style = STATE_STYLES.get(payload.state, STATE_STYLES["steady"])
        confidence = int(payload.confidence * 100)

        self.root.configure(bg=style["bg"])
        self.badge.configure(
            text=f"{style['badge']}  {confidence}%",
            bg=style["accent"],
            fg="#081018",
        )
        self.title.configure(
            text=self._title_for_state(payload.state),
            bg=style["bg"],
            fg=style["text"],
        )
        self.message.configure(
            text=payload.message,
            bg=style["bg"],
            fg=style["text"],
        )
        self.metrics.configure(
            text=(
                f"speed: {int(payload.features.average_speed)} px/s"
                f" | distance: {int(payload.features.total_distance)} px"
                f" | turns: {payload.features.direction_changes}"
            ),
            bg=style["bg"],
        )
        self.hint.configure(bg=style["bg"])

    @staticmethod
    def _title_for_state(state: str) -> str:
        if state == "searching":
            return "Cursor suggests the user is searching around."
        if state == "in_a_hurry":
            return "Cursor suggests the user is in a hurry."
        return "Cursor movement looks steady."
