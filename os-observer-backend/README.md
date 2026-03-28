# OS Observer Backend

This is a separate Python backend for the OS-level activity monitor.

## What it does

- Observes global cursor movement across the OS using `pynput`
- Observes keyboard activity and estimates typing speed in WPM
- Samples the webcam with MediaPipe Face Mesh to estimate eye closure and PERCLOS
- Detects the active window and visible open applications
- Shows recent user activity events directly on screen in an always-on-top overlay
- Serves the same live state through a local FastAPI backend
- Classifies cursor motion into:
  - `steady`
  - `searching`
  - `in_a_hurry`
- Stores nothing in any database

## Run

```bash
cd os-observer-backend
python -m venv .venv
.venv\Scripts\activate
python -m pip install --upgrade pip
pip install -r requirements.txt
python main.py
```

Using a dedicated virtual environment is recommended because packages like `mediapipe`
can conflict with globally installed ML stacks such as TensorFlow.

The monitor starts:

- the overlay window
- the local API on `http://127.0.0.1:8050`
- the optional camera tracker when `COGNITIVE_CAMERA_ENABLED` is not disabled

## Live info shown in the window

- Active application
- Active window title
- Open applications list
- Typing speed
- Keys per minute
- Backspace count
- Mouse speed
- Cursor distance
- Click and scroll counts
- Recent activity events
- Camera status and PERCLOS when webcam dependencies are installed

## Notes

- This is a lightweight heuristic implementation for the current phase.
- It does not persist movement history or raw typed content.
- Visible window detection is currently aimed at Windows because this project is being run on Windows.
