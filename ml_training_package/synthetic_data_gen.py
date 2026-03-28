"""
synthetic_data_gen.py
=====================
Generates statistically faithful synthetic telemetry windows for training
the Flow Guardian Multi-Task LSTM cognitive state model.

Research backing:
  - Vizer et al. (2009)        : Typing patterns reflect cognitive load / stress
  - Pinet et al. (2016)        : IKI std deviation is a reliable proxy for mental effort
  - Yamauchi & Xiao (2018)     : Mouse trajectory correlates with confusion
  - Wierwille & Ellsworth (1994): PERCLOS is the gold-standard fatigue metric
  - Czerwinski et al. (2004)   : Attention residue after context switches

Each sample = one 30-second behavioral window → 18 features.
We generate 500K windows per class = 1.5M total samples (balanced).

Usage:
  python synthetic_data_gen.py                      # full 1.5M sample dataset
  python synthetic_data_gen.py --quick              # 30K samples for fast iteration
  python synthetic_data_gen.py --n_per_class 200000 # custom size
"""

import argparse
from pathlib import Path

import numpy as np
import pandas as pd

# ─────────────────────────────────────────────────────────────────────────────
# FEATURE LIST  (18 features, same order as the model input vector)
# ─────────────────────────────────────────────────────────────────────────────
FEATURES = [
    "iki_mean_ms",          # Inter-key interval mean (ms) — typing rhythm
    "iki_std_ms",           # Inter-key interval std dev — KEY confusion marker
    "hold_mean_ms",         # Key hold duration mean (ms)
    "backspace_ratio",      # Backspaces / total keys (0.0–1.0) — error rate
    "burst_length",         # Keys typed before a >1s pause — focus depth
    "wpm",                  # Words per minute estimate
    "pause_freq_per_min",   # Number of pauses >1s per minute
    "mouse_speed_px_s",     # Cursor average speed (px/sec)
    "path_linearity",       # Straight dist / actual path (0=erratic, 1=direct)
    "click_dwell_ms",       # Mousedown → mouseup duration (ms) — decisiveness
    "direction_changes",    # Direction reversals per 30s window
    "idle_ratio",           # Fraction of window with no input (0.0–1.0)
    "scroll_reversals",     # Back-scrolls per window — re-reading signal
    "perclos",              # % of time eyes >70% closed — fatigue gold standard
    "blink_rate_per_min",   # Eye blinks per minute
    "ear_mean",             # Eye Aspect Ratio mean (higher = more open)
    "app_switches",         # App / tab switches in this window
    "dwell_seconds",        # Time spent in current context before this window
]

# ─────────────────────────────────────────────────────────────────────────────
# HARD BOUNDS  — values are clipped to these after sampling
# Keeps the data physically realistic even when distributions overlap
# ─────────────────────────────────────────────────────────────────────────────
BOUNDS = {
    "iki_mean_ms":        (50.0,   800.0),
    "iki_std_ms":         (5.0,    300.0),
    "hold_mean_ms":       (30.0,   400.0),
    "backspace_ratio":    (0.0,    0.60),
    "burst_length":       (1.0,    100.0),
    "wpm":                (1.0,    160.0),
    "pause_freq_per_min": (0.0,    12.0),
    "mouse_speed_px_s":   (0.0,    3000.0),
    "path_linearity":     (0.05,   1.0),
    "click_dwell_ms":     (40.0,   1200.0),
    "direction_changes":  (0.0,    50.0),
    "idle_ratio":         (0.0,    0.95),
    "scroll_reversals":   (0.0,    20.0),
    "perclos":            (0.0,    0.80),
    "blink_rate_per_min": (1.0,    35.0),
    "ear_mean":           (0.10,   0.45),
    "app_switches":       (0.0,    15.0),
    "dwell_seconds":      (5.0,    600.0),
}

# ─────────────────────────────────────────────────────────────────────────────
# STATE DISTRIBUTION PARAMETERS — (mean, std) per feature per state
# ─────────────────────────────────────────────────────────────────────────────

