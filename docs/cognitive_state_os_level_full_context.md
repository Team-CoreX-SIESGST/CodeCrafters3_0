# Cognitive State Detection — OS-Level System
### Full Project Context Document (Use this as context window for new chats)

---

## 1. Project Overview

**Core Problem:**  
Understanding a user's cognitive state — focus, confusion, fatigue — is impossible for existing systems without explicit or physical input. Systems cannot passively infer these states by observing user behaviour. This causes a disconnect between what the user needs and what software provides.

**Affected Domains:**
- Adaptive learning platforms
- Workplace productivity tools
- Healthcare / cognitive monitoring
- UX research and design
- Game difficulty adaptation

**The Solution Being Built:**  
An OS-level background daemon (Python) that passively observes keyboard typing patterns, mouse behaviour, active application context, and optionally camera input — then infers the user's cognitive state (Focused / Confused / Fatigued) every 30 seconds. It exposes this state via a system tray icon and a live web dashboard, and can trigger adaptive system actions (mute notifications, inject reading overlays, prompt breaks).

---

## 2. Why OS-Level (Not Just a Chrome Extension)

A Chrome extension only works inside the browser. The OS-level daemon covers **every app on the desktop**:

| Scenario | Chrome Extension | OS Daemon |
|---|---|---|
| User coding in VS Code | No | Yes |
| User playing a game | No | Yes |
| User editing video in Premiere | No | Yes |
| User reading a PDF in Acrobat | No | Yes |
| User browsing in Chrome | Yes | Yes |

The OS-level approach uses:
- **`pynput`** — global keyboard and mouse hooks across all apps
- **`psutil`** + window title APIs — detects active application every 5 seconds
- **`mediapipe`** — face mesh for eye blink / fatigue detection via webcam
- **`FastAPI`** — serves cognitive state over REST/WebSocket
- **`pystray`** — system tray icon that changes colour in real time
- **React + recharts** — live dashboard showing state timeline

---

## 3. All Input Signals

### 3.1 Keyboard Signals
| Signal | How to Capture | What It Indicates |
|---|---|---|
| Inter-Key Interval (IKI) | `keydown` timestamp delta | Typing rhythm consistency |
| Key hold duration | `keydown` to `keyup` delta | Motor precision, fatigue |
| Backspace / delete rate | Count per minute | Error rate, confusion |
| Burst length | Keys typed before a pause >1s | Focus depth |
| Pause duration | Gap between bursts | Thinking, distraction |
| Typing speed (WPM) | Characters / time | General engagement |
| Shift / Ctrl combo rate | Special key frequency | Power user flow state |

### 3.2 Mouse Signals
| Signal | How to Capture | What It Indicates |
|---|---|---|
| Cursor speed | Distance / time | Engagement level |
| Cursor acceleration | Speed delta | Intentionality |
| Path linearity score | straight_dist / actual_dist (0–1) | Directness, confusion |
| Click dwell time | mousedown to mouseup | Decision confidence |
| Hover hesitation | Time over element before click | Uncertainty |
| Scroll velocity | Pixels / second | Reading pace |
| Scroll reversal | Back-scroll count | Re-reading, confusion |
| Idle drift duration | Time with no purposeful movement | Fatigue, distraction |

### 3.3 Camera Signals (MediaPipe FaceMesh — all on-device, no frames stored)
| Signal | How to Capture | What It Indicates |
|---|---|---|
| Blink rate | Eye landmark distance over time | Fatigue (low blink = high focus, very low = fatigue) |
| PERCLOS | % time eye >70% closed per 60s | Gold-standard fatigue metric (used in medical research) |
| Eye openness | Vertical eye landmark gap | Drowsiness |
| Gaze direction | Iris landmark relative to eye corner | Screen attention |
| Head pose (pitch/yaw) | 3D face landmarks | Nodding off, distraction |
| Facial action units | Brow, mouth, cheek movement | Frustration, confusion expressions |
| Yawn detection | Mouth aspect ratio spike | Strong fatigue signal |

### 3.4 Browser Behaviour Signals (Chrome Extension layer, optional add-on)
| Signal | API | What It Indicates |
|---|---|---|
| Tab switch frequency | `chrome.tabs` events | Distraction / multitasking |
| Back button usage | Navigation API | Confusion, re-reading |
| Page dwell time | `visibilitychange` | Engagement |
| Scroll depth | Scroll events | Content consumption |
| Ctrl+F usage | Keyboard hook in content script | Searching / confusion |
| Copy-paste frequency | Clipboard events | Task-switching, distraction |

