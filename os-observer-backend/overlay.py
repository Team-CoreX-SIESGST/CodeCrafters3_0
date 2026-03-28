from __future__ import annotations

import tkinter as tk

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

        width = 580
        height = 390
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
            wraplength=520,
        )
        self.message.pack(anchor="w", fill="x")

        self.summary = tk.Label(
            container,
            text=(
                "Active app: Unknown\n"
                "Window: Unknown\n"
                "Typing: 0 WPM | keys/min: 0 | backspaces: 0\n"
                "Mouse: 0 px/s | distance: 0 px | clicks: 0 | scrolls: 0\n"
                "Turns: 0 | idle: -"
            ),
            font=("Consolas", 9),
            bg="#0b1220",
            fg="#94a3b8",
            anchor="w",
            justify="left",
        )
        self.summary.pack(anchor="w", pady=(10, 0), fill="x")

        self.open_apps_title = tk.Label(
            container,
            text="Open Applications",
            font=("Segoe UI", 10, "bold"),
            bg="#0b1220",
            fg="#e2e8f0",
            anchor="w",
        )
        self.open_apps_title.pack(anchor="w", pady=(12, 2), fill="x")

        self.open_apps = tk.Label(
            container,
            text="- Waiting for window scan...",
            font=("Consolas", 9),
            bg="#0b1220",
            fg="#cbd5e1",
            anchor="w",
            justify="left",
            wraplength=520,
        )
        self.open_apps.pack(anchor="w", fill="x")

        self.events_title = tk.Label(
            container,
            text="Recent Events",
            font=("Segoe UI", 10, "bold"),
            bg="#0b1220",
            fg="#e2e8f0",
            anchor="w",
        )
        self.events_title.pack(anchor="w", pady=(12, 2), fill="x")

        self.events = tk.Label(
            container,
            text="- Waiting for activity...",
            font=("Consolas", 9),
            bg="#0b1220",
            fg="#cbd5e1",
            anchor="w",
            justify="left",
            wraplength=520,
        )
        self.events.pack(anchor="w", fill="x")

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
        self._render(snapshot)
        self.root.after(self.refresh_ms, self._refresh)

    def _render(self, snapshot: dict[str, object]) -> None:
        cursor = snapshot["cursor"]
        keyboard = snapshot["keyboard"]
        system = snapshot["system"]
        style = STATE_STYLES.get(str(cursor["state"]), STATE_STYLES["steady"])
        confidence = int(float(cursor["confidence"]) * 100)

        self.root.configure(bg=style["bg"])
        self.badge.configure(
            text=f"{style['badge']}  {confidence}%",
            bg=style["accent"],
            fg="#081018",
        )
        self.title.configure(
            text=self._title_for_state(str(cursor["state"])),
            bg=style["bg"],
            fg=style["text"],
        )
        self.message.configure(
            text=str(cursor["message"]),
            bg=style["bg"],
            fg=style["text"],
        )
        self.summary.configure(
            text=(
                f"Active app: {system['active_app']}\n"
                f"Window: {self._trim_text(str(system['active_window']), 72)}\n"
                f"Typing: {keyboard['wpm']} WPM | keys/min: {keyboard['keys_per_minute']} | "
                f"backspaces: {keyboard['backspace_count']}\n"
                f"Mouse: {int(cursor['features'].average_speed)} px/s | "
                f"distance: {int(cursor['features'].total_distance)} px | "
                f"clicks: {cursor['click_count']} | scrolls: {cursor['scroll_count']}\n"
                f"Turns: {cursor['features'].direction_changes} | "
                f"idle: {snapshot['idle_seconds'] if snapshot['idle_seconds'] is not None else '-'} s"
            ),
            bg=style["bg"],
            fg="#dbe4ee",
        )
        self.open_apps.configure(
            text=self._format_open_apps(system["open_apps"]),
            bg=style["bg"],
            fg="#cbd5e1",
        )
        self.events.configure(
            text=self._format_events(snapshot["recent_events"]),
            bg=style["bg"],
            fg="#cbd5e1",
        )
        self.open_apps_title.configure(bg=style["bg"])
        self.events_title.configure(bg=style["bg"])
        self.hint.configure(bg=style["bg"])

    @staticmethod
    def _title_for_state(state: str) -> str:
        if state == "searching":
            return "Cursor suggests the user is searching around."
        if state == "in_a_hurry":
            return "Cursor suggests the user is in a hurry."
        return "Cursor movement looks steady."

    @staticmethod
    def _trim_text(value: str, max_length: int) -> str:
        if len(value) <= max_length:
            return value
        return f"{value[: max_length - 3]}..."

    def _format_open_apps(self, open_apps) -> str:
        if not open_apps:
            return "- No visible windows detected yet."

        lines = []
        for app in list(open_apps)[:6]:
            title = self._trim_text(str(app["title"]), 45)
            lines.append(f"- {app['name']} | {title}")
        return "\n".join(lines)

    @staticmethod
    def _format_events(events) -> str:
        if not events:
            return "- No recent events yet."
        return "\n".join(f"- {event}" for event in list(events)[-6:])