# State 0 — FOCUSED
# Consistent rhythm, straight mouse, long bursts, eyes open, rare errors
FOCUSED = {
    "iki_mean_ms":        (145.0,  15.0),
    "iki_std_ms":         (18.0,    5.0),   # LOW std = steady rhythm
    "hold_mean_ms":       (85.0,   10.0),
    "backspace_ratio":    (0.03,   0.015),
    "burst_length":       (35.0,    8.0),
    "wpm":                (65.0,   10.0),
    "pause_freq_per_min": (1.2,     0.3),
    "mouse_speed_px_s":   (480.0,  80.0),
    "path_linearity":     (0.82,   0.06),   # Straight, intentional
    "click_dwell_ms":     (120.0,  20.0),   # Confident clicks
    "direction_changes":  (2.5,    1.0),
    "idle_ratio":         (0.08,   0.04),
    "scroll_reversals":   (0.8,    0.5),
    "perclos":            (0.05,   0.02),   # Eyes open
    "blink_rate_per_min": (17.0,   3.0),    # Normal blink rate
    "ear_mean":           (0.32,   0.02),
    "app_switches":       (0.3,    0.2),    # Staying in one context
    "dwell_seconds":      (180.0,  60.0),
}

# State 1 — CONFUSED
# Erratic typing, wandering mouse, re-reading, short bursts, hesitant clicks
CONFUSED = {
    "iki_mean_ms":        (210.0,  45.0),
    "iki_std_ms":         (68.0,   20.0),   # HIGH std = KEY confusion signal (Pinet 2016)
    "hold_mean_ms":       (95.0,   22.0),
    "backspace_ratio":    (0.18,   0.07),   # Vizer 2009: error spikes under load
    "burst_length":       (11.0,    4.0),
    "wpm":                (34.0,   12.0),
    "pause_freq_per_min": (3.8,    0.9),
    "mouse_speed_px_s":   (310.0, 120.0),  # Variable — fast search then stall
    "path_linearity":     (0.42,   0.12),   # Yamauchi 2018: wandering = confusion
    "click_dwell_ms":     (275.0,  85.0),   # Hesitant before committing
    "direction_changes":  (11.0,   3.5),
    "idle_ratio":         (0.28,   0.10),
    "scroll_reversals":   (5.2,    1.8),    # Re-reading
    "perclos":            (0.08,   0.03),
    "blink_rate_per_min": (20.0,   5.0),
    "ear_mean":           (0.29,   0.03),
    "app_switches":       (2.8,    1.2),    # Bouncing between apps
    "dwell_seconds":      (42.0,   25.0),
}

# State 2 — FATIGUED
# Slowing trend, eyes closing (high PERCLOS), aimless scroll, high idle
FATIGUED = {
    "iki_mean_ms":        (285.0,  65.0),
    "iki_std_ms":         (42.0,   15.0),   # Uniformly sluggish (not erratic)
    "hold_mean_ms":       (130.0,  35.0),
    "backspace_ratio":    (0.16,   0.07),
    "burst_length":       (7.0,    3.5),
    "wpm":                (21.0,   8.0),
    "pause_freq_per_min": (5.8,    1.3),
    "mouse_speed_px_s":   (175.0,  70.0),
    "path_linearity":     (0.55,   0.15),
    "click_dwell_ms":     (390.0, 120.0),
    "direction_changes":  (3.5,    1.5),    # Aimless drift (not frantic)
    "idle_ratio":         (0.52,   0.14),
    "scroll_reversals":   (1.8,    1.0),
    "perclos":            (0.28,   0.08),   # Wierwille 1994: >0.15=drowsy, >0.25=severe
    "blink_rate_per_min": (7.5,    2.5),    # LOW blink rate = heavy fatigue
    "ear_mean":           (0.22,   0.04),   # Eyes drooping
    "app_switches":       (0.4,    0.3),    # Too tired to multitask
    "dwell_seconds":      (285.0,  95.0),
}

STATE_PARAMS = {0: FOCUSED, 1: CONFUSED, 2: FATIGUED}
STATE_NAMES  = {0: "focused", 1: "confused", 2: "fatigued"}


# ─────────────────────────────────────────────────────────────────────────────
# CORE GENERATION
# ─────────────────────────────────────────────────────────────────────────────

