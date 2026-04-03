# 🛡️ Flow Guardian: Cognitive Observability for Deep Work 🛡️
### *🏆 1st Place Winner - CodeCrafters 3.0 Hackathon*

[![Python](https://img.shields.io/badge/Python-3.8%2B-blue.svg)](https://www.python.org/)
[![AI](https://img.shields.io/badge/AI-On--Device-green.svg)]()
[![Privacy](https://img.shields.io/badge/Privacy-Metrics--Only-orange.svg)]()

**Flow Guardian** is a passive, OS-level cognitive monitoring system designed to protect and enhance human focus. Unlike traditional productivity tools that simply block websites, Flow Guardian uses **Sensor Fusion** and **On-Device ML** to detect your mental state in real-time and adapt your digital environment to match.

---

## 🚀 Key Features

*   **🧠 Multi-Task Cognitive Detection:** An ONNX-based neural network that fusion-tracks **Focused, Fatigued, and Confused** states by observing "digital exhaust"—keyboard rhythm (IKI), mouse entropy, and eye aspect ratios.
*   **👁️ Bio-Metric Vision (PERCLOS):** Uses MediaPipe and OpenCV to calculate PERCLOS (Percentage of Eye Closure) and blink rate for non-intrusive fatigue detection.
*   **📱 Distraction-Aware (YOLOv8):** Integrated a real-time YOLOv8 object detection model to instantly identify phone-usage distractions and trigger protective focus-mode overrides.
*   **🛡️ Intelligent Interruption Broker:** A 3-tier notification system that filters incoming pings (Slack, Discord, Chrome) based on your real-time cognitive momentum.
*   **📊 Attention Residue Tracking:** Models the "cognitive cost" of task-switching to provide a more accurate picture of daily productivity than simple "time-tracking."

---

## 🏗️ Architecture

Flow Guardian acts as a central "Brain" (ActivityMonitor) that orchestrates high-frequency data streams from three core sensors:
1.  **KeyboardMonitor:** Tracks WPM, IKI Standard Deviation, and Backspace Ratio.
2.  **CursorMonitor:** Monitors Path Linearity and Click Dwell Time.
3.  **CameraMonitor:** Performs real-time Eye Aspect Ratio (EAR) and head-pitch analysis via MediaPipe.

### **The "Persistence Alert" Rule**
*   **1-Second Hit:** Immediate audible warning for critical distractions (e.g., Phone usage).
*   **5-Minute Suppression:** Prevents alert fatigue by throttling subsequent notifications for a set period while focus is recovering.

---

## 🛠️ Tech Stack

*   **Backend:** Python (FastAPI, pynput, psutil, ctypes/Win32 API)
*   **Computer Vision:** MediaPipe FaceMesh + YOLOv8 Nano.
*   **Machine Learning:** Multi-Task Learning (MTL) model exported to ONNX for CPU-only inference.
*   **Signal Processing:** Welford’s Online Algorithm for dynamic user/app baseline calibration.
*   **UI:** React frontend with real-time telemetry (Recharts).

---

## ⚙️ Installation & Usage

1. **Clone the repository:**
   ```bash
   git clone https://github.com/YOUR_USERNAME/Flow-Guardian.git
   cd Flow-Guardian
   ```

2. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

3. **Run the monitor:**
   ```bash
   python main.py
   ```
   *Note: Access the dashboard at `http://localhost:8000` once the monitor is running.*

---

## 🛡️ Privacy & Ethics

Flow Guardian was built with a **Privacy-by-Design** philosophy.
*   **Local Inference:** All AI models run locally on the user's CPU. No video frames or audio ever leave the device.
*   **Metrics-Not-Frames:** Raw video is discarded immediately after landmark extraction. Only mathematical floating-point numbers (metrics) are stored for state inference.
*   **No Keylogging:** We capture *timing* between keys (Inter-Key Intervals), not the identity of the keys themselves.

---

## 👨‍💻 Team CoreX (SIESGST)
Project developed during the CodeCrafters 3.0 Hackathon. 
*   [Your Name] - Lead Backend / Logic Tuning
*   [Teammate 1] - Feature Engineering / Voice Integration
*   [Teammate 2] - Dashboard Architecture / Frontend

---
### **"Productivity is about Cognitive Momentum—not just hours at the desk."** 🛡️🚀🏆