# OS Observer Backend

This is a separate Python backend for the OS-level activity monitor.

## What it does

- Observes global cursor movement across the OS using `pynput`
- Observes keyboard activity and estimates typing speed in WPM
- Detects the active window and visible open applications
- Shows recent user activity events directly on screen in an always-on-top overlay
- Classifies cursor motion into:
  - `steady`
  - `searching`
  - `in_a_hurry`
- Stores nothing in any database

## Run

```bash
cd os-observer-backend
pip install -r requirements.txt
python main.py
```

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

## Notes

- This is a lightweight heuristic implementation for the current phase.
- It does not persist movement history or raw typed content.
- Visible window detection is currently aimed at Windows because this project is being run on Windows.