def generate_state_windows(
    state_id: int,
    n: int,
    rng: np.random.Generator,
    noise_scale: float = 0.05,
) -> np.ndarray:
    """
    Samples n telemetry windows for one cognitive state.

    noise_scale adds a small extra jitter on top of each feature's distribution
    so the model never overfits to perfectly Gaussian synthetic data.
    Real-world behavioral data is always messier than theory.

    Returns: array of shape (n, 18)
    """
    params = STATE_PARAMS[state_id]
    data = np.zeros((n, len(FEATURES)), dtype=np.float32)

    for i, feat in enumerate(FEATURES):
        mean, std = params[feat]
        lo, hi = BOUNDS[feat]
        samples = rng.normal(loc=mean, scale=std, size=n)
        # Small extra jitter — prevents the model from learning "too clean" data
        samples += rng.normal(0, noise_scale * (hi - lo), size=n)
        data[:, i] = np.clip(samples, lo, hi)

    return data


def apply_temporal_fatigue_drift(
    X: np.ndarray,
    labels: np.ndarray,
    session_len: int = 120,
    rng: np.random.Generator = None,
) -> np.ndarray:
    """
    CRITICAL REALISM STEP.

    Fatigue is a TREND, not a static snapshot. A fatigued window at minute 90
    of a session looks very different from one at minute 10.

    This function groups samples into pseudo-sessions and progressively worsens
    the fatigued windows later in the session — IKI slows, PERCLOS rises,
    WPM drops, idle climbs. This teaches the LSTM that fatigue has a temporal
    signature you can only detect in sequence, not in a single window alone.
    """
    if rng is None:
        rng = np.random.default_rng(42)

    X_out = X.copy()
    n = len(X)

    iki_i     = FEATURES.index("iki_mean_ms")
    perclos_i = FEATURES.index("perclos")
    wpm_i     = FEATURES.index("wpm")
    idle_i    = FEATURES.index("idle_ratio")

    for start in range(0, n - session_len, session_len):
        end = start + session_len
        fatigued = np.where(labels[start:end] == 2)[0]
        if len(fatigued) == 0:
            continue

        pos = fatigued / session_len          # normalized position in session: 0→1
        idx = start + fatigued

        X_out[idx, iki_i]     += pos * 80.0   # typing slows progressively
        X_out[idx, perclos_i] += pos * 0.12   # eyes close more over time
        X_out[idx, wpm_i]     -= pos * 10.0   # WPM drops over time
        X_out[idx, idle_i]    += pos * 0.15   # more zoning out

    # Re-clip everything after drift
    for i, feat in enumerate(FEATURES):
        lo, hi = BOUNDS[feat]
        X_out[:, i] = np.clip(X_out[:, i], lo, hi)

    return X_out


# ─────────────────────────────────────────────────────────────────────────────
# MULTI-TASK LABEL COMPUTATION
# Each of the 7 Flow Guardian features gets a derived ground-truth label.
# These are approximations from domain knowledge — good enough for a first model.
# ─────────────────────────────────────────────────────────────────────────────

