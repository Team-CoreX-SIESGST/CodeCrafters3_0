#overlay.py

from __future__ import annotations

import tkinter as tk
from tkinter import ttk

# ---------------------------------------------------------------------------
# State visual styles
# ---------------------------------------------------------------------------
STATE_STYLES: dict[str, dict[str, str]] = {
    "calibrating": {
        "badge": "CALIBRATING",
        "bg":     "#0f1e35",
        "accent": "#60a5fa",
        "bar":    "#1e3a5f",
        "text":   "#eff6ff",
        "sub":    "#93c5fd",
    },
    "focused": {
        "badge": "FOCUSED",
        "bg":     "#0d2118",
        "accent": "#4ade80",
        "bar":    "#14532d",
        "text":   "#f0fdf4",
        "sub":    "#86efac",
    },
    "confused": {
        "badge": "CONFUSED",
        "bg":     "#2d1f06",
        "accent": "#fbbf24",
        "bar":    "#78350f",
        "text":   "#fffbeb",
        "sub":    "#fde68a",
    },
    "fatigued": {
        "badge": "FATIGUED",
        "bg":     "#2d0a10",
        "accent": "#f87171",
        "bar":    "#7f1d1d",
        "text":   "#fff1f2",
        "sub":    "#fca5a5",
    },
}

SCORE_BARS = [
    ("focus_depth",       "Focus depth",        "▲ higher is better"),
    ("attention_residue", "Attention residue",   "▼ lower is better"),
    ("pre_error_risk",    "Pre-error risk",      "▼ lower is better"),
    ("confusion_risk",    "Confusion risk",      "▼ lower is better"),
    ("fatigue_risk",      "Fatigue risk",        "▼ lower is better"),
    ("interruptibility",  "Interruptibility",    "↔ situational"),
    ("emotional_load",    "Emotional load",      "▼ lower is better"),
    ("cognitive_debt",    "Cognitive debt",      "▼ lower is better"),
]

BAR_W  = 160   # canvas width for score bars
BAR_H  = 10    # bar height


