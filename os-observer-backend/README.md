# OS Observer Backend

This is a separate Python backend for the OS-level cursor observation feature.

## What it does

- Observes global cursor movement across the operating system using `pynput`
- Detects simple movement states in a rolling window:
  - `steady`
  - `searching`
  - `in_a_hurry`
- Shows the detected state directly on screen with a small always-on-top overlay
- Stores nothing in any database

## Run

```bash
cd os-observer-backend
pip install -r requirements.txt
python main.py
```

## Notes

- This is a lightweight heuristic implementation for the current phase.
- It does not record raw user content or persist movement history.
- On Windows, global input hooks may require running the terminal with suitable permissions in some environments.