def compute_labels(X: np.ndarray, state: np.ndarray, rng: np.random.Generator) -> dict:
    n     = len(X)
    feat  = {name: X[:, i] for i, name in enumerate(FEATURES)}

    # 1. Attention Residue (0.0–1.0)
    #    High when: recent app switch + short dwell + non-focused state
    switch_sig  = np.clip(feat["app_switches"] / 5.0, 0, 1)
    recency_sig = 1.0 - np.clip(feat["dwell_seconds"] / 120.0, 0, 1)
    state_w     = np.where(state == 0, 0.2, np.where(state == 1, 0.7, 0.5))
    attn_res    = np.clip(0.4*switch_sig + 0.35*recency_sig + 0.25*state_w
                          + rng.normal(0, 0.05, n), 0.0, 1.0)

    # 2. Pre-Error Probability (0.0–1.0)
    #    High when: irregular IKI + high backspace + wandering mouse
    iki_sig     = np.clip(feat["iki_std_ms"] / 150.0, 0, 1)
    bks_sig     = np.clip(feat["backspace_ratio"] / 0.4, 0, 1)
    mouse_sig   = 1.0 - np.clip(feat["path_linearity"], 0, 1)
    pre_err     = np.clip(0.45*iki_sig + 0.35*bks_sig + 0.20*mouse_sig
                          + rng.normal(0, 0.04, n), 0.0, 1.0)

    # 3. Interruptibility (0.0–1.0)
    #    High = safe to interrupt. Low = deep flow, do not disturb.
    burst_sig   = 1.0 - np.clip(feat["burst_length"] / 80.0, 0, 1)
    wpm_sig     = 1.0 - np.clip(feat["wpm"] / 100.0, 0, 1)
    intrpt      = np.clip(0.40*burst_sig + 0.35*feat["idle_ratio"] + 0.25*wpm_sig
                          + rng.normal(0, 0.05, n), 0.0, 1.0)

    # 4. Capsule Trigger Flag (0 or 1)
    #    Fire a Recovery Capsule when residue is high AND user just switched context
    capsule     = ((attn_res > 0.55) & (feat["app_switches"] >= 1.5)).astype(np.int64)

    # 5. Struggle Type (0=productive, 1=harmful, 2=neutral)
    #    Productive: confused but still making progress (some burst, not stuck)
    #    Harmful: confused + looping with no progress (high idle, tiny bursts)
    prod_mask   = (state == 1) & (feat["burst_length"] > 8) & (feat["backspace_ratio"] < 0.25) & (feat["idle_ratio"] < 0.35)
    harm_mask   = (state == 1) & (feat["burst_length"] <= 8) & (feat["idle_ratio"] >= 0.35)
    struggle    = np.where(prod_mask, 0, np.where(harm_mask, 1, 2)).astype(np.int64)

    # 6. Confusion Friction Score (0.0–1.0)
    #    How much friction in the current artifact? Scroll reversals are strong signal.
    lin_sig     = 1.0 - feat["path_linearity"]
    scroll_sig  = np.clip(feat["scroll_reversals"] / 10.0, 0, 1)
    pause_sig   = np.clip(feat["pause_freq_per_min"] / 8.0, 0, 1)
    confusion_f = np.clip(0.35*lin_sig + 0.35*scroll_sig + 0.30*pause_sig
                          + rng.normal(0, 0.05, n), 0.0, 1.0)

    # 7. Personal Deviation Score (0.0–1.0)
    #    During training: approximated as mean z-score distance from FOCUSED means.
    #    At runtime: the Cognitive Twin (Welford) replaces this with live baseline.
    f_means     = np.array([FOCUSED[f][0] for f in FEATURES], dtype=np.float32)
    f_stds      = np.array([max(FOCUSED[f][1], 1e-6) for f in FEATURES], dtype=np.float32)
    z           = np.abs((X - f_means) / f_stds)
    pers_dev    = np.clip(np.mean(z, axis=1) / 5.0 + rng.normal(0, 0.03, n), 0.0, 1.0)

    return {
        "attention_residue":   attn_res.astype(np.float32),
        "pre_error_prob":      pre_err.astype(np.float32),
        "interruptibility":    intrpt.astype(np.float32),
        "capsule_trigger":     capsule,
        "struggle_type":       struggle,
        "confusion_friction":  confusion_f.astype(np.float32),
        "personal_deviation":  pers_dev.astype(np.float32),
    }


# ─────────────────────────────────────────────────────────────────────────────
# MAIN GENERATION PIPELINE
# ─────────────────────────────────────────────────────────────────────────────