### 3.5 Advanced / Unique Signals
| Signal | API | Notes |
|---|---|---|
| Microphone volume envelope | Web Audio API / PyAudio | NO audio recorded — only amplitude level. High ambient noise = stress context |
| Device orientation / tilt | `DeviceOrientationEvent` / IMU | Laptop tilt = slouching = fatigue |
| Battery level | `navigator.getBattery()` | Low battery = stress context modifier |
| Network speed | `navigator.connection` | Slow pages = frustration trigger |
| Text selection behaviour | Selection API | Select-deselect loop = confusion |
| Clipboard paste rate | Clipboard API | High paste = distracted mode |
| Active window title | `psutil` + OS APIs | App context for baseline calibration |
| Number of open tabs | `chrome.tabs.query` | Cognitive load proxy |

---

## 4. Cognitive State Definitions

### 4.1 Focused
**Behavioural signature:**
- IKI: consistent 120–180ms rhythm, low variance
- Error rate: <2%, minimal backspace usage
- Typing: long uninterrupted bursts, short deliberate pauses
- Mouse: straight paths to targets (linearity > 0.85), confident clicks (~120ms dwell)
- Scroll: purposeful, linear progress through content
- Camera: moderate blink rate (15–20/min), steady gaze on screen
- App context clue: VS Code → long code bursts; writing app → sustained WPM

**What it means:** User is in flow. Don't interrupt.

---

### 4.2 Confused
**Behavioural signature:**
- IKI: irregular, long pauses mid-word or mid-sentence
- Error rate: medium — spikes of backspace then re-type loops
- Mouse: wandering cursor, long hover hesitation before clicks
- Scroll: back-scroll loops, re-reading patterns
- Click dwell: longer than baseline before committing to clicks
- Camera: furrowed brow (action units), head tilt
- App context clue: VS Code → frequent Ctrl+Z, re-reads, back-scroll on documentation

**What it means:** User is stuck or processing something hard. Could benefit from contextual help.

---

### 4.3 Fatigued
**Behavioural signature:**
- IKI: gradually slowing over the session (key indicator: trend, not absolute value)
- Error rate: rising errors late in session
- Mouse: slow, curved paths, low acceleration, misclick rate rising
- Click dwell: delayed, imprecise
- Scroll: random drift, no clear intent
- Idle gaps: longer and more frequent
- Camera: PERCLOS rising (>15% = drowsy), slow blink, head nodding, yawn events
- App context clue: game → reaction time measurably degrading over 30-min window

**What it means:** User needs a break. Productivity is degrading. Continuing is counterproductive.

---

## 5. Technical Architecture

### 5.1 System Components

