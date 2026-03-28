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
        self._drag_offset_x = 0
        self._drag_offset_y = 0
        self._resize_start_width = 0
        self._resize_start_height = 0
        self._resize_start_x = 0
        self._resize_start_y = 0
        self._content_min_width = 560

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
        self.root.minsize(420, 260)
        self.root.bind("<Map>", self._restore_window_chrome)
        self.root.bind_all("<MouseWheel>", self._on_mousewheel, add="+")
        self.root.bind_all("<Shift-MouseWheel>", self._on_shift_mousewheel, add="+")

        self.container = tk.Frame(self.root, bg="#0b1220", padx=16, pady=14)
        self.container.pack(fill="both", expand=True)
        self._bind_drag(self.container)

        self.header = tk.Frame(self.container, bg="#0b1220")
        self.header.pack(fill="x", pady=(0, 10))
        self._bind_drag(self.header)

        self.header_title = tk.Label(
            self.header,
            text="Observi Cursor Activity",
            font=("Segoe UI", 11, "bold"),
            bg="#0b1220",
            fg="#f8fafc",
            anchor="w",
        )
        self.header_title.pack(side="left", fill="x", expand=True)
        self._bind_drag(self.header_title)

        self.minimize_button = tk.Button(
            self.header,
            text="_",
            command=self._minimize_window,
            font=("Segoe UI", 11, "bold"),
            bg="#162033",
            fg="#e2e8f0",
            activebackground="#23314c",
            activeforeground="#f8fafc",
            bd=0,
            padx=12,
            pady=2,
            cursor="hand2",
        )
        self.minimize_button.pack(side="right", padx=(8, 0))

        self.close_button = tk.Button(
            self.header,
            text="X",
            command=self.close,
            font=("Segoe UI", 10, "bold"),
            bg="#162033",
            fg="#e2e8f0",
            activebackground="#7f1d1d",
            activeforeground="#f8fafc",
            bd=0,
            padx=12,
            pady=3,
            cursor="hand2",
        )
        self.close_button.pack(side="right")

        self.body = tk.Frame(self.container, bg="#0b1220")
        self.body.pack(fill="both", expand=True)
        self._bind_drag(self.body)

        self.viewport = tk.Frame(self.body, bg="#0b1220")
        self.viewport.pack(fill="both", expand=True)
        self._bind_drag(self.viewport)

        self.canvas = tk.Canvas(
            self.viewport,
            bg="#0b1220",
            highlightthickness=0,
            bd=0,
        )
        self.canvas.pack(side="left", fill="both", expand=True)
        self._bind_drag(self.canvas)

        self.v_scrollbar = tk.Scrollbar(self.viewport, orient="vertical", command=self.canvas.yview)
        self.v_scrollbar.pack(side="right", fill="y")

        self.h_scrollbar = tk.Scrollbar(self.body, orient="horizontal", command=self.canvas.xview)
        self.h_scrollbar.pack(side="bottom", fill="x", pady=(8, 0))

        self.canvas.configure(
            yscrollcommand=self.v_scrollbar.set,
            xscrollcommand=self.h_scrollbar.set,
        )

        self.content = tk.Frame(self.canvas, bg="#0b1220")
        self._bind_drag(self.content)
        self.canvas_window = self.canvas.create_window(
            (0, 0),
            window=self.content,
            anchor="nw",
        )
        self.content.bind("<Configure>", self._sync_scroll_region)
        self.canvas.bind("<Configure>", self._resize_canvas_content)

        self.resize_grip = tk.Label(
            self.body,
            text="//",
            font=("Segoe UI", 10, "bold"),
            bg="#162033",
            fg="#cbd5e1",
            width=2,
            cursor="size_nw_se",
        )
        self.resize_grip.pack(side="right", anchor="se", padx=(8, 0), pady=(8, 0))
        self.resize_grip.bind("<ButtonPress-1>", self._start_resize, add="+")
        self.resize_grip.bind("<B1-Motion>", self._resize_window, add="+")

        self.badge = tk.Label(
            self.content,
            text="OBSERVING",
            font=("Segoe UI", 10, "bold"),
            anchor="w",
            padx=10,
            pady=4,
            bd=0,
        )
        self.badge.pack(anchor="w")
        self._bind_drag(self.badge)

        self.title = tk.Label(
            self.content,
            text="Waiting for cursor movement...",
            font=("Segoe UI", 16, "bold"),
            bg="#0b1220",
            fg="#f8fafc",
            anchor="w",
        )
        self.title.pack(anchor="w", pady=(12, 2), fill="x")
        self._bind_drag(self.title)

        self.message = tk.Label(
            self.content,
            text="Move the cursor to let the OS-level detector classify activity.",
            font=("Segoe UI", 10),
            bg="#0b1220",
            fg="#cbd5e1",
            anchor="w",
            justify="left",
            wraplength=520,
        )
        self.message.pack(anchor="w", fill="x")
        self._bind_drag(self.message)

        self.summary = tk.Label(
            self.content,
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
        self._bind_drag(self.summary)

        self.open_apps_title = tk.Label(
            self.content,
            text="Open Applications",
            font=("Segoe UI", 10, "bold"),
            bg="#0b1220",
            fg="#e2e8f0",
            anchor="w",
        )
        self.open_apps_title.pack(anchor="w", pady=(12, 2), fill="x")
        self._bind_drag(self.open_apps_title)

        self.open_apps = tk.Label(
            self.content,
            text="- Waiting for window scan...",
            font=("Consolas", 9),
            bg="#0b1220",
            fg="#cbd5e1",
            anchor="w",
            justify="left",
            wraplength=520,
        )
        self.open_apps.pack(anchor="w", fill="x")
        self._bind_drag(self.open_apps)

        self.events_title = tk.Label(
            self.content,
            text="Recent Events",
            font=("Segoe UI", 10, "bold"),
            bg="#0b1220",
            fg="#e2e8f0",
            anchor="w",
        )
        self.events_title.pack(anchor="w", pady=(12, 2), fill="x")
        self._bind_drag(self.events_title)

        self.events = tk.Label(
            self.content,
            text="- Waiting for activity...",
            font=("Consolas", 9),
            bg="#0b1220",
            fg="#cbd5e1",
            anchor="w",
            justify="left",
            wraplength=520,
        )
        self.events.pack(anchor="w", fill="x")
        self._bind_drag(self.events)

        self.hint = tk.Label(
            self.content,
            text=(
                "Drag anywhere to move. Use the _ button to minimize. "
                "Use the bottom-right grip to resize. Shift + mouse wheel scrolls sideways."
            ),
            font=("Segoe UI", 9),
            bg="#0b1220",
            fg="#64748b",
            anchor="w",
            justify="left",
            wraplength=520,
        )
        self.hint.pack(anchor="w", pady=(4, 0), fill="x")
        self._bind_drag(self.hint)

    def run(self) -> None:
        self._refresh()
        self.root.mainloop()

    def close(self) -> None:
        self.root.destroy()

    def _minimize_window(self) -> None:
        self.root.update_idletasks()
        self.root.overrideredirect(False)
        self.root.iconify()

    def _restore_window_chrome(self, _event=None) -> None:
        if self.root.state() == "normal":
            self.root.after(10, self._reapply_overlay_mode)

    def _reapply_overlay_mode(self) -> None:
        self.root.overrideredirect(True)
        self.root.attributes("-topmost", True)

    def _sync_scroll_region(self, _event=None) -> None:
        self.canvas.configure(scrollregion=self.canvas.bbox("all"))

    def _resize_canvas_content(self, event) -> None:
        content_width = max(event.width, self._content_min_width)
        self.canvas.itemconfigure(self.canvas_window, width=content_width)
        wraplength = max(content_width - 24, 240)
        self.message.configure(wraplength=wraplength)
        self.open_apps.configure(wraplength=wraplength)
        self.events.configure(wraplength=wraplength)
        self.hint.configure(wraplength=wraplength)
        self._sync_scroll_region()

    def _on_mousewheel(self, event) -> None:
        widget_under_pointer = self.root.winfo_containing(event.x_root, event.y_root)
        if widget_under_pointer is None:
            return

        if widget_under_pointer == self.root or self._is_descendant(widget_under_pointer, self.canvas):
            self.canvas.yview_scroll(int(-event.delta / 120), "units")

    def _on_shift_mousewheel(self, event) -> None:
        widget_under_pointer = self.root.winfo_containing(event.x_root, event.y_root)
        if widget_under_pointer is None:
            return

        if widget_under_pointer == self.root or self._is_descendant(widget_under_pointer, self.canvas):
            self.canvas.xview_scroll(int(-event.delta / 120), "units")

    def _bind_drag(self, widget) -> None:
        widget.bind("<ButtonPress-1>", self._start_drag, add="+")
        widget.bind("<B1-Motion>", self._drag_window, add="+")

    def _start_drag(self, event) -> None:
        self._drag_offset_x = event.x_root - self.root.winfo_x()
        self._drag_offset_y = event.y_root - self.root.winfo_y()

    def _drag_window(self, event) -> None:
        x = event.x_root - self._drag_offset_x
        y = event.y_root - self._drag_offset_y
        self.root.geometry(f"+{x}+{y}")

    def _start_resize(self, event) -> None:
        self._resize_start_width = self.root.winfo_width()
        self._resize_start_height = self.root.winfo_height()
        self._resize_start_x = event.x_root
        self._resize_start_y = event.y_root

    def _resize_window(self, event) -> None:
        width_delta = event.x_root - self._resize_start_x
        height_delta = event.y_root - self._resize_start_y
        new_width = max(self.root.winfo_reqwidth(), self._resize_start_width + width_delta, 420)
        new_height = max(self.root.winfo_reqheight(), self._resize_start_height + height_delta, 260)
        self.root.geometry(f"{new_width}x{new_height}")

    @staticmethod
    def _is_descendant(widget, parent) -> bool:
        current = widget
        while current is not None:
            if current == parent:
                return True
            current_name = current.winfo_parent()
            if not current_name:
                return False
            current = current.nametowidget(current_name)
        return False

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
        self.container.configure(bg=style["bg"])
        self.header.configure(bg=style["bg"])
        self.header_title.configure(bg=style["bg"], fg=style["text"])
        self.body.configure(bg=style["bg"])
        self.viewport.configure(bg=style["bg"])
        self.canvas.configure(bg=style["bg"])
        self.content.configure(bg=style["bg"])
        self.minimize_button.configure(bg="#162033", fg="#e2e8f0")
        self.close_button.configure(bg="#162033", fg="#e2e8f0")
        self.resize_grip.configure(bg="#162033", fg="#cbd5e1")
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
