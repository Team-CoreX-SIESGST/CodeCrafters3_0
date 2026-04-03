"""
overlay.py  (enhanced)
───────────────────────
Adds the following new sections to the Tk overlay panel:

  ⏱ ACTIVE TIME        — session clock, current-app timer, top-apps bar chart
  👁 CAMERA ENHANCED    — blink rate gauge and expression badge
  ▲  SCORE TREND ARROWS — ↑↓→ arrows next to score bars (history diff)
"""
from __future__ import annotations

import tkinter as tk
from collections import deque
from typing import Deque

from PIL import Image, ImageTk
from time_tracker import fmt as fmt_time


# ── State visual styles ───────────────────────────────────────────────────────
STATE_STYLES: dict[str, dict[str, str]] = {
    "calibrating": {
        "badge": "CALIBRATING",
        "bg":    "#0f1e35", "accent": "#60a5fa",
        "bar":   "#1e3a5f", "text":   "#eff6ff", "sub":    "#93c5fd",
    },
    "deep_focus": {
        "badge": "DEEP FOCUS",
        "bg":    "#071a10", "accent": "#22c55e",
        "bar":   "#14532d", "text":   "#f0fdf4", "sub":    "#86efac",
    },
    "ideal": {
        "badge": "IDEAL",
        "bg":    "#0d1a2d", "accent": "#38bdf8",
        "bar":   "#0c4a6e", "text":   "#f0f9ff", "sub":    "#7dd3fc",
    },
    "focused": {
        "badge": "FOCUSED",
        "bg":    "#0d2118", "accent": "#4ade80",
        "bar":   "#14532d", "text":   "#f0fdf4", "sub":    "#86efac",
    },
    "confused": {
        "badge": "CONFUSED",
        "bg":    "#2d1f06", "accent": "#fbbf24",
        "bar":   "#78350f", "text":   "#fffbeb", "sub":    "#fde68a",
    },
    "productive_struggle": {
        "badge": "PRODUCTIVE STRUGGLE",
        "bg":    "#1a1a06", "accent": "#eab308",
        "bar":   "#713f12", "text":   "#fefce8", "sub":    "#fef08a",
    },
    "harmful_confusion": {
        "badge": "HARMFUL CONFUSION",
        "bg":    "#2d1506", "accent": "#f97316",
        "bar":   "#7c2d12", "text":   "#fff7ed", "sub":    "#fed7aa",
    },
    "fatigued": {
        "badge": "FATIGUED",
        "bg":    "#2d0a10", "accent": "#f87171",
        "bar":   "#7f1d1d", "text":   "#fff1f2", "sub":    "#fca5a5",
    },
    "user_not_present": {
        "badge": "USER NOT PRESENT",
        "bg":    "#1f2937", "accent": "#94a3b8",
        "bar":   "#334155", "text":   "#f8fafc", "sub":    "#cbd5e1",
    },
    "steady": {
        "badge": "FOCUSED",
        "bg":    "#0d2118", "accent": "#4ade80",
        "bar":   "#14532d", "text":   "#f0fdf4", "sub":    "#86efac",
    },
}

SCORE_BARS = [
    ("focus_depth",               "Focus depth",         "▲ higher is better"),
    ("attention_residue",         "Attention residue",   "▼ lower is better"),
    ("pre_error_risk",            "Pre-error risk",      "▼ lower is better"),
    ("confusion_risk",            "Confusion risk",      "▼ lower is better"),
    ("fatigue_risk",              "Fatigue risk",        "▼ lower is better"),
    ("interruptibility",          "Interruptibility",    "↔ situational"),
    ("emotional_load",            "Emotional load",      "▼ lower is better"),
    ("cognitive_debt",            "Cognitive debt",      "▼ lower is better"),
]

BAR_W   = 160
BAR_H   = 10
VOL_W   = 200
VOL_H   = 10
APP_BAR = 140