```
┌─────────────────────────────────────────────────────────┐
│                    OS-LEVEL DAEMON                       │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ Input Layer  │  │ Context Layer│  │ Camera Layer │  │
│  │ (pynput)     │  │ (psutil)     │  │ (mediapipe)  │  │
│  │              │  │              │  │              │  │
│  │ keyboard +   │  │ active app   │  │ face mesh    │  │
│  │ mouse hooks  │  │ window title │  │ PERCLOS      │  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  │
│         └─────────────────┼──────────────────┘          │
│                           ▼                             │
│              ┌────────────────────────┐                 │
│              │   Feature Extractor    │                 │
│              │   30s sliding window   │                 │
│              │   12 features computed │                 │
│              │   z-score normalised   │                 │
│              └────────────┬───────────┘                 │
│                           ▼                             │
│              ┌────────────────────────┐                 │
│              │    ML Inference        │                 │
│              │    sklearn / TF.js     │                 │
│              │    LSTM or RF model    │                 │
│              │    output every 30s    │                 │
│              └────────────┬───────────┘                 │
│                           ▼                             │
│         ┌─────────────────┼──────────────────┐          │
│         ▼                 ▼                  ▼          │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │ System Tray │  │  FastAPI     │  │  Adaptive    │   │
│  │ Icon Color  │  │  WebSocket   │  │  Actions     │   │
│  │ (pystray)   │  │  Dashboard   │  │  Engine      │   │
│  └─────────────┘  └──────────────┘  └──────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### 5.2 Technology Stack

| Layer | Technology | Why |
|---|---|---|
| Global input hooks | `pynput` | Works across ALL apps on Windows, Mac, Linux |
| Active app detection | `psutil` + OS APIs | Gets process name + window title |
| Face tracking | `mediapipe` (Python) | On-device, no server, 30fps FaceMesh |
| Feature computation | `numpy`, `scipy` | Rolling window stats |
| ML inference | `scikit-learn` (Random Forest) | Fast, small model, interpretable |
| API server | `FastAPI` + WebSockets | Real-time state streaming |
| System tray | `pystray` | Cross-platform tray icon |
| Dashboard UI | React + `recharts` | Live timeline chart |
| Packaging | `PyInstaller` | Single .exe / .app for demo |
| Notifications (Win) | `win10toast` or PowerShell | DND mode toggle |
| Notifications (Mac) | `osascript` AppleScript | Focus mode toggle |
| Break overlay | `tkinter` | Zero-dependency, built into Python |

---

## 6. Feature Engineering

### 6.1 The 12-Feature Vector (per 30s window)

```python
features = {
    # Keyboard
    "iki_mean":         mean(inter_key_intervals),
    "iki_std":          std(inter_key_intervals),       # High std = irregular = confused/fatigued
    "hold_mean":        mean(key_hold_durations),
    "error_rate":       backspace_count / total_keys,
    "burst_length":     mean(burst_lengths),            # Keys between pauses > 1s
    "pause_freq":       pause_count / window_seconds,

    # Mouse
    "mouse_speed":      mean(cursor_speeds),
    "linearity":        straight_dist / actual_path_dist,
    "click_dwell":      mean(click_hold_durations),
    "idle_ratio":       idle_time / window_seconds,

    # Camera (optional)
    "perclos":          eye_closed_frames / total_frames,
    "blink_rate":       blink_count / (window_seconds / 60),
}
```

### 6.2 Sliding Window Strategy

```
Time: [----30s window----][----30s window----]
          Features_1            Features_2
              ↓                     ↓
          State_1               State_2
```

- Window size: 30 seconds
- Update frequency: every 30 seconds (or every 10s with overlap for smoother transitions)
- Minimum data threshold: skip inference if fewer than 20 key events in window (user is idle)

### 6.3 Baseline Calibration (Critical)

Every user types differently. You MUST normalise against the user's own baseline, not global norms.

```python
# On first launch: 5-minute calibration session
# Ask user to "just work normally for 5 minutes"
baseline = {
    "iki_mean": 145,    # ms — this user's normal rhythm
    "iki_std": 22,
    "mouse_speed": 480, # px/s — this user's normal speed
    # ... etc
}

# At inference time:
z_score = (current_feature - baseline[feature]) / baseline_std[feature]
# z > +2 = significantly above normal → signal
# z < -2 = significantly below normal → signal
```

**Per-app baselines:** A gamer's mouse speed is totally different from a programmer's. Store separate baselines per app category:
- `IDE` (VS Code, IntelliJ, Vim)
- `Browser` (Chrome, Firefox, Edge)
- `Game` (any fullscreen process)
- `Media` (Premiere, DaVinci, Figma)
- `Communication` (Slack, Zoom, Teams)
- `Document` (Word, Notion, Google Docs)

---

## 7. Machine Learning

### 7.1 Model Choice

**For hackathon (18 hours): Rule-based thresholds** — deterministic, no training data needed, judges won't know the difference during a demo.

**For production: Random Forest** — well-suited to tabular feature data, fast inference, interpretable feature importances.

**For temporal drift (fatigue over time): LSTM** — captures the degradation trend over a session that RF misses.

### 7.2 Rule-Based Thresholds (hackathon fallback)

```python
def classify_state(features, baseline):
    z = compute_z_scores(features, baseline)
    
    # Fatigue signals
    fatigue_score = 0
    if z["iki_mean"] > 1.5:     fatigue_score += 2   # slowing down
    if z["error_rate"] > 1.5:   fatigue_score += 2   # more errors
    if z["idle_ratio"] > 1.5:   fatigue_score += 2   # more idle
    if features["perclos"] > 0.15: fatigue_score += 3  # eyes closing
    
    # Confusion signals
    confusion_score = 0
    if z["iki_std"] > 1.5:      confusion_score += 2  # irregular typing
    if z["linearity"] < -1.5:   confusion_score += 2  # wandering mouse
    if z["error_rate"] > 1.0:   confusion_score += 1
    
    # Focused signals (negative of the above)
    focus_score = 0
    if z["iki_std"] < -0.5:     focus_score += 2      # consistent rhythm
    if z["linearity"] > 0.5:    focus_score += 2      # straight mouse
    if z["burst_length"] > 0.5: focus_score += 1      # long typing bursts
    
    # Classify
    scores = {"fatigued": fatigue_score, 
              "confused": confusion_score, 
              "focused": focus_score}
    return max(scores, key=scores.get)
```

### 7.3 Ground Truth Collection (for real training data)

- **ESM (Experience Sampling Method):** Every 5 minutes, pop a tiny notification: "How do you feel right now? [Focused] [Confused] [Tired]" — user clicks one. Collect features + label pairs over 1-2 weeks.
- **Controlled study:** Give users tasks of known difficulty. Easy task = focused baseline. Extremely hard task = confusion. Hour 3 of work = fatigue. Label automatically.
- **Target dataset size:** 500+ labeled windows per class minimum for RF. 2000+ for LSTM.

---

## 8. OS-Level Implementation Details

### 8.1 Global Input Listener (pynput)

```python
from pynput import keyboard, mouse
import time
from collections import deque

class InputCollector:
    def __init__(self):
        self.key_events = deque(maxlen=500)   # rolling buffer
        self.mouse_events = deque(maxlen=2000)
        self.last_key_time = None
        
    def on_key_press(self, key):
        now = time.time()
        if self.last_key_time:
            iki = (now - self.last_key_time) * 1000  # ms
            self.key_events.append({
                "time": now,
                "iki": iki,
                "is_backspace": key == keyboard.Key.backspace
            })
        self.last_key_time = now
        self._key_down_time = now
    
    def on_key_release(self, key):
        if hasattr(self, '_key_down_time'):
            hold = (time.time() - self._key_down_time) * 1000
            if self.key_events:
                self.key_events[-1]["hold"] = hold
    
    def on_mouse_move(self, x, y):
        self.mouse_events.append({
            "time": time.time(), "x": x, "y": y, "type": "move"
        })
    
    def on_click(self, x, y, button, pressed):
        self.mouse_events.append({
            "time": time.time(), "x": x, "y": y,
            "type": "press" if pressed else "release"
        })
    
    def start(self):
        self.kb_listener = keyboard.Listener(
            on_press=self.on_key_press,
            on_release=self.on_key_release
        )
        self.mouse_listener = mouse.Listener(
            on_move=self.on_mouse_move,
            on_click=self.on_click
        )
        self.kb_listener.start()
        self.mouse_listener.start()
```

### 8.2 Active App Detection

```python
import psutil
import subprocess
import platform

def get_active_app():
    os_name = platform.system()
    
    if os_name == "Windows":
        import ctypes
        hwnd = ctypes.windll.user32.GetForegroundWindow()
        pid = ctypes.c_ulong()
        ctypes.windll.user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        try:
            proc = psutil.Process(pid.value)
            return proc.name(), proc.exe()
        except:
            return "unknown", ""
    
    elif os_name == "Darwin":  # macOS
        script = 'tell application "System Events" to get name of first application process whose frontmost is true'
        result = subprocess.run(["osascript", "-e", script], capture_output=True, text=True)
        return result.stdout.strip(), ""
    
    elif os_name == "Linux":
        result = subprocess.run(["xdotool", "getactivewindow", "getwindowname"], 
                                capture_output=True, text=True)
        return result.stdout.strip(), ""

def categorise_app(app_name):
    app_name = app_name.lower()
    if any(x in app_name for x in ["code", "pycharm", "vim", "nvim", "intellij", "eclipse"]):
        return "IDE"
    if any(x in app_name for x in ["chrome", "firefox", "safari", "edge", "brave"]):
        return "browser"
    if any(x in app_name for x in ["premiere", "davinci", "aftereffects", "resolve"]):
        return "media_editor"
    if any(x in app_name for x in ["slack", "teams", "zoom", "discord"]):
        return "communication"
    if any(x in app_name for x in ["word", "notion", "docs", "obsidian", "typora"]):
        return "document"
    return "game"  # fallback: fullscreen unknown app
```

### 8.3 Camera — PERCLOS via MediaPipe

```python
import cv2
import mediapipe as mp
import numpy as np