class StatusOverlay:
    def __init__(self, payload_provider, refresh_ms: int = 700) -> None:
        self.payload_provider = payload_provider
        self.refresh_ms       = refresh_ms

        self._drag_x = self._drag_y = 0
        self._resize_start_w = self._resize_start_h = 0
        self._resize_start_x = self._resize_start_y = 0
        self._content_min_w  = 580

        # ------------------------------------------------------------------
        # Root window
        # ------------------------------------------------------------------
        self.root = tk.Tk()
        self.root.title("Flow Guardian")
        self.root.overrideredirect(True)
        self.root.attributes("-topmost", True)
        self.root.attributes("-alpha", 0.95)
        self.root.configure(bg="#0b1220")
        self.root.minsize(440, 300)

        w, h = 620, 520
        sw = self.root.winfo_screenwidth()
        self.root.geometry(f"{w}x{h}+{max(sw - w - 20, 0)}+20")

        self.root.bind("<Map>", self._restore_chrome)
        self.root.bind_all("<MouseWheel>",       self._on_mousewheel,       add="+")
        self.root.bind_all("<Shift-MouseWheel>", self._on_shift_mousewheel, add="+")

        # ------------------------------------------------------------------
        # Layout: header + scrollable body
        # ------------------------------------------------------------------
        self.outer = tk.Frame(self.root, bg="#0b1220", padx=14, pady=10)
        self.outer.pack(fill="both", expand=True)
        self._bind_drag(self.outer)

        # Header row
        self.header = tk.Frame(self.outer, bg="#0b1220")
        self.header.pack(fill="x", pady=(0, 8))
        self._bind_drag(self.header)

        self.lbl_title = tk.Label(
            self.header, text="Flow Guardian", font=("Segoe UI", 11, "bold"),
            bg="#0b1220", fg="#f8fafc", anchor="w",
        )
        self.lbl_title.pack(side="left", fill="x", expand=True)
        self._bind_drag(self.lbl_title)

        for text, cmd, hover_bg in (
            ("_",  self._minimize, "#1e3a5f"),
            ("✕",  self.close,     "#7f1d1d"),
        ):
            btn = tk.Button(
                self.header, text=text, command=cmd,
                font=("Segoe UI", 10, "bold"), bg="#162033", fg="#e2e8f0",
                activebackground=hover_bg, activeforeground="#f8fafc",
                bd=0, padx=10, pady=2, cursor="hand2",
            )
            btn.pack(side="right", padx=(4, 0))

        # Scrollable canvas
        self.viewport = tk.Frame(self.outer, bg="#0b1220")
        self.viewport.pack(fill="both", expand=True)

        self.canvas = tk.Canvas(self.viewport, bg="#0b1220", highlightthickness=0, bd=0)
        self.canvas.pack(side="left", fill="both", expand=True)
        self._bind_drag(self.canvas)

        self.v_scroll = tk.Scrollbar(self.viewport, orient="vertical",   command=self.canvas.yview)
        self.h_scroll = tk.Scrollbar(self.outer,    orient="horizontal",  command=self.canvas.xview)
        self.v_scroll.pack(side="right", fill="y")
        self.h_scroll.pack(side="bottom", fill="x", pady=(6, 0))

        self.canvas.configure(
            yscrollcommand=self.v_scroll.set,
            xscrollcommand=self.h_scroll.set,
        )

        self.content = tk.Frame(self.canvas, bg="#0b1220")
        self._bind_drag(self.content)
        self._canvas_win = self.canvas.create_window((0, 0), window=self.content, anchor="nw")
        self.content.bind("<Configure>", lambda _e: self.canvas.configure(
            scrollregion=self.canvas.bbox("all")
        ))
        self.canvas.bind("<Configure>", self._on_canvas_resize)

        # Resize grip
        self.grip = tk.Label(
            self.outer, text="//", font=("Segoe UI", 10, "bold"),
            bg="#162033", fg="#cbd5e1", width=2, cursor="size_nw_se",
        )
        self.grip.pack(side="right", anchor="se", padx=(8, 0), pady=(4, 0))
        self.grip.bind("<ButtonPress-1>", self._start_resize, add="+")
        self.grip.bind("<B1-Motion>",     self._do_resize,    add="+")

        # ------------------------------------------------------------------
        # Content widgets
        # ------------------------------------------------------------------
        # State badge + title
        self.badge = tk.Label(
            self.content, text="OBSERVING", font=("Segoe UI", 10, "bold"),
            anchor="w", padx=10, pady=4, bd=0,
        )
        self.badge.pack(anchor="w", pady=(0, 4))
        self._bind_drag(self.badge)

        self.lbl_state_title = tk.Label(
            self.content, text="Waiting for baseline calibration...",
            font=("Segoe UI", 15, "bold"), bg="#0b1220", fg="#f8fafc", anchor="w",
        )
        self.lbl_state_title.pack(anchor="w", fill="x")
        self._bind_drag(self.lbl_state_title)

        self.lbl_message = tk.Label(
            self.content, text="Collecting keyboard, mouse, and camera signals.",
            font=("Segoe UI", 10), bg="#0b1220", fg="#cbd5e1",
            anchor="w", justify="left", wraplength=540,
        )
        self.lbl_message.pack(anchor="w", fill="x", pady=(2, 8))
        self._bind_drag(self.lbl_message)

        # -- Score bars section ---
        self._mk_section("Live Scores")
        self.score_frame = tk.Frame(self.content, bg="#0b1220")
        self.score_frame.pack(anchor="w", fill="x", pady=(0, 6))
        self._bind_drag(self.score_frame)

        self._bar_canvases: dict[str, tk.Canvas] = {}
        self._bar_labels:   dict[str, tk.Label]  = {}
        self._bar_pct:      dict[str, tk.Label]  = {}

        for key, label, hint in SCORE_BARS:
            row = tk.Frame(self.score_frame, bg="#0b1220")
            row.pack(anchor="w", fill="x", pady=1)
            self._bind_drag(row)

            lbl = tk.Label(
                row, text=f"{label}", width=22, anchor="w",
                font=("Segoe UI", 9), bg="#0b1220", fg="#94a3b8",
            )
            lbl.pack(side="left")
            self._bind_drag(lbl)

            cvs = tk.Canvas(row, width=BAR_W, height=BAR_H, bg="#162033",
                            highlightthickness=0, bd=0)
            cvs.pack(side="left", padx=(2, 4))

            pct_lbl = tk.Label(
                row, text="  0%", width=5, anchor="w",
                font=("Consolas", 9), bg="#0b1220", fg="#cbd5e1",
            )
            pct_lbl.pack(side="left")

            hint_lbl = tk.Label(
                row, text=hint, anchor="w",
                font=("Segoe UI", 8), bg="#0b1220", fg="#475569",
            )
            hint_lbl.pack(side="left", padx=(2, 0))

            self._bar_canvases[key] = cvs
            self._bar_pct[key]      = pct_lbl

        # -- Raw signals section ---
        self._mk_section("Raw Signals")
        self.lbl_signals = tk.Label(
            self.content, text="Waiting...",
            font=("Consolas", 9), bg="#0b1220", fg="#94a3b8",
            anchor="w", justify="left",
        )
        self.lbl_signals.pack(anchor="w", fill="x")
        self._bind_drag(self.lbl_signals)

        # -- Interruption queue section ---
        self._mk_section("Interruption Queue")
        self.lbl_queue = tk.Label(
            self.content, text="— Queue is empty",
            font=("Consolas", 9), bg="#0b1220", fg="#94a3b8",
            anchor="w", justify="left",
        )
        self.lbl_queue.pack(anchor="w", fill="x")
        self._bind_drag(self.lbl_queue)

        # -- Artifact friction section ---
        self._mk_section("Artifact Friction")
        self.lbl_artifact = tk.Label(
            self.content, text="No artifact data yet.",
            font=("Consolas", 9), bg="#0b1220", fg="#94a3b8",
            anchor="w", justify="left",
        )
        self.lbl_artifact.pack(anchor="w", fill="x")
        self._bind_drag(self.lbl_artifact)

        # -- Baseline + z-scores section ---
        self._mk_section("Classifier Detail")
        self.lbl_classifier = tk.Label(
            self.content, text="— Awaiting calibration",
            font=("Consolas", 9), bg="#0b1220", fg="#94a3b8",
            anchor="w", justify="left",
        )
        self.lbl_classifier.pack(anchor="w", fill="x")
        self._bind_drag(self.lbl_classifier)

        # -- Events section ---
        self._mk_section("Recent Events")
        self.lbl_events = tk.Label(
            self.content, text="— No events yet.",
            font=("Consolas", 9), bg="#0b1220", fg="#cbd5e1",
            anchor="w", justify="left", wraplength=540,
        )
        self.lbl_events.pack(anchor="w", fill="x")
        self._bind_drag(self.lbl_events)

        # Hint
        self.lbl_hint = tk.Label(
            self.content,
            text="Drag to move  ·  _ to minimise  ·  // grip to resize  ·  Shift+scroll ↔",
            font=("Segoe UI", 8), bg="#0b1220", fg="#334155",
            anchor="w", justify="left",
        )
        self.lbl_hint.pack(anchor="w", pady=(8, 0), fill="x")
        self._bind_drag(self.lbl_hint)

    # ------------------------------------------------------------------
    # Run loop
    # ------------------------------------------------------------------
    def run(self) -> None:
        self._refresh()
        self.root.mainloop()

    def close(self) -> None:
        self.root.destroy()

    # ------------------------------------------------------------------
    # Refresh
    # ------------------------------------------------------------------
    def _refresh(self) -> None:
        try:
            snap = self.payload_provider()
            self._render(snap)
        except Exception:
            pass
        self.root.after(self.refresh_ms, self._refresh)

    def _render(self, snap: dict) -> None:
        state_info  = snap.get("state", {})
        features    = snap.get("features", {})
        keyboard    = snap.get("keyboard", {})
        mouse       = snap.get("mouse", {})
        camera      = snap.get("camera", {})
        system      = snap.get("system", {})
        scores      = snap.get("scores", {})
        broker      = snap.get("core_features", {}).get("interruption_broker", {})
        artifact    = snap.get("artifact", {})
        ctx         = snap.get("contextual_enrichment", {})
        events      = snap.get("recent_events", [])

        state_name = str(state_info.get("name", "calibrating"))
        style      = STATE_STYLES.get(state_name, STATE_STYLES["calibrating"])
        bg         = style["bg"]
        confidence = int(float(state_info.get("confidence", 0.6)) * 100)

        # -- Window / widget bg recolour --
        for w in (self.root, self.outer, self.header, self.viewport,
                  self.canvas, self.content, self.score_frame,
                  self.lbl_title, self.lbl_state_title, self.lbl_message,
                  self.lbl_signals, self.lbl_queue, self.lbl_artifact,
                  self.lbl_classifier, self.lbl_events, self.lbl_hint):
            try:
                w.configure(bg=bg)
            except Exception:
                pass

        self.badge.configure(
            text=f"  {style['badge']}  {confidence}%  ",
            bg=style["accent"], fg="#081018",
        )
        self.lbl_state_title.configure(
            text=_state_title(state_name),
            fg=style["text"],
        )
        self.lbl_message.configure(
            text=str(state_info.get("message", "")),
            fg=style["sub"],
        )

        # -- Score bars --
        for key, _label, _hint in SCORE_BARS:
            val = float(scores.get(key, 0.0))
            pct = int(val * 100)
            filled_w = int(val * BAR_W)
            cvs = self._bar_canvases[key]
            cvs.configure(bg=style["bar"])
            cvs.delete("all")
            if filled_w > 0:
                bar_color = _bar_color(key, val, style)
                cvs.create_rectangle(0, 0, filled_w, BAR_H, fill=bar_color, outline="")
            self._bar_pct[key].configure(
                text=f"{pct:3d}%",
                bg=bg, fg=style["sub"],
            )
            # also recolour the label and hint
        for child in self.score_frame.winfo_children():
            try:
                child.configure(bg=bg)
            except Exception:
                pass
            for subchild in child.winfo_children():
                try:
                    subchild.configure(bg=bg)
                except Exception:
                    pass

        # -- Raw signals --
        perclos_str = (
            f"{float(camera['perclos']):.3f}"
            if isinstance(camera.get("perclos"), (int, float))
            else str(camera.get("status", "unavailable"))
        )
        self.lbl_signals.configure(
            text=(
                f"App: {system.get('active_app', '?')}  |  "
                f"Session: {ctx.get('session_age_minutes', 0):.0f} min  |  "
                f"Break: {ctx.get('time_since_break_minutes', 0):.0f} min ago\n"
                f"IKI mean={features.get('iki_mean', 0):.3f}s  "
                f"std={features.get('iki_std', 0):.3f}s  "
                f"err={features.get('error_rate', 0):.3f}  "
                f"burst={features.get('burst_length', 0):.1f}\n"
                f"Mouse speed={int(float(features.get('cursor_speed', 0)))} px/s  "
                f"linearity={features.get('path_linearity', 0):.3f}  "
                f"dwell={features.get('click_dwell', 0):.3f}s\n"
                f"Idle={snap.get('idle_seconds', 0):.1f}s  "
                f"PERCLOS={perclos_str}  "
                f"ToD modifier={ctx.get('time_of_day_modifier', 0):.2f}"
            ),
            fg=style["sub"], bg=bg,
        )

        # -- Interruption queue --
        pending     = broker.get("pending_queue", [])
        pending_cnt = int(broker.get("pending_count", 0))
        if pending_cnt == 0:
            queue_text = f"— Queue empty  (interruptibility {int(float(scores.get('interruptibility', 0)) * 100)}%)"
        else:
            items = [f"  · {i.get('source', '?')} [{i.get('urgency', '?')}]" for i in pending[:5]]
            queue_text = f"{pending_cnt} interruption(s) held:\n" + "\n".join(items)
        self.lbl_queue.configure(text=queue_text, fg=style["sub"], bg=bg)

        # -- Artifact friction --
        art_label   = str(artifact.get("artifact_label", "Unknown"))[:60]
        art_friction = float(artifact.get("friction_score", 0.0))
        art_visits   = int(artifact.get("visits", 0))
        art_revisits = int(artifact.get("revisits", 0))
        self.lbl_artifact.configure(
            text=(
                f"{art_label}\n"
                f"  Friction={art_friction:.3f}  "
                f"visits={art_visits}  revisits={art_revisits}"
            ),
            fg=style["sub"], bg=bg,
        )

        # -- Classifier detail --
        z      = state_info.get("z_scores", {})
        cls_sc = state_info.get("scores", {})
        prog   = int(float(state_info.get("calibration_progress", 0)) * 100)
        samps  = int(state_info.get("baseline_samples", 0))
        hits   = state_info.get("rule_hits", {})
        winner_hits = hits.get(state_name, [])
        hits_str = ("  " + "\n  ".join(winner_hits[:4])) if winner_hits else "  (calibrating)"
        self.lbl_classifier.configure(
            text=(
                f"Calibration: {prog}%  samples: {samps}\n"
                f"Scores — focused:{cls_sc.get('focused',0)}  "
                f"confused:{cls_sc.get('confused',0)}  "
                f"fatigued:{cls_sc.get('fatigued',0)}\n"
                f"Z-scores — iki_std:{z.get('iki_std',0):.2f}  "
                f"linearity:{z.get('path_linearity',0):.2f}  "
                f"idle:{z.get('idle_ratio',0):.2f}  "
                f"err:{z.get('error_rate',0):.2f}\n"
                f"Rules fired:\n{hits_str}"
            ),
            fg=style["sub"], bg=bg,
        )

        # -- Events --
        evt_text = "\n".join(f"  {e}" for e in events[-8:]) if events else "— No events yet."
        self.lbl_events.configure(text=evt_text, fg=style["sub"], bg=bg)

    # ------------------------------------------------------------------
    # Helper: section header
    # ------------------------------------------------------------------
    def _mk_section(self, title: str) -> tk.Label:
        lbl = tk.Label(
            self.content, text=title.upper(),
            font=("Segoe UI", 8, "bold"), bg="#0b1220", fg="#475569",
            anchor="w",
        )
        lbl.pack(anchor="w", pady=(10, 2), fill="x")
        self._bind_drag(lbl)
        sep = tk.Frame(self.content, bg="#1e293b", height=1)
        sep.pack(fill="x", pady=(0, 4))
        return lbl

    # ------------------------------------------------------------------
    # Canvas resize
    # ------------------------------------------------------------------
    def _on_canvas_resize(self, event) -> None:
        w = max(event.width, self._content_min_w)
        self.canvas.itemconfigure(self._canvas_win, width=w)
        wrap = max(w - 28, 240)
        for lbl in (self.lbl_message, self.lbl_events, self.lbl_hint):
            lbl.configure(wraplength=wrap)
        self.canvas.configure(scrollregion=self.canvas.bbox("all"))

    # ------------------------------------------------------------------
    # Window management
    # ------------------------------------------------------------------
    def _minimize(self) -> None:
        self.root.update_idletasks()
        self.root.overrideredirect(False)
        self.root.iconify()

    def _restore_chrome(self, _event=None) -> None:
        if self.root.state() == "normal":
            self.root.after(10, self._reapply_overlay)

    def _reapply_overlay(self) -> None:
        self.root.overrideredirect(True)
        self.root.attributes("-topmost", True)

    def _bind_drag(self, widget) -> None:
        widget.bind("<ButtonPress-1>", self._start_drag, add="+")
        widget.bind("<B1-Motion>",     self._do_drag,    add="+")

    def _start_drag(self, event) -> None:
        self._drag_x = event.x_root - self.root.winfo_x()
        self._drag_y = event.y_root - self.root.winfo_y()

    def _do_drag(self, event) -> None:
        self.root.geometry(f"+{event.x_root - self._drag_x}+{event.y_root - self._drag_y}")

    def _start_resize(self, event) -> None:
        self._resize_start_w = self.root.winfo_width()
        self._resize_start_h = self.root.winfo_height()
        self._resize_start_x = event.x_root
        self._resize_start_y = event.y_root

    def _do_resize(self, event) -> None:
        nw = max(self.root.winfo_reqwidth(),  self._resize_start_w + event.x_root - self._resize_start_x, 440)
        nh = max(self.root.winfo_reqheight(), self._resize_start_h + event.y_root - self._resize_start_y, 300)
        self.root.geometry(f"{nw}x{nh}")

    def _on_mousewheel(self, event) -> None:
        under = self.root.winfo_containing(event.x_root, event.y_root)
        if under is not None and (under == self.root or _is_descendant(under, self.canvas)):
            self.canvas.yview_scroll(int(-event.delta / 120), "units")

    def _on_shift_mousewheel(self, event) -> None:
        under = self.root.winfo_containing(event.x_root, event.y_root)
        if under is not None and (under == self.root or _is_descendant(under, self.canvas)):
            self.canvas.xview_scroll(int(-event.delta / 120), "units")


# ---------------------------------------------------------------------------
# Module-level helpers
# ---------------------------------------------------------------------------
def _state_title(state: str) -> str:
    return {
        "calibrating": "Calibrating your personal baseline...",
        "focused":     "Interaction pattern: focused work.",
        "confused":    "Interaction pattern: confusion or exploration.",
        "fatigued":    "Interaction pattern: fatigue detected.",
    }.get(state, "Observing...")


def _bar_color(key: str, val: float, style: dict) -> str:
    """
    Green-ish for good scores, amber for medium, red for high risk.
    For focus_depth / interruptibility higher is better.
    """
    good_keys = {"focus_depth", "interruptibility"}
    if key in good_keys:
        if val >= 0.65:   return "#4ade80"
        if val >= 0.40:   return "#fbbf24"
        return "#f87171"
    else:
        if val <= 0.35:   return "#4ade80"
        if val <= 0.60:   return "#fbbf24"
        return "#f87171"


def _is_descendant(widget, parent) -> bool:
    current = widget
    while current is not None:
        if current == parent:
            return True
        pname = current.winfo_parent()
        if not pname:
            return False
        try:
            current = current.nametowidget(pname)
        except Exception:
            return False
    return False