class StatusOverlay:
    def __init__(self, payload_provider, camera_provider=None, refresh_ms: int = 100) -> None:
        self.payload_provider = payload_provider
        self.camera_provider = camera_provider
        self.refresh_ms       = refresh_ms

        # Score history for trend arrows (last 5 snapshots)
        self._score_history: Deque[dict[str, float]] = deque(maxlen=5)

        self._drag_x = self._drag_y = 0
        self._resize_start_w = self._resize_start_h = 0
        self._resize_start_x = self._resize_start_y = 0
        self._content_min_w  = 600
        self._compact_mode = False
        self._last_state_key = "calibrating"

        # ── Root window ───────────────────────────────────────────────────
        self.root = tk.Tk()
        self.root.title("Flow Guardian")
        self.root.overrideredirect(True)
        self.root.attributes("-topmost", True)
        self.root.attributes("-alpha", 0.95)
        self.root.configure(bg="#0b1220")
        self.root.minsize(460, 320)

        w, h = 660, 720
        sw = self.root.winfo_screenwidth()
        self.root.geometry(f"{w}x{h}+{max(sw - w - 20, 0)}+20")

        self.root.bind("<Map>", self._restore_chrome)
        self.root.bind_all("<MouseWheel>",        self._on_mousewheel,       add="+")
        self.root.bind_all("<Shift-MouseWheel>",  self._on_shift_mousewheel, add="+")

        self.compact = tk.Toplevel(self.root)
        self.compact.withdraw()
        self.compact.overrideredirect(True)
        self.compact.attributes("-topmost", True)
        self.compact.attributes("-alpha", 0.97)
        self.compact.configure(bg="#0b1220")
        self.compact.geometry(self._compact_geometry())

        # ── Dashboard Logic ───────────────────────────────────────────────
        self._allowed_apps = {"chrome", "code", "pycharm", "slack", "outlook"}
        try:
            if os.path.exists("focus_rules.json"):
                with open("focus_rules.json", "r") as f:
                    saved = json.load(f)
                    if isinstance(saved, list):
                        self._allowed_apps = set(saved)
        except Exception:
            pass
        self._filter_win = None

        # ── Layout ────────────────────────────────────────────────────────
        self.outer = tk.Frame(self.root, bg="#0b1220", padx=14, pady=10)
        self.outer.pack(fill="both", expand=True)
        self._bind_drag(self.outer)

        # Header
        self.header = tk.Frame(self.outer, bg="#0b1220")
        self.header.pack(fill="x", pady=(0, 8))
        self._bind_drag(self.header)

        self.lbl_title = tk.Label(
            self.header, text="FLOW GUARDIAN",
            font=("Inter Bold", 11, "bold"),
            bg="#0b1220", fg="#94a3b8"
        )
        self.lbl_title.pack(side="left")

        # App Filter Button
        self.btn_filter = tk.Button(
            self.header, text="  RULES  ",
            font=("Inter Bold", 9), cursor="hand2",
            bg="#1e293b", fg="#cbd5e1",
            activebackground="#334155", activeforeground="#f8fafc",
            relief="flat", bd=0, command=self.show_rules
        )
        self.btn_filter.pack(side="right", padx=10)

        self.lbl_voice_coach = tk.Label(
            self.header, text="🔊 AI COACH ACTIVE",
            font=("Segoe UI", 8, "bold"),
            bg="#0f1e35", fg="#60a5fa", padx=8, pady=2, bd=0
        )
        self.lbl_voice_coach.pack(side="left", padx=10)

        for text, cmd, hover_bg in (
            ("_", self._minimize, "#1e3a5f"),
            ("✕", self.close,     "#7f1d1d"),
        ):
            btn = tk.Button(
                self.header, text=text, command=cmd,
                font=("Segoe UI", 10, "bold"), bg="#162033", fg="#e2e8f0",
                activebackground=hover_bg, activeforeground="#f8fafc",
                bd=0, padx=10, pady=2, cursor="hand2",
            )
            btn.pack(side="right", padx=(4, 0))

        self.compact_outer = tk.Frame(self.compact, bg="#0b1220", padx=10, pady=8)
        self.compact_outer.pack(fill="both", expand=True)
        self.compact.bind("<Button-1>", self._restore_from_compact, add="+")
        self.compact_outer.bind("<Button-1>", self._restore_from_compact, add="+")

        self.compact_state = tk.Label(
            self.compact_outer,
            text="OBSERVING",
            font=("Segoe UI", 10, "bold"),
            bg="#0b1220",
            fg="#f8fafc",
            padx=12,
            pady=6,
            cursor="hand2",
        )
        self.compact_state.pack(side="left", fill="x", expand=True)
        self.compact_state.bind("<Button-1>", self._restore_from_compact, add="+")

        self.compact_close = tk.Button(
            self.compact_outer,
            text="âœ•",
            command=self.close,
            font=("Segoe UI", 10, "bold"),
            bg="#162033",
            fg="#e2e8f0",
            activebackground="#7f1d1d",
            activeforeground="#f8fafc",
            bd=0,
            padx=10,
            pady=2,
            cursor="hand2",
        )
        self.compact_close.pack(side="right", padx=(8, 0))

        # Scrollable canvas
        self.viewport = tk.Frame(self.outer, bg="#0b1220")
        self.viewport.pack(fill="both", expand=True)

        self.canvas = tk.Canvas(self.viewport, bg="#0b1220", highlightthickness=0, bd=0)
        self.canvas.pack(side="left", fill="both", expand=True)
        self._bind_drag(self.canvas)

        self.v_scroll = tk.Scrollbar(self.viewport, orient="vertical",  command=self.canvas.yview)
        self.h_scroll = tk.Scrollbar(self.outer,    orient="horizontal", command=self.canvas.xview)
        self.v_scroll.pack(side="right", fill="y")
        self.h_scroll.pack(side="bottom", fill="x", pady=(6, 0))

        self.canvas.configure(
            yscrollcommand=self.v_scroll.set,
            xscrollcommand=self.h_scroll.set,
        )

        self.content = tk.Frame(self.canvas, bg="#0b1220")
        self._bind_drag(self.content)
        self._canvas_win = self.canvas.create_window((0, 0), window=self.content, anchor="nw")
        self.content.bind("<Configure>",
                          lambda _e: self.canvas.configure(scrollregion=self.canvas.bbox("all")))
        self.canvas.bind("<Configure>", self._on_canvas_resize)

        # Resize grip
        self.grip = tk.Label(self.outer, text="//", font=("Segoe UI", 10, "bold"),
                             bg="#162033", fg="#cbd5e1", width=2, cursor="size_nw_se")
        self.grip.pack(side="right", anchor="se", padx=(8, 0), pady=(4, 0))
        self.grip.bind("<ButtonPress-1>", self._start_resize, add="+")
        self.grip.bind("<B1-Motion>",     self._do_resize,    add="+")

        # ════════════════════════════════════════════════════════════════
        # CONTENT WIDGETS
        # ════════════════════════════════════════════════════════════════

        # State badge + title
        self.badge = tk.Label(
            self.content, text="OBSERVING",
            font=("Segoe UI", 10, "bold"),
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
            anchor="w", justify="left", wraplength=560,
        )
        self.lbl_message.pack(anchor="w", fill="x", pady=(2, 8))
        self._bind_drag(self.lbl_message)

        # ── SECTION: Active Time ──────────────────────────────────────────
        self._mk_section("⏱  Active Time")
        self.lbl_time_header = tk.Label(
            self.content, text="Session: —  |  Current app: —  |  Idle: —%",
            font=("Consolas", 9), bg="#0b1220", fg="#94a3b8",
            anchor="w", justify="left",
        )
        self.lbl_time_header.pack(anchor="w", fill="x")
        self._bind_drag(self.lbl_time_header)

        # App time bar chart
        self.app_bars_frame = tk.Frame(self.content, bg="#0b1220")
        self.app_bars_frame.pack(anchor="w", fill="x", pady=(4, 0))
        self._bind_drag(self.app_bars_frame)
        self._app_bar_rows: list[tuple[tk.Label, tk.Canvas, tk.Label]] = []
        for _ in range(6):
            row = tk.Frame(self.app_bars_frame, bg="#0b1220")
            row.pack(anchor="w", fill="x", pady=1)
            name_lbl = tk.Label(row, text="", width=18, anchor="w",
                                font=("Segoe UI", 8), bg="#0b1220", fg="#64748b")
            name_lbl.pack(side="left")
            bar_cvs = tk.Canvas(row, width=APP_BAR, height=8,
                                bg="#1e293b", highlightthickness=0, bd=0)
            bar_cvs.pack(side="left", padx=(2, 4))
            time_lbl = tk.Label(row, text="", width=10, anchor="w",
                                font=("Consolas", 8), bg="#0b1220", fg="#64748b")
            time_lbl.pack(side="left")
            self._app_bar_rows.append((name_lbl, bar_cvs, time_lbl))
            self._bind_drag(row)

        # ── SECTION: Behavior Network ────────────────────────────────────
        # ── SECTION: Live Scores ─────────────────────────────────────────
        self._mk_section("📊  Live Scores")
        self.score_frame = tk.Frame(self.content, bg="#0b1220")
        self.score_frame.pack(anchor="w", fill="x", pady=(0, 6))
        self._bind_drag(self.score_frame)

        self._bar_canvases: dict[str, tk.Canvas] = {}
        self._bar_pct:      dict[str, tk.Label]  = {}
        self._bar_trend:    dict[str, tk.Label]  = {}

        for key, label, hint in SCORE_BARS:
            row = tk.Frame(self.score_frame, bg="#0b1220")
            row.pack(anchor="w", fill="x", pady=1)
            self._bind_drag(row)

            tk.Label(row, text=label, width=22, anchor="w",
                     font=("Segoe UI", 9), bg="#0b1220", fg="#94a3b8").pack(side="left")

            cvs = tk.Canvas(row, width=BAR_W, height=BAR_H,
                            bg="#162033", highlightthickness=0, bd=0)
            cvs.pack(side="left", padx=(2, 4))

            pct_lbl = tk.Label(row, text="  0%", width=5, anchor="w",
                               font=("Consolas", 9), bg="#0b1220", fg="#cbd5e1")
            pct_lbl.pack(side="left")

            # Trend arrow
            trend_lbl = tk.Label(row, text=" →", width=3, anchor="w",
                                 font=("Segoe UI", 9, "bold"), bg="#0b1220", fg="#475569")
            trend_lbl.pack(side="left")

            tk.Label(row, text=hint, anchor="w",
                     font=("Segoe UI", 8), bg="#0b1220", fg="#475569").pack(side="left", padx=(2, 0))

            self._bar_canvases[key] = cvs
            self._bar_pct[key]      = pct_lbl
            self._bar_trend[key]    = trend_lbl

        # ── SECTION: Camera Enhanced ─────────────────────────────────────
        self._mk_section("👁  Camera — Blinks & Expressions")
        self.cam_frame = tk.Frame(self.content, bg="#0b1220")
        self.cam_frame.pack(anchor="w", fill="x", pady=(0, 4))
        self._bind_drag(self.cam_frame)

        self.lbl_video = tk.Label(self.cam_frame, bg="#0b1220")
        self.lbl_video.pack(side="right", anchor="n", padx=(10, 0))

        # Blink rate gauge
        self.lbl_blink = tk.Label(
            self.cam_frame,
            text="Blink rate: — /min   Class: no_data   PERCLOS: —",
            font=("Consolas", 9), bg="#0b1220", fg="#94a3b8",
            anchor="w", justify="left",
        )
        self.lbl_blink.pack(anchor="w", fill="x")
        self._bind_drag(self.lbl_blink)

        # Blink rate bar
        blink_row = tk.Frame(self.cam_frame, bg="#0b1220")
        blink_row.pack(anchor="w", fill="x", pady=(2, 0))
        self._bind_drag(blink_row)
        tk.Label(blink_row, text="Blink gauge", width=14, anchor="w",
                 font=("Segoe UI", 8), bg="#0b1220", fg="#475569").pack(side="left")
        self.blink_canvas = tk.Canvas(blink_row, width=200, height=10,
                                      bg="#162033", highlightthickness=0, bd=0)
        self.blink_canvas.pack(side="left", padx=(2, 6))
        # Normal range marker label
        tk.Label(blink_row, text="←8 normal 20→", width=16, anchor="w",
                 font=("Segoe UI", 7), bg="#0b1220", fg="#374151").pack(side="left")

        # Expression
        self.lbl_expression = tk.Label(
            self.cam_frame,
            text="Expression: neutral",
            font=("Consolas", 9), bg="#0b1220", fg="#94a3b8",
            anchor="w", justify="left",
        )
        self.lbl_expression.pack(anchor="w", fill="x", pady=(4, 0))
        self._bind_drag(self.lbl_expression)

        # ── SECTION: Raw Signals ──────────────────────────────────────────
        self._mk_section("🔬  Raw Signals")
        self.lbl_signals = tk.Label(
            self.content, text="Waiting...",
            font=("Consolas", 9), bg="#0b1220", fg="#94a3b8",
            anchor="w", justify="left",
        )
        self.lbl_signals.pack(anchor="w", fill="x")
        self._bind_drag(self.lbl_signals)

        # ── SECTION: Interruption Queue ────────────────────────────────────
        self._mk_section("🔔  Interruption Queue")
        self.lbl_queue = tk.Label(
            self.content, text="— Queue is empty",
            font=("Consolas", 9), bg="#0b1220", fg="#94a3b8",
            anchor="w", justify="left",
        )
        self.lbl_queue.pack(anchor="w", fill="x")
        self._bind_drag(self.lbl_queue)

        # ── SECTION: Artifact Friction ─────────────────────────────────────
        self._mk_section("⚡  Artifact Friction")
        self.lbl_artifact = tk.Label(
            self.content, text="No artifact data yet.",
            font=("Consolas", 9), bg="#0b1220", fg="#94a3b8",
            anchor="w", justify="left",
        )
        self.lbl_artifact.pack(anchor="w", fill="x")
        self._bind_drag(self.lbl_artifact)

        # ── SECTION: Classifier Detail ─────────────────────────────────────
        self._mk_section("🧠  Classifier Detail")
        self.lbl_classifier = tk.Label(
            self.content, text="— Awaiting calibration",
            font=("Consolas", 9), bg="#0b1220", fg="#94a3b8",
            anchor="w", justify="left",
        )
        self.lbl_classifier.pack(anchor="w", fill="x")
        self._bind_drag(self.lbl_classifier)

        # ── SECTION: Recent Events ─────────────────────────────────────────
        self._mk_section("📋  Recent Events")
        self.lbl_events = tk.Label(
            self.content, text="— No events yet.",
            font=("Consolas", 9), bg="#0b1220", fg="#cbd5e1",
            anchor="w", justify="left", wraplength=560,
        )
        self.lbl_events.pack(anchor="w", fill="x")
        self._bind_drag(self.lbl_events)

        # ── Hint bar ──────────────────────────────────────────────────────
        self.lbl_hint = tk.Label(
            self.content,
            text="Drag to move  ·  _ to minimise  ·  // grip to resize  ·  Shift+scroll ↔",
            font=("Segoe UI", 8), bg="#0b1220", fg="#334155",
            anchor="w", justify="left",
        )
        self.lbl_hint.pack(anchor="w", pady=(8, 0), fill="x")
        self._bind_drag(self.lbl_hint)

    def show_rules(self) -> None:
        """Pop up a premium styled window to allow/deny app notifications."""
        if self._filter_win and self._filter_win.winfo_exists():
            self._filter_win.lift()
            return

        self._filter_win = tk.Toplevel(self.root)
        self._filter_win.title("Filter Rules - Flow Guardian")
        self._filter_win.configure(bg="#0f172a") # Darker slate
        self._filter_win.geometry("450x650")
        self._filter_win.attributes("-topmost", True)

        # Header with Gradient-like feel
        header = tk.Frame(self._filter_win, bg="#1e293b", pady=15)
        header.pack(fill="x")
        
        tk.Label(
            header, text="NOTIFICATION RULES",
            bg="#1e293b", fg="#3b82f6", font=("Inter Bold", 12, "bold")
        ).pack()
        
        tk.Label(
            header, text="Choose which apps can bypass focus mode",
            bg="#1e293b", fg="#94a3b8", font=("Inter", 9)
        ).pack(pady=(2, 0))

        # Search Bar
        search_frame = tk.Frame(self._filter_win, bg="#0f172a", pady=10)
        search_frame.pack(fill="x", padx=30)
        
        self.app_search_var = tk.StringVar()
        self.app_search_var.trace_add("write", lambda *args: self._update_filter_list())
        
        search_ent = tk.Entry(
            search_frame, textvariable=self.app_search_var,
            bg="#1e293b", fg="white", font=("Inter", 11),
            relief="flat", insertbackground="white", highlightthickness=1,
            highlightbackground="#334155"
        )
        search_ent.pack(fill="x", ipady=8, padx=5)
        search_ent.insert(0, "Search apps...")
        search_ent.bind("<FocusIn>", lambda e: search_ent.delete(0, 'end') if search_ent.get() == "Search apps..." else None)

        # Scrollable List Area
        self.apps_scroll_frame = tk.Frame(self._filter_win, bg="#0f172a")
        self.apps_scroll_frame.pack(fill="both", expand=True, padx=30, pady=10)

        self._update_filter_list()

        # Bottom Bar
        footer = tk.Frame(self._filter_win, bg="#0f172a", pady=20)
        footer.pack(fill="x")
        
        tk.Button(
            footer, text="SAVE & DONE",
            bg="#3b82f6", fg="white", font=("Inter Bold", 10, "bold"),
            relief="flat", cursor="hand2", pady=12, width=30,
            command=self._filter_win.destroy
        ).pack()

    def _update_filter_list(self) -> None:
        # Clear current list
        for widget in self.apps_scroll_frame.winfo_children():
            widget.destroy()

        search_q = self.app_search_var.get().lower()
        if search_q == "search apps...": search_q = ""

        # Common apps + user discovered apps
        all_known = sorted(list({"chrome", "slack", "code", "pycharm", "outlook", "discord", "teams", "spotify", "zoom", "notion"}))
        
        for app in all_known:
            if search_q and search_q not in app.lower():
                continue
                
            row = tk.Frame(self.apps_scroll_frame, bg="#0f172a", pady=4)
            row.pack(fill="x")
            
            is_on = app in self._allowed_apps
            var = tk.BooleanVar(value=is_on)
            
            cb = tk.Checkbutton(
                row, text=f"  {app.capitalize()}",
                variable=var, bg="#0f172a", fg="#cbd5e1",
                selectcolor="#1e293b", activebackground="#0f172a",
                activeforeground="white", font=("Inter", 11),
                relief="flat", command=lambda a=app, v=var: self._toggle_app(a, v.get())
            )
            cb.pack(side="left")

    def _toggle_app(self, app: str, allowed: bool) -> None:
        if allowed: self._allowed_apps.add(app)
        else: self._allowed_apps.discard(app)
        try:
            with open("focus_rules.json", "w") as f:
                import json
                json.dump(list(self._allowed_apps), f)
        except Exception: pass

    # ── Run loop ──────────────────────────────────────────────────────────────
    def run(self) -> None:
        self._refresh()
        self.root.mainloop()

    def close(self) -> None:
        try:
            self.compact.destroy()
        except Exception:
            pass
        self.root.destroy()

    # ── Refresh ───────────────────────────────────────────────────────────────
    def _refresh(self) -> None:
        try:
            snap = self.payload_provider()
            self._render(snap)
            self._render_video()
        except Exception:
            pass
        self.root.after(self.refresh_ms, self._refresh)

    def _render_video(self) -> None:
        if not self.camera_provider:
            return
        frame = self.camera_provider()
        if frame is not None:
            try:
                img = Image.fromarray(frame)
                img.thumbnail((240, 180), Image.Resampling.LANCZOS)
                img_tk = ImageTk.PhotoImage(image=img)
                self.lbl_video.img_tk = img_tk
                self.lbl_video.configure(image=img_tk)
            except Exception:
                pass

    def _render(self, snap: dict) -> None:
        state_info  = snap.get("state", {})
        features    = snap.get("features", {})
        keyboard    = snap.get("keyboard", {})
        camera      = snap.get("camera", {})
        system      = snap.get("system", {})
        scores      = snap.get("scores", {})
        broker      = snap.get("core_features", {}).get("interruption_broker", {})
        artifact    = snap.get("artifact", {})
        ctx         = snap.get("contextual_enrichment", {})
        events      = snap.get("recent_events", [])
        time_data   = snap.get("time_tracker", {})
        cam_enh     = snap.get("core_features", {}).get("camera_enhanced", {})

        state_name  = str(state_info.get("name", "calibrating"))
        state_label = str(snap.get("state_label", state_name))
        style_key   = state_label if state_label in STATE_STYLES else state_name
        style       = STATE_STYLES.get(style_key, STATE_STYLES["calibrating"])
        self._last_state_key = style_key
        bg          = style["bg"]
        confidence  = int(float(state_info.get("confidence", 0.6)) * 100)

        # ── Update score trend history ────────────────────────────────────
        self._score_history.append({k: float(scores.get(k, 0.0)) for k, _, _ in SCORE_BARS})

        # ── Recolour all widget backgrounds ──────────────────────────────
        all_widgets = [
            self.root, self.outer, self.header, self.viewport, self.canvas,
            self.content, self.score_frame, self.cam_frame,
            self.app_bars_frame, self.lbl_title, self.lbl_state_title,
            self.lbl_message, self.lbl_signals, self.lbl_queue, self.lbl_artifact,
            self.lbl_classifier, self.lbl_events, self.lbl_hint,
            self.lbl_time_header, self.lbl_blink, self.lbl_expression,
            self.blink_canvas,
        ]
        for w in all_widgets:
            try:
                w.configure(bg=bg)
            except Exception:
                pass

        self.badge.configure(
            text=f"  {style['badge']}  {confidence}%  ",
            bg=style["accent"], fg="#081018",
        )
        self.lbl_state_title.configure(
            text=_state_title(state_label or state_name),
            fg=style["text"],
        )
        self.lbl_message.configure(
            text=str(state_info.get("message", "")),
            fg=style["sub"],
        )
        self._render_compact(style, state_label or state_name)

        # ── Active Time section ───────────────────────────────────────────
        session_lbl     = str(time_data.get("session_label",      "—"))
        cur_app_lbl     = str(time_data.get("current_app_label",  "—"))
        idle_pct        = int(float(time_data.get("idle_fraction", 0)) * 100)
        cur_app_name    = str(time_data.get("current_app",         "—"))[:20]

        self.lbl_time_header.configure(
            text=(
                f"Session: {session_lbl}   |   "
                f"{cur_app_name}: {cur_app_lbl}   |   "
                f"Idle: {idle_pct}%"
            ),
            fg=style["sub"], bg=bg,
        )

        top_apps = time_data.get("top_apps", [])
        max_secs = max((a.get("seconds", 0) for a in top_apps), default=1)
        for idx, (name_lbl, bar_cvs, time_lbl) in enumerate(self._app_bar_rows):
            name_lbl.configure(bg=bg)
            bar_cvs.configure(bg=style["bar"])
            time_lbl.configure(bg=bg)
            if idx < len(top_apps):
                entry = top_apps[idx]
                app_n = str(entry.get("app", "?"))[:18]
                secs  = int(entry.get("seconds", 0))
                ratio = secs / max(max_secs, 1)
                fill  = int(ratio * APP_BAR)
                bar_cvs.delete("all")
                if fill > 0:
                    bar_cvs.create_rectangle(0, 0, fill, 8, fill=style["accent"], outline="")
                name_lbl.configure(text=app_n, fg=style["sub"])
                time_lbl.configure(text=fmt_time(secs), fg=style["sub"])
            else:
                bar_cvs.delete("all")
                name_lbl.configure(text="", fg="#374151")
                time_lbl.configure(text="", fg="#374151")


        # ── Score bars with trend arrows ──────────────────────────────────
        for key, _label, _hint in SCORE_BARS:
            val     = float(scores.get(key, 0.0))
            pct     = int(val * 100)
            fill_w  = int(val * BAR_W)
            cvs     = self._bar_canvases[key]
            cvs.configure(bg=style["bar"])
            cvs.delete("all")
            if fill_w > 0:
                cvs.create_rectangle(0, 0, fill_w, BAR_H,
                                     fill=_bar_color(key, val, style), outline="")
            self._bar_pct[key].configure(text=f"{pct:3d}%", bg=bg, fg=style["sub"])
            self._bar_trend[key].configure(
                text=_trend_arrow(key, val, self._score_history),
                bg=bg,
                fg=_trend_color(key, val, self._score_history),
            )

        for child in self.score_frame.winfo_children():
            try:
                child.configure(bg=bg)
            except Exception:
                pass
            for sub in child.winfo_children():
                try:
                    sub.configure(bg=bg)
                except Exception:
                    pass

        # ── Camera Enhanced section ───────────────────────────────────────
        blink_rate   = float(cam_enh.get("blink_rate_per_min", 0.0))
        blink_class  = str(cam_enh.get("blink_rate_class", "no_data"))
        perclos_val  = float(cam_enh.get("perclos", 0.0))
        expression   = str(cam_enh.get("expression", "neutral"))
        low_blink    = bool(cam_enh.get("low_blink_rate", False))
        cam_status   = str(cam_enh.get("cam_status", "unavailable"))

        blink_class_display = blink_class.replace("_", " ")
        low_flag = "  ⚠ EYE STRAIN" if low_blink else ""

        self.lbl_blink.configure(
            text=(
                f"Blink rate: {blink_rate:.1f}/min   "
                f"Class: {blink_class_display}{low_flag}   "
                f"PERCLOS: {perclos_val:.3f}   "
                f"Cam: {cam_status}"
            ),
            fg=("#f87171" if low_blink or perclos_val > 0.15 else style["sub"]),
            bg=bg,
        )

        # Blink rate gauge bar (normalised: 0=/min, 40+=full)
        self.blink_canvas.configure(bg=style["bar"])
        self.blink_canvas.delete("all")
        blink_ratio = min(blink_rate / 40.0, 1.0)
        blink_fill  = int(blink_ratio * 200)
        # Draw normal zone marker (8–20 /min → 40px–100px of 200)
        self.blink_canvas.create_rectangle(40, 0, 100, 10, fill="#1a3a1a", outline="")
        if blink_fill > 0:
            blink_color = (
                "#f87171" if blink_rate < 8 or blink_rate > 30
                else "#4ade80" if 12 <= blink_rate <= 20
                else "#fbbf24"
            )
            self.blink_canvas.create_rectangle(0, 0, blink_fill, 10, fill=blink_color, outline="")

        expr_emoji = {
            "neutral":   "😐 neutral",
            "concerned": "😟 concerned",
            "surprised": "😲 surprised",
            "squinting": "😑 squinting",
        }.get(expression, expression)

        self.lbl_expression.configure(text=f"Expression: {expr_emoji}", fg=style["sub"], bg=bg)

        # ── Raw Signals ───────────────────────────────────────────────────
        perclos_str = (
            f"{perclos_val:.3f}"
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

        # ── Interruption Queue ────────────────────────────────────────────
        pending     = broker.get("pending_queue", [])
        pending_cnt = int(broker.get("pending_count", 0))
        if pending_cnt == 0:
            queue_text = f"— Queue empty  (interruptibility {int(float(scores.get('interruptibility', 0)) * 100)}%)"
        else:
            items = [f"  · {i.get('source', '?')} [{i.get('urgency', '?')}]" for i in pending[:5]]
            queue_text = f"{pending_cnt} interruption(s) held:\n" + "\n".join(items)
        self.lbl_queue.configure(text=queue_text, fg=style["sub"], bg=bg)

        # ── Artifact Friction ─────────────────────────────────────────────
        art_label    = str(artifact.get("artifact_label", "Unknown"))[:60]
        art_friction = float(artifact.get("friction_score", 0.0))
        art_visits   = int(artifact.get("visits",   0))
        art_revisits = int(artifact.get("revisits", 0))
        self.lbl_artifact.configure(
            text=(
                f"{art_label}\n"
                f"  Friction={art_friction:.3f}  "
                f"visits={art_visits}  revisits={art_revisits}"
            ),
            fg=style["sub"], bg=bg,
        )

        # ── Classifier Detail ─────────────────────────────────────────────
        z      = state_info.get("z_scores",  {})
        cls_sc = state_info.get("scores",    {})
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

        # ── Events ────────────────────────────────────────────────────────
        evt_text = "\n".join(f"  {e}" for e in events[-8:]) if events else "— No events yet."
        self.lbl_events.configure(text=evt_text, fg=style["sub"], bg=bg)

    @staticmethod
    def _graph_node_color(kind: str, style: dict[str, str]) -> str:
        palette = {
            "user": "#93c5fd",
            "app": "#fbbf24",
            "state": style["accent"],
            "artifact": "#c084fc",
            "signal": "#f87171",
        }
        return palette.get(kind, style["accent"])

    # ── Helper: section header ────────────────────────────────────────────────
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

    # ── Canvas resize ─────────────────────────────────────────────────────────
    def _on_canvas_resize(self, event) -> None:
        w = max(event.width, self._content_min_w)
        self.canvas.itemconfigure(self._canvas_win, width=w)
        wrap = max(w - 28, 240)
        for lbl in (self.lbl_message, self.lbl_events, self.lbl_hint):
            lbl.configure(wraplength=wrap)
        self.canvas.configure(scrollregion=self.canvas.bbox("all"))

    # ── Window management ─────────────────────────────────────────────────────
    def _prompt_break(self, limit_sec: int = 300) -> None:
        popup = tk.Toplevel(self.root)
        popup.title("Break Time")
        popup.attributes("-topmost", True)
        popup.configure(bg="#0b1220")
        
        w, h = 350, 160
        sw = self.root.winfo_screenwidth()
        sh = self.root.winfo_screenheight()
        popup.geometry(f"{w}x{h}+{(sw-w)//2}+{(sh-h)//2}")

        msg = "You've been deeply focused for 30 mins." if limit_sec == 1800 else "You appear fatigued."
        tk.Label(popup, text=msg, font=("Segoe UI", 10), bg="#0b1220", fg="#cbd5e1").pack(pady=(20, 5))
        tk.Label(popup, text="Would you like to take a 5-minute break?", font=("Segoe UI", 11, "bold"), bg="#0b1220", fg="#f8fafc").pack(pady=(0, 20))
        
        btn_frame = tk.Frame(popup, bg="#0b1220")
        btn_frame.pack()
        
        def reset_timer():
            self._demo_start_ts = __import__('time').time()
            self._break_prompted = False
            popup.destroy()

        tk.Button(btn_frame, text="Yes (5m Break)", command=reset_timer, width=14, cursor="hand2", bg="#22c55e", fg="#052e16", font=("Segoe UI", 9, "bold"), bd=0, pady=4).pack(side="left", padx=10)
        tk.Button(btn_frame, text="Not Now", command=reset_timer, width=10, cursor="hand2", bg="#1e293b", fg="#e2e8f0", font=("Segoe UI", 9, "bold"), bd=0, pady=4).pack(side="left", padx=10)

    def _minimize(self) -> None:
        self._compact_mode = True
        self.root.withdraw()
        self._show_compact()

    def _restore_chrome(self, _event=None) -> None:
        if self._compact_mode:
            return
        if self.root.state() == "normal":
            self.root.after(10, self._reapply_overlay)

    def _reapply_overlay(self) -> None:
        self.root.overrideredirect(True)
        self.root.attributes("-topmost", True)

    def _show_compact(self) -> None:
        self.compact.geometry(self._compact_geometry())
        self.compact.deiconify()
        self.compact.lift()

    def _restore_from_compact(self, _event=None) -> None:
        self._compact_mode = False
        self.compact.withdraw()
        self.root.overrideredirect(False)
        self.root.deiconify()
        self.root.state("normal")
        self.root.update_idletasks()
        self.root.lift()
        self.root.after(10, self._reapply_overlay)

    def _compact_geometry(self) -> str:
        width = 140 if self._last_state_key in {"focused", "deep_focus"} else 250
        height = 56
        sw = self.root.winfo_screenwidth()
        sh = self.root.winfo_screenheight()
        x = max(sw - width - 20, 0)
        y = max(sh - height - 60, 0)
        return f"{width}x{height}+{x}+{y}"

    def _render_compact(self, style: dict[str, str], state_label: str) -> None:
        # Only update the compact badge after the state has persisted for 3+ refresh cycles
        # This prevents 1-second camera flickers from spamming the minimised pill badge
        self._compact_persist_count = getattr(self, "_compact_persist_count", 0)
        self._compact_last_state    = getattr(self, "_compact_last_state", "")
        if state_label == self._compact_last_state:
            self._compact_persist_count += 1
        else:
            self._compact_persist_count = 0
            self._compact_last_state    = state_label
        if self._compact_persist_count < 3:
            return  # Don't update compact until state persists 3 consecutive cycles
        show_state = self._last_state_key not in {"focused", "deep_focus"}
        compact_text = (
            style.get("badge", state_label.replace("_", " ").upper())
            if show_state else
            "OPEN"
        )
        for widget in (self.compact, self.compact_outer):
            widget.configure(bg=style["bg"])
        self.compact_state.configure(
            text=f" {compact_text} ",
            bg=style["accent"] if show_state else "#162033",
            fg="#081018" if show_state else "#e2e8f0",
        )
        self.compact_close.configure(bg="#162033", fg="#e2e8f0")
        if self._compact_mode:
            self._show_compact()

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
        nw = max(self.root.winfo_reqwidth(),  self._resize_start_w + event.x_root - self._resize_start_x, 460)
        nh = max(self.root.winfo_reqheight(), self._resize_start_h + event.y_root - self._resize_start_y, 320)
        self.root.geometry(f"{nw}x{nh}")

    def _on_mousewheel(self, event) -> None:
        under = self.root.winfo_containing(event.x_root, event.y_root)
        if under is not None and (under == self.root or _is_descendant(under, self.canvas)):
            self.canvas.yview_scroll(int(-event.delta / 120), "units")

    def _on_shift_mousewheel(self, event) -> None:
        under = self.root.winfo_containing(event.x_root, event.y_root)
        if under is not None and (under == self.root or _is_descendant(under, self.canvas)):
            self.canvas.xview_scroll(int(-event.delta / 120), "units")


# ── Module-level helpers ──────────────────────────────────────────────────────
def _state_title(state: str) -> str:
    return {
        "calibrating":         "Calibrating your personal baseline…",
        "deep_focus":          "Interaction pattern: deep focus — do not disturb.",
        "ideal":               "Interaction pattern: no recent input detected.",
        "focused":             "Interaction pattern: focused work.",
        "confused":            "Interaction pattern: confusion or exploration.",
        "productive_struggle": "Interaction pattern: productive struggle — learning in progress.",
        "harmful_confusion":   "Interaction pattern: harmful confusion — break suggested.",
        "fatigued":            "Interaction pattern: fatigue detected — rest recommended.",
        "user_not_present":    "Interaction pattern: user not present.",
        "steady":              "Interaction pattern: focused work.",
    }.get(state, "Observing…")


def _bar_color(key: str, val: float, style: dict) -> str:
    good_keys = {"focus_depth", "interruptibility"}
    if key in good_keys:
        if val >= 0.65: return "#4ade80"
        if val >= 0.40: return "#fbbf24"
        return "#f87171"
    else:
        if val <= 0.35: return "#4ade80"
        if val <= 0.60: return "#fbbf24"
        return "#f87171"


def _trend_arrow(key: str, current: float, history: "Deque[dict]") -> str:
    """Compare to oldest entry in history to compute trend."""
    if len(history) < 2:
        return " →"
    oldest = list(history)[0].get(key, current)
    delta  = current - oldest
    if abs(delta) < 0.03:
        return " →"
    return " ↑" if delta > 0 else " ↓"


def _trend_color(key: str, current: float, history: "Deque[dict]") -> str:
    """Red/green depending on whether the trend is good or bad."""
    if len(history) < 2:
        return "#475569"
    good_keys  = {"focus_depth", "interruptibility"}
    oldest     = list(history)[0].get(key, current)
    delta      = current - oldest
    if abs(delta) < 0.03:
        return "#475569"
    improving  = (delta > 0) if key in good_keys else (delta < 0)
    return "#4ade80" if improving else "#f87171"


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


# ── ONNX Inference Viewer Window ──────────────────────────────────────────────

_ONNX_BG      = "#06090f"
_ONNX_PANEL   = "#0d1424"
_ONNX_BORDER  = "#1e2d45"
_ONNX_ACCENT  = "#38bdf8"
_ONNX_GREEN   = "#4ade80"
_ONNX_YELLOW  = "#fbbf24"
_ONNX_RED     = "#f87171"
_ONNX_TEXT    = "#e2e8f0"
_ONNX_SUB     = "#64748b"
_ONNX_WARM    = "#f59e0b"

# (key, label, higher_is_better)
_ONNX_GAUGES = [
    ("attention_residue",  "Attention Residue",   False),
    ("pre_error_prob",     "Pre-Error Prob",       False),
    ("interruptibility",   "Interruptibility",     True),
    ("capsule_trigger",    "Capsule Trigger",       False),
    ("confusion_friction", "Confusion Friction",   False),
    ("personal_deviation", "Personal Deviation",   False),
]

_STRUGGLE_COLORS = {
    "productive": _ONNX_GREEN,
    "harmful":    _ONNX_RED,
    "neutral":    _ONNX_YELLOW,
}

_STATE_COLORS = {
    "focused":  _ONNX_GREEN,
    "confused": _ONNX_YELLOW,
    "fatigued": _ONNX_RED,
}


class ONNXViewerWindow:
    """
    A separate Tk Toplevel window giving a live, real-time view of what
    the FlowGuardian ONNX inference engine is producing.

    Layout
    ──────
    ┌────────────────────────────────────┐
    │  🤖 ONNX Flow Guardian             │
    │  ● COGNITIVE STATE  focused  95%   │
    │  Struggle type: productive         │
    ├── Output Scores ───────────────────┤
    │  [Attention Residue]  ██░░░░  23%  │
    │  [Pre-Error Prob]     ████░░  61%  │
    │  …                                 │
    ├── Input Features ──────────────────┤
    │  iki_mean_ms=210  wpm=48  …        │
    ├── Inference Log ────────────────────┤
    │  00:12:34  focused  res=0.23 …     │
    │  00:12:04  focused  res=0.21 …     │
    └────────────────────────────────────┘
    """

    _GAUGE_W   = 200
    _GAUGE_H   = 12
    _LOG_LINES = 20

    def __init__(self, parent: tk.Tk, payload_provider, refresh_ms: int = 500) -> None:
        self.payload_provider = payload_provider
        self.refresh_ms       = refresh_ms
        self._log: list[str]  = []

        self.win = tk.Toplevel(parent)
        self.win.title("ONNX Inference Viewer — Flow Guardian")
        self.win.configure(bg=_ONNX_BG)
        self.win.attributes("-topmost", True)
        self.win.attributes("-alpha", 0.96)
        self.win.resizable(True, True)

        sw = self.win.winfo_screenwidth()
        w, h = 520, 760
        # Place to the LEFT of the main overlay (which sits at screen-right)
        self.win.geometry(f"{w}x{h}+{max(sw - w - 700, 0)}+20")

        self._build_ui()
        self._schedule_refresh()

    # ── UI construction ───────────────────────────────────────────────────────

    def _build_ui(self) -> None:
        outer = tk.Frame(self.win, bg=_ONNX_BG, padx=14, pady=10)
        outer.pack(fill="both", expand=True)

        # ── Header ────────────────────────────────────────────────────────
        hdr = tk.Frame(outer, bg=_ONNX_BG)
        hdr.pack(fill="x", pady=(0, 8))
        tk.Label(
            hdr, text="🤖  ONNX Inference Viewer",
            font=("Segoe UI", 12, "bold"), bg=_ONNX_BG, fg=_ONNX_TEXT, anchor="w",
        ).pack(side="left", fill="x", expand=True)
        tk.Button(
            hdr, text="✕", command=self.win.destroy,
            font=("Segoe UI", 10, "bold"), bg="#1e1e2e", fg=_ONNX_TEXT,
            activebackground="#7f1d1d", activeforeground="#f8fafc",
            bd=0, padx=10, pady=2, cursor="hand2",
        ).pack(side="right")

        # ── Scrollable body ───────────────────────────────────────────────
        vp = tk.Frame(outer, bg=_ONNX_BG)
        vp.pack(fill="both", expand=True)

        self._canvas = tk.Canvas(vp, bg=_ONNX_BG, highlightthickness=0, bd=0)
        self._canvas.pack(side="left", fill="both", expand=True)
        vsb = tk.Scrollbar(vp, orient="vertical", command=self._canvas.yview)
        vsb.pack(side="right", fill="y")
        self._canvas.configure(yscrollcommand=vsb.set)

        self._body = tk.Frame(self._canvas, bg=_ONNX_BG)
        self._canvas.create_window((0, 0), window=self._body, anchor="nw")
        self._body.bind(
            "<Configure>",
            lambda _e: self._canvas.configure(scrollregion=self._canvas.bbox("all")),
        )
        self._canvas.bind("<MouseWheel>",
            lambda e: self._canvas.yview_scroll(int(-e.delta / 120), "units"))

        # ── Status banner ─────────────────────────────────────────────────
        self._banner = tk.Label(
            self._body,
            text="⏳  Warming up — waiting for 5 context windows…",
            font=("Segoe UI", 10, "bold"),
            bg=_ONNX_WARM, fg="#1c1007",
            anchor="w", padx=10, pady=5,
        )
        self._banner.pack(fill="x", pady=(0, 6))

        # ── Cognitive state pill ─────────────────────────────────────────
        self._mk_section("🧠  Cognitive State Output")
        state_row = tk.Frame(self._body, bg=_ONNX_PANEL, pady=8, padx=12)
        state_row.pack(fill="x", pady=(0, 2))
        self._lbl_state = tk.Label(
            state_row,
            text="— Awaiting inference",
            font=("Segoe UI", 18, "bold"),
            bg=_ONNX_PANEL, fg=_ONNX_ACCENT, anchor="w",
        )
        self._lbl_state.pack(side="left")
        self._lbl_struggle = tk.Label(
            state_row,
            text="",
            font=("Segoe UI", 10),
            bg=_ONNX_PANEL, fg=_ONNX_SUB, anchor="e",
        )
        self._lbl_struggle.pack(side="right")

        # Context: windows collected
        self._lbl_context = tk.Label(
            self._body,
            text="Context windows: 0/5  |  Last inference: —",
            font=("Consolas", 9), bg=_ONNX_BG, fg=_ONNX_SUB, anchor="w",
        )
        self._lbl_context.pack(anchor="w", pady=(4, 8), padx=2)

        # ── Output score gauges ───────────────────────────────────────────
        self._mk_section("📊  Model Output Scores")
        self._gauge_canvases: dict[str, tk.Canvas] = {}
        self._gauge_vals:     dict[str, tk.Label]  = {}

        for key, label, higher_good in _ONNX_GAUGES:
            row = tk.Frame(self._body, bg=_ONNX_BG)
            row.pack(fill="x", pady=2)
            direction = "▲ higher better" if higher_good else "▼ lower better"
            tk.Label(
                row, text=label, width=20, anchor="w",
                font=("Segoe UI", 9), bg=_ONNX_BG, fg=_ONNX_TEXT,
            ).pack(side="left")
            cvs = tk.Canvas(
                row, width=self._GAUGE_W, height=self._GAUGE_H,
                bg=_ONNX_BORDER, highlightthickness=0, bd=0,
            )
            cvs.pack(side="left", padx=(4, 6))
            val_lbl = tk.Label(
                row, text=" —%", width=6, anchor="w",
                font=("Consolas", 9), bg=_ONNX_BG, fg=_ONNX_TEXT,
            )
            val_lbl.pack(side="left")
            tk.Label(
                row, text=direction, anchor="w",
                font=("Segoe UI", 8), bg=_ONNX_BG, fg=_ONNX_SUB,
            ).pack(side="left", padx=(4, 0))
            self._gauge_canvases[key] = cvs
            self._gauge_vals[key]     = val_lbl

        # ── Input features ────────────────────────────────────────────────
        self._mk_section("🔎  Input Features (Last Window)")
        self._lbl_features = tk.Label(
            self._body,
            text="— Waiting for first inference…",
            font=("Consolas", 8), bg=_ONNX_BG, fg=_ONNX_SUB,
            anchor="w", justify="left", wraplength=480,
        )
        self._lbl_features.pack(anchor="w", fill="x", padx=2)

        # ── Inference log ─────────────────────────────────────────────────
        self._mk_section(f"📋  Inference Log (last {self._LOG_LINES})")
        self._log_text = tk.Text(
            self._body,
            font=("Consolas", 8),
            bg=_ONNX_PANEL, fg=_ONNX_TEXT,
            relief="flat", bd=0,
            height=self._LOG_LINES,
            state="disabled",
            wrap="word",
        )
        self._log_text.pack(fill="x", padx=2, pady=(0, 6))
        self._log_text.tag_configure("focused",  foreground=_ONNX_GREEN)
        self._log_text.tag_configure("confused",  foreground=_ONNX_YELLOW)
        self._log_text.tag_configure("fatigued",  foreground=_ONNX_RED)
        self._log_text.tag_configure("warmup",    foreground=_ONNX_WARM)
        self._log_text.tag_configure("ts",        foreground=_ONNX_SUB)

    # ── Section helper ────────────────────────────────────────────────────────

    def _mk_section(self, title: str) -> None:
        tk.Label(
            self._body, text=title,
            font=("Segoe UI", 9, "bold"), bg=_ONNX_BG, fg=_ONNX_ACCENT, anchor="w",
        ).pack(anchor="w", pady=(10, 2), fill="x")
        tk.Frame(self._body, bg=_ONNX_BORDER, height=1).pack(fill="x", pady=(0, 4))

    # ── Refresh loop ──────────────────────────────────────────────────────────

    def _schedule_refresh(self) -> None:
        try:
            self._refresh()
        except Exception:
            pass
        self.win.after(self.refresh_ms, self._schedule_refresh)

    def _refresh(self) -> None:
        try:
            snap = self.payload_provider()
        except Exception:
            return

        ml_state   = snap.get("ml_state")
        onnx_info  = snap.get("core_features", {}).get("onnx_inference", {})

        engine_enabled = bool(onnx_info.get("enabled", False))
        ml_ready       = bool(onnx_info.get("ready",   False))
        ml_features    = onnx_info.get("features") or {}
        age_s          = onnx_info.get("last_result_age_seconds")

        # How many context windows have been gathered (infer from history length)
        # We track via the inference engine's local counter via onnx_info
        ctx_windows = 5 if ml_ready else (
            len(ml_features) // 18 if ml_features else 0
        )

        # ── Banner & status ───────────────────────────────────────────────
        if not engine_enabled:
            self._banner.configure(
                text="❌  ONNX Engine disabled — model file not found.",
                bg=_ONNX_RED, fg="#0f0505",
            )
        elif not ml_ready:
            self._banner.configure(
                text="⏳  Warming up — collecting context windows (need 5×30s = 2.5 min)…",
                bg=_ONNX_WARM, fg="#1c1007",
            )
        else:
            self._banner.configure(
                text="✅  ONNX Engine active — inference every 30 s",
                bg="#14532d", fg="#f0fdf4",
            )

        age_str = f"{age_s:.0f}s ago" if isinstance(age_s, (int, float)) else "—"
        self._lbl_context.configure(
            text=(
                f"Engine: {'ON' if engine_enabled else 'OFF'}  |  "
                f"Ready: {'YES' if ml_ready else 'NO'}  |  "
                f"Last inference: {age_str}"
            )
        )

        # ── Cognitive state & struggle ────────────────────────────────────
        if isinstance(ml_state, dict):
            cog_state = str(ml_state.get("cognitive_state", "—"))
            struggle  = str(ml_state.get("struggle_type",   "—"))
            state_color = _STATE_COLORS.get(cog_state, _ONNX_ACCENT)
            struggle_color = _STRUGGLE_COLORS.get(struggle, _ONNX_SUB)
            self._lbl_state.configure(
                text=f"  {cog_state.upper()}",
                fg=state_color,
                bg=_ONNX_PANEL,
            )
            self._lbl_struggle.configure(
                text=f"Struggle: {struggle}  ",
                fg=struggle_color,
                bg=_ONNX_PANEL,
            )
            # ── Gauges ───────────────────────────────────────────────────
            for key, _label, higher_good in _ONNX_GAUGES:
                raw_val = ml_state.get(key)
                if not isinstance(raw_val, (int, float)):
                    continue
                val   = float(raw_val)
                pct   = int(val * 100)
                fill  = int(val * self._GAUGE_W)
                cvs   = self._gauge_canvases[key]
                cvs.delete("all")
                if fill > 0:
                    if higher_good:
                        color = _ONNX_GREEN if val >= 0.6 else (_ONNX_YELLOW if val >= 0.35 else _ONNX_RED)
                    else:
                        color = _ONNX_GREEN if val <= 0.35 else (_ONNX_YELLOW if val <= 0.60 else _ONNX_RED)
                    cvs.create_rectangle(0, 0, fill, self._GAUGE_H, fill=color, outline="")
                self._gauge_vals[key].configure(text=f"{pct:3d}%")

            # ── Append to log ─────────────────────────────────────────────
            import time as _time
            ts = _time.strftime("%H:%M:%S")
            log_line = (
                f"{ts}  {cog_state:<10}  "
                f"res={ml_state.get('attention_residue', 0):.3f}  "
                f"err={ml_state.get('pre_error_prob', 0):.3f}  "
                f"int={ml_state.get('interruptibility', 0):.3f}  "
                f"frict={ml_state.get('confusion_friction', 0):.3f}  "
                f"dev={ml_state.get('personal_deviation', 0):.3f}  "
                f"str={struggle}"
            )
            if not self._log or self._log[-1] != log_line:
                self._log.append(log_line)
                self._log = self._log[-self._LOG_LINES:]
                self._update_log(cog_state)

        elif not ml_ready and engine_enabled:
            self._lbl_state.configure(text="  Warming up…", fg=_ONNX_WARM, bg=_ONNX_PANEL)
            self._lbl_struggle.configure(text="", bg=_ONNX_PANEL)

        # ── Input features table ──────────────────────────────────────────
        if ml_features:
            feat_pairs = [
                f"{k}={v:.1f}" for k, v in sorted(ml_features.items())
            ]
            # 3 per line
            lines = []
            for i in range(0, len(feat_pairs), 3):
                lines.append("  " + "  |  ".join(feat_pairs[i:i+3]))
            self._lbl_features.configure(text="\n".join(lines) or "—")

    def _update_log(self, cog_state: str) -> None:
        self._log_text.configure(state="normal")
        self._log_text.delete("1.0", "end")
        for line in reversed(self._log):
            ts_end  = 8  # length of "HH:MM:SS"
            ts_part = line[:ts_end]
            rest    = line[ts_end:]
            state_tag = cog_state if cog_state in ("focused", "confused", "fatigued") else ""
            self._log_text.insert("end", ts_part, "ts")
            self._log_text.insert("end", rest + "\n", state_tag)
        self._log_text.configure(state="disabled")