class FatigueDetector:
    def __init__(self):
        self.mp_face = mp.solutions.face_mesh
        self.face_mesh = self.mp_face.FaceMesh(
            max_num_faces=1, 
            refine_landmarks=True,
            min_detection_confidence=0.5
        )
        # Eye landmark indices (MediaPipe 468-point model)
        self.LEFT_EYE  = [362, 385, 387, 263, 373, 380]
        self.RIGHT_EYE = [33,  160, 158, 133, 153, 144]
        self.closed_frames = 0
        self.total_frames = 0
    
    def eye_aspect_ratio(self, landmarks, eye_indices, w, h):
        pts = [(int(landmarks[i].x * w), int(landmarks[i].y * h)) for i in eye_indices]
        # Vertical distances
        A = np.linalg.norm(np.array(pts[1]) - np.array(pts[5]))
        B = np.linalg.norm(np.array(pts[2]) - np.array(pts[4]))
        # Horizontal distance
        C = np.linalg.norm(np.array(pts[0]) - np.array(pts[3]))
        return (A + B) / (2.0 * C)
    
    def process_frame(self, frame):
        h, w = frame.shape[:2]
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = self.face_mesh.process(rgb)
        
        if results.multi_face_landmarks:
            lm = results.multi_face_landmarks[0].landmark
            left_ear  = self.eye_aspect_ratio(lm, self.LEFT_EYE, w, h)
            right_ear = self.eye_aspect_ratio(lm, self.RIGHT_EYE, w, h)
            ear = (left_ear + right_ear) / 2
            
            # EAR < 0.2 → eye >70% closed
            self.total_frames += 1
            if ear < 0.2:
                self.closed_frames += 1
    
    def get_perclos(self):
        if self.total_frames == 0:
            return 0.0
        perclos = self.closed_frames / self.total_frames
        # Reset for next window
        self.closed_frames = 0
        self.total_frames = 0
        return perclos
    
    def run(self, callback):
        cap = cv2.VideoCapture(0)
        while True:
            ret, frame = cap.read()
            if ret:
                self.process_frame(frame)
            # callback is called by the feature extractor every 30s
```

### 8.4 FastAPI State Server

```python
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
import asyncio, json
from datetime import datetime

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"])

state_history = []  # [{time, state, confidence, app}]
current_state = {"state": "unknown", "confidence": 0, "app": "unknown"}

@app.get("/state")
def get_state():
    return current_state

@app.get("/history")
def get_history():
    return state_history[-120:]  # last 60 minutes (120 × 30s)

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    last_sent = None
    while True:
        if current_state != last_sent:
            await websocket.send_json(current_state)
            last_sent = current_state.copy()
        await asyncio.sleep(1)

def update_state(state, confidence, app_name):
    global current_state
    current_state = {
        "state": state,
        "confidence": round(confidence, 2),
        "app": app_name,
        "time": datetime.now().isoformat()
    }
    state_history.append(current_state)
```

### 8.5 System Tray (pystray)

```python
from pystray import Icon, Menu, MenuItem
from PIL import Image, ImageDraw
import threading

STATE_COLORS = {
    "focused":  "#22c55e",  # green
    "confused": "#f59e0b",  # amber
    "fatigued": "#ef4444",  # red
    "unknown":  "#6b7280",  # gray
}

def make_icon(color_hex):
    img = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    r, g, b = int(color_hex[1:3], 16), int(color_hex[3:5], 16), int(color_hex[5:7], 16)
    draw.ellipse([4, 4, 60, 60], fill=(r, g, b, 255))
    return img

class TrayManager:
    def __init__(self):
        self.icon = Icon("CognitiveMonitor",
                         make_icon(STATE_COLORS["unknown"]),
                         "Cognitive Monitor — starting...",
                         Menu(MenuItem("Open Dashboard", self.open_dashboard),
                              MenuItem("Quit", self.quit)))
    
    def update(self, state):
        self.icon.icon = make_icon(STATE_COLORS.get(state, "#6b7280"))
        self.icon.title = f"Cognitive Monitor — {state.capitalize()}"
    
    def open_dashboard(self):
        import webbrowser
        webbrowser.open("http://localhost:8000/dashboard")
    
    def quit(self):
        self.icon.stop()
    
    def run(self):
        self.icon.run()
```

### 8.6 Adaptive Actions Engine

```python
import platform, subprocess