def generate_dataset(
    n_per_class: int = 500_000,
    seed: int = 42,
    output_dir: str = "./data",
    temporal_drift: bool = True,
) -> tuple:
    """
    Full pipeline: generates, drifts, labels, shuffles, and saves the dataset.

    Outputs two CSVs:
      data/features.csv  — 18 telemetry features + cognitive_state column
      data/labels.csv    — all 7 multi-task label columns

    Why two separate files?
    Keeps features and labels decoupled so you can easily swap label
    definitions during experimentation without regenerating raw features.
    """
    rng = np.random.default_rng(seed)
    print(f"\n[FlowGuardian DataGen] Seed={seed} | {n_per_class:,} windows/class | Total={n_per_class*3:,}\n")

    # ── Step 1: Sample raw feature windows per state ──────────────────────
    chunks_X, chunks_y = [], []
    for sid in range(3):
        print(f"  Sampling {STATE_NAMES[sid]:10s} ...", end=" ", flush=True)
        X_s = generate_state_windows(sid, n_per_class, rng)
        y_s = np.full(n_per_class, sid, dtype=np.int64)
        chunks_X.append(X_s)
        chunks_y.append(y_s)
        print(f"✓  shape={X_s.shape}")

    X = np.vstack(chunks_X)
    y = np.concatenate(chunks_y)

    # ── Step 2: Temporal fatigue drift ───────────────────────────────────
    if temporal_drift:
        print("\n  Applying temporal fatigue drift ...", end=" ", flush=True)
        X = apply_temporal_fatigue_drift(X, y, session_len=120, rng=rng)
        print("✓")

    # ── Step 3: Compute multi-task labels ────────────────────────────────
    print("  Computing 7 multi-task labels ...", end=" ", flush=True)
    labels = compute_labels(X, y, rng)
    print("✓")

    # ── Step 4: Shuffle (critical for stable training) ────────────────────
    print("  Shuffling ...", end=" ", flush=True)
    idx = rng.permutation(len(X))
    X   = X[idx]
    y   = y[idx]
    for k in labels:
        labels[k] = labels[k][idx]
    print("✓")

    # ── Step 5: Build DataFrames ──────────────────────────────────────────
    feat_df  = pd.DataFrame(X.astype(np.float32), columns=FEATURES)
    feat_df["cognitive_state"] = y

    label_df = pd.DataFrame({"cognitive_state": y, **labels})

    # ── Step 6: Save ──────────────────────────────────────────────────────
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)

    feat_path  = out / "features.csv"
    label_path = out / "labels.csv"
    feat_df.to_csv(feat_path,  index=False)
    label_df.to_csv(label_path, index=False)

    print(f"\n  ✓ features.csv  → {feat_path}  ({feat_df.shape[0]:,} rows × {feat_df.shape[1]} cols)")
    print(f"  ✓ labels.csv    → {label_path}  ({label_df.shape[0]:,} rows × {label_df.shape[1]} cols)")

    # ── Step 7: Sanity check ──────────────────────────────────────────────
    print("\n[FlowGuardian DataGen] Class distribution:")
    for sid, sname in STATE_NAMES.items():
        cnt = (y == sid).sum()
        print(f"  {sname:10s}: {cnt:>9,}  ({cnt/len(y)*100:.1f}%)")

    print("\n[FlowGuardian DataGen] Feature means by state (8 features shown):")
    summary = feat_df.groupby("cognitive_state")[FEATURES[:8]].mean()
    summary.index = [STATE_NAMES[i] for i in summary.index]
    print(summary.round(2).to_string())

    print("\n[FlowGuardian DataGen] Done. Run train.py next.\n")
    return feat_df, label_df


# ─────────────────────────────────────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Flow Guardian — Synthetic Telemetry Generator")
    parser.add_argument("--n_per_class", type=int, default=500_000,
                        help="Windows per cognitive state class (default: 500000)")
    parser.add_argument("--seed", type=int, default=42,
                        help="RNG seed for reproducibility (default: 42)")
    parser.add_argument("--output_dir", type=str, default="./data",
                        help="Output directory (default: ./data)")
    parser.add_argument("--no_drift", action="store_true",
                        help="Disable temporal fatigue drift (faster, less realistic)")
    parser.add_argument("--quick", action="store_true",
                        help="Quick test mode: 10K samples per class")
    args = parser.parse_args()

    if args.quick:
        args.n_per_class = 10_000
        print("[FlowGuardian DataGen] Quick mode: 10K samples/class")

    generate_dataset(
        n_per_class=args.n_per_class,
        seed=args.seed,
        output_dir=args.output_dir,
        temporal_drift=not args.no_drift,
    )