class ActionEngine:
    def __init__(self):
        self.os = platform.system()
        self.last_state = None
    
    def on_state_change(self, new_state, old_state):
        if new_state == old_state:
            return
        
        if new_state == "focused":
            self.block_notifications()
        elif new_state == "fatigued":
            self.restore_notifications()
            self.show_break_prompt()
        elif new_state == "confused":
            self.restore_notifications()
            # Context-sensitive help trigger (see section 9)
    
    def block_notifications(self):
        if self.os == "Darwin":
            subprocess.run(["osascript", "-e",
                'tell application "System Events" to set doNotDisturb of current user to true'])
        elif self.os == "Windows":
            # PowerShell focus assist
            subprocess.run(["powershell", "-Command",
                "Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\CloudStore\\Store\\DefaultAccount\\Current\\default$windows.data.notifications.quiethourssettings\\windows.data.notifications.quiethourssettings' -Name 'Data' -Value ([byte[]](0x02,0x00,0x00,0x00))"],
                shell=True)
    
    def restore_notifications(self):
        if self.os == "Darwin":
            subprocess.run(["osascript", "-e",
                'tell application "System Events" to set doNotDisturb of current user to false'])
    
    def show_break_prompt(self):
        # tkinter break overlay — zero dependencies, built into Python
        import tkinter as tk
        def show():
            root = tk.Tk()
            root.title("Time for a break")
            root.geometry("400x200")
            root.attributes("-topmost", True)
            tk.Label(root, text="You've been working hard.", font=("Arial", 16)).pack(pady=20)
            tk.Label(root, text="Take a 5-minute break.", font=("Arial", 12)).pack()
            tk.Button(root, text="Dismiss", command=root.destroy).pack(pady=20)
            root.mainloop()
        threading.Thread(target=show, daemon=True).start()
```

---

## 9. Main Orchestrator

```python
# main.py — entry point for the daemon
import threading, time, schedule
from input_collector import InputCollector
from feature_extractor import FeatureExtractor
from classifier import classify_state
from fatigue_detector import FatigueDetector
from context_detector import get_active_app, categorise_app
from api_server import app as fastapi_app, update_state
from tray_manager import TrayManager
from action_engine import ActionEngine
import uvicorn

collector = InputCollector()
extractor = FeatureExtractor()
fatigue_det = FatigueDetector()
tray = TrayManager()
actions = ActionEngine()
baseline = None  # loaded after calibration

def inference_loop():
    global baseline
    while True:
        time.sleep(30)
        features = extractor.compute(collector.key_events, collector.mouse_events)
        features["perclos"] = fatigue_det.get_perclos()
        app_name, _ = get_active_app()
        app_category = categorise_app(app_name)
        
        if baseline is None:
            baseline = features.copy()  # first window = baseline
            continue
        
        state, confidence = classify_state(features, baseline, app_category)
        update_state(state, confidence, app_name)
        tray.update(state)
        actions.on_state_change(state, actions.last_state)
        actions.last_state = state

if __name__ == "__main__":
    # Start input collection
    collector.start()
    
    # Start camera in background thread
    cam_thread = threading.Thread(
        target=fatigue_det.run, kwargs={"callback": None}, daemon=True
    )
    cam_thread.start()
    
    # Start inference loop
    infer_thread = threading.Thread(target=inference_loop, daemon=True)
    infer_thread.start()
    
    # Start FastAPI in background
    api_thread = threading.Thread(
        target=uvicorn.run,
        kwargs={"app": fastapi_app, "host": "127.0.0.1", "port": 8000},
        daemon=True
    )
    api_thread.start()
    
    # System tray runs on main thread (required by macOS)
    tray.run()
```

---

## 10. Dashboard (React Frontend)

```jsx
// App.jsx
import { useState, useEffect } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

const STATE_COLORS = {
  focused: "#22c55e",
  confused: "#f59e0b",
  fatigued: "#ef4444",
  unknown: "#6b7280",
};

export default function Dashboard() {
  const [current, setCurrent] = useState({ state: "loading", confidence: 0, app: "" });
  const [history, setHistory] = useState([]);

  useEffect(() => {
    // WebSocket for live updates
    const ws = new WebSocket("ws://localhost:8000/ws");
    ws.onmessage = (e) => {
      const data = JSON.parse(e.data);
      setCurrent(data);
      setHistory(prev => [...prev.slice(-119), {
        time: new Date(data.time).toLocaleTimeString(),
        state: data.state,
        value: { focused: 3, confused: 2, fatigued: 1, unknown: 0 }[data.state] ?? 0
      }]);
    };

    // Load history on mount
    fetch("http://localhost:8000/history")
      .then(r => r.json())
      .then(data => setHistory(data.map(d => ({
        time: new Date(d.time).toLocaleTimeString(),
        state: d.state,
        value: { focused: 3, confused: 2, fatigued: 1, unknown: 0 }[d.state] ?? 0
      }))));

    return () => ws.close();
  }, []);

  return (
    <div style={{ padding: "2rem", fontFamily: "sans-serif", maxWidth: 900 }}>
      {/* Current state badge */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 32 }}>
        <div style={{
          width: 24, height: 24, borderRadius: "50%",
          background: STATE_COLORS[current.state]
        }} />
        <h1 style={{ margin: 0, fontSize: 28 }}>
          {current.state.charAt(0).toUpperCase() + current.state.slice(1)}
        </h1>
        <span style={{ color: "#6b7280", fontSize: 14 }}>
          {Math.round(current.confidence * 100)}% confidence · {current.app}
        </span>
      </div>

      {/* Timeline chart */}
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={history}>
          <XAxis dataKey="time" tick={{ fontSize: 11 }} interval={9} />
          <YAxis domain={[0, 3]} tickFormatter={v => ["","Fatigued","Confused","Focused"][v] ?? ""} width={70} />
          <Tooltip formatter={(v) => ["Fatigued","Confused","Focused"][v-1] ?? v} />
          <Line type="monotone" dataKey="value" dot={false} strokeWidth={2}
            stroke="#378ADD" />
        </LineChart>
      </ResponsiveContainer>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginTop: 32 }}>
        {["focused","confused","fatigued"].map(s => (
          <div key={s} style={{ padding: "1rem", border: "1px solid #e5e7eb", borderRadius: 8 }}>
            <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>{s}</div>
            <div style={{ fontSize: 24, fontWeight: 600, color: STATE_COLORS[s] }}>
              {Math.round((history.filter(h => h.state === s).length / Math.max(history.length, 1)) * 100)}%
            </div>
            <div style={{ fontSize: 12, color: "#9ca3af" }}>of session</div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

## 11. Privacy Architecture (Important for Hackathon Pitch)

**What is NEVER stored:**
- Raw keystrokes or key identities (only timing between presses)
- Video frames (only per-frame EAR/PERCLOS values computed and discarded)
- Audio recordings (only volume amplitude envelope)
- Browsing URLs or page content

**What IS stored (locally only):**
- Timing metadata (IKI, hold durations, mouse speeds)
- Derived features (means, std devs, ratios)
- Cognitive state labels with timestamps
- App category (not full executable path)

**Storage location:** `chrome.storage.local` (extension) or `~/.cognitivestate/` (daemon) — never uploaded to any server unless user explicitly enables a team dashboard feature.

**Privacy pitch line for judges:**  
*"We see how you type, not what you type. We see how long your eyes close, not what you see. Everything stays on your device."*

---

## 12. 18-Hour Sprint Plan

| Hours | Task | Priority | Risk |
|---|---|---|---|
| 0–2 | Global keyboard + mouse listener (pynput) | Critical | Low — library works reliably |
| 2–4 | Active app detection (psutil + OS API) | Critical | Medium — macOS needs permissions |
| 4–7 | Feature extractor + rule-based classifier | Critical | Low — pure math |
| 7–10 | FastAPI server + React dashboard | Critical | Low — standard web dev |
| 10–13 | MediaPipe camera fatigue (PERCLOS) | High | Medium — camera perms on macOS |
| 13–15 | System tray (pystray) + adaptive actions | High | Low — library works well |
| 15–17 | Polish, PyInstaller packaging, demo prep | High | High — PyInstaller on Windows is fiddly |
| 17–18 | Buffer (bugs only, NO new features) | — | — |

### Critical Pre-Hackathon Tasks (do BEFORE the 18 hours start):
1. **Train or prepare the ML model** — collect 30 min of labeled typing data across 3 states
2. **Test PyInstaller** on your target demo machine — it often breaks on first try
3. **Test camera permissions** on macOS — requires Accessibility API approval
4. **Pre-install all dependencies** — `pip install pynput psutil mediapipe fastapi uvicorn pystray pillow scikit-learn numpy` — PyPI can be slow at hackathon venues
5. **Prepare a demo script video** as fallback in case live demo fails

---

## 13. Feasibility by Platform

| Feature | Windows | macOS | Linux |
|---|---|---|---|
| Global keyboard hook | pynput ✓ | pynput (needs Accessibility permission) | pynput ✓ |
| Global mouse hook | pynput ✓ | pynput ✓ | pynput ✓ |
| Active app name | pywin32 / ctypes ✓ | osascript ✓ | xdotool ✓ |
| Camera (MediaPipe) | ✓ | ✓ (needs Camera permission) | ✓ |
| System tray | pystray ✓ | pystray ✓ | pystray ✓ |
| Block notifications | PowerShell ✓ | osascript DND ✓ | dunst/notify-send |
| Break overlay | tkinter ✓ | tkinter ✓ | tkinter ✓ |
| Package as app | PyInstaller .exe ✓ | PyInstaller .app ✓ | AppImage |

**Recommendation:** Target Windows for the demo if you have a Windows machine. macOS requires user to manually grant Accessibility permissions in System Preferences (takes 30 seconds but can confuse judges).

---

## 14. Out-of-the-Box Features (Hackathon Differentiators)

### Ranked by judge impact vs build time:

| Feature | Wow Factor | Build Time | Recommended? |
|---|---|---|---|
| Live PERCLOS eye tracking demo | Very High | 2–3 hrs | Yes — do it |
| System tray color-changing icon | High | 30 min | Yes — always visible |
| Per-app cognitive state breakdown | High | 1 hr | Yes — great chart |
| Smart notification blocking | Medium | 1 hr | Yes — tangible value |
| Break prompt with breathing exercise | Medium | 1 hr | Yes — memorable demo |
| End-of-day productivity report | High | 2 hrs | If time allows |
| Team anonymized dashboard | Very High | 4+ hrs | Probably skip |
| LLM contextual help (Claude API) | Very High | 2–3 hrs | If camera done early |
| Pomodoro auto-calibration | Medium | 1 hr | Nice polish |

### The single best demo moment:
Sit down, stare blankly at the screen with heavy eyes for 20 seconds. The system tray icon turns red. The break overlay appears. **That 20-second sequence is your hackathon-winning moment.** It's visible, instant, zero explanation needed.

---

## 15. Project File Structure

```
cognitive-state-monitor/
├── daemon/
│   ├── main.py                  # Entry point + orchestrator
│   ├── input_collector.py       # pynput global hooks
│   ├── feature_extractor.py     # 30s window → 12 features
│   ├── classifier.py            # Rule-based or sklearn model
│   ├── fatigue_detector.py      # MediaPipe PERCLOS
│   ├── context_detector.py      # psutil + OS active window
│   ├── api_server.py            # FastAPI + WebSocket
│   ├── tray_manager.py          # pystray icon
│   ├── action_engine.py         # Notifications, overlays
│   └── models/
│       └── rf_model.pkl         # Pre-trained sklearn model
├── dashboard/
│   ├── src/
│   │   ├── App.jsx              # Main dashboard
│   │   └── components/
│   │       ├── StateBadge.jsx
│   │       ├── Timeline.jsx
│   │       └── StatsGrid.jsx
│   └── package.json
├── requirements.txt
│   # pynput psutil mediapipe fastapi uvicorn
│   # pystray pillow scikit-learn numpy scipy
│   # pywin32 (Windows only)
├── README.md
└── build.sh                     # PyInstaller one-liner
```

---

## 16. One-Line Pitch

> **"An OS-level daemon that reads your cognitive state — focused, confused, or fatigued — from how you type, move your mouse, and blink, across every app on your computer, and silently adapts your environment to match how your brain is actually doing."**

---

## 17. Research Backing (for judges / slides)

- **PERCLOS** — Wierwille & Ellsworth (1994): percentage of time eyelids close >70% is the gold-standard objective fatigue measure used in clinical research.
- **Keystroke dynamics** — Vizer et al. (2009): typing patterns reliably indicate cognitive load and stress.
- **Mouse trajectory analysis** — Yamauchi & Xiao (2018): cursor movement characteristics correlate with confusion and cognitive load.
- **IKI variability** — Pinet et al. (2016): inter-key interval standard deviation is a reliable proxy for typing difficulty and mental effort.

---

*Generated from hackathon planning session. Full context includes: problem definition, signal taxonomy, state definitions, ML approach, 18-hour sprint plan, OS-level implementation, privacy architecture, and demo strategy.*
