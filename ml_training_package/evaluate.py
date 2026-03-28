"""
evaluate.py
===========
Loads the trained ONNX model and evaluates it against the validation set.

Outputs:
  - Cognitive state classification report (precision, recall, F1 per class)
  - Per-head MAE for all regression tasks
  - Confusion matrix image saved to models/confusion_matrix.png
  - Full text report saved to models/evaluation_report.txt

Usage:
  python evaluate.py
  python evaluate.py --data_dir ./data --model_dir ./models
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import pandas as pd

# ─────────────────────────────────────────────────────────────────────────────
# CONFIG (must match train.py)
# ─────────────────────────────────────────────────────────────────────────────

FEATURE_COLS = [
    "iki_mean_ms", "iki_std_ms", "hold_mean_ms", "backspace_ratio",
    "burst_length", "wpm", "pause_freq_per_min", "mouse_speed_px_s",
    "path_linearity", "click_dwell_ms", "direction_changes", "idle_ratio",
    "scroll_reversals", "perclos", "blink_rate_per_min", "ear_mean",
    "app_switches", "dwell_seconds",
]

STATE_NAMES    = {0: "focused", 1: "confused", 2: "fatigued"}
STRUGGLE_NAMES = {0: "productive", 1: "harmful", 2: "neutral"}


def parse_args():
    p = argparse.ArgumentParser(description="Flow Guardian ONNX Model Evaluator")
    p.add_argument("--data_dir",  type=str, default="./data",   help="Directory with features.csv and labels.csv")
    p.add_argument("--model_dir", type=str, default="./models", help="Directory with flow_guardian.onnx and normalisation files")
    p.add_argument("--seq_len",   type=int, default=5,          help="Sequence length used during training")
    p.add_argument("--n_eval",    type=int, default=50_000,     help="Number of samples to evaluate (default: 50K)")
    return p.parse_args()


def main():
    args = parse_args()
    model_dir = Path(args.model_dir)
    data_dir  = Path(args.data_dir)

    print(f"\n[Evaluate] Loading ONNX model...", end=" ", flush=True)
    import onnxruntime as ort
    session = ort.InferenceSession(
        str(model_dir / "flow_guardian.onnx"),
        providers=["CUDAExecutionProvider", "CPUExecutionProvider"],
    )
    print("✓")

    # Load normalisation
    x_min = np.load(str(model_dir / "normalisation_min.npy"))
    x_max = np.load(str(model_dir / "normalisation_max.npy"))

    # Load eval data
    print(f"[Evaluate] Loading data...", end=" ", flush=True)
    feat_df  = pd.read_csv(data_dir / "features.csv")
    label_df = pd.read_csv(data_dir / "labels.csv")
    n = min(args.n_eval + args.seq_len, len(feat_df))
    feat_df  = feat_df.iloc[-n:].reset_index(drop=True)
    label_df = label_df.iloc[-n:].reset_index(drop=True)
    print(f"✓  {len(feat_df):,} rows")

    # Build sequences
    X_raw = feat_df[FEATURE_COLS].values.astype(np.float32)
    X     = (X_raw - x_min) / (x_max - x_min + 1e-8)

    n_seq = len(X) - args.seq_len + 1
    print(f"[Evaluate] Running inference on {n_seq:,} sequences...")

    all_state_preds, all_state_true   = [], []
    all_residue_preds, all_residue_true = [], []
    all_preerr_preds, all_preerr_true   = [], []
    all_intrpt_preds, all_intrpt_true   = [], []
    all_struggle_preds, all_struggle_true = [], []
    all_friction_preds, all_friction_true = [], []

    BATCH = 1024
    for start in range(0, n_seq, BATCH):
        end = min(start + BATCH, n_seq)
        # Build batch of sequences
        seqs = np.stack([X[i:i + args.seq_len] for i in range(start, end)])  # (B, seq_len, 18)
        outputs = session.run(None, {"telemetry": seqs})

        # ONNX outputs order matches training: state, residue, pre_error, intrpt, capsule, struggle, friction, deviation
        state_logits  = outputs[0]  # (B, 3)
        residue_pred  = outputs[1]  # (B,)
        preerr_pred   = outputs[2]
        intrpt_pred   = outputs[3]
        struggle_log  = outputs[5]  # (B, 3)
        friction_pred = outputs[6]

        t_end = end - 1  # label index for the last window in last sequence

        state_pred    = np.argmax(state_logits, axis=-1)
        struggle_pred = np.argmax(struggle_log, axis=-1)

        indices = list(range(start + args.seq_len - 1, end + args.seq_len - 1))
        indices = [min(i, len(label_df) - 1) for i in indices]

        all_state_preds.extend(state_pred.tolist())
        all_state_true.extend(label_df["cognitive_state"].iloc[indices].tolist())
        all_residue_preds.extend(residue_pred.tolist())
        all_residue_true.extend(label_df["attention_residue"].iloc[indices].tolist())
        all_preerr_preds.extend(preerr_pred.tolist())
        all_preerr_true.extend(label_df["pre_error_prob"].iloc[indices].tolist())
        all_intrpt_preds.extend(intrpt_pred.tolist())
        all_intrpt_true.extend(label_df["interruptibility"].iloc[indices].tolist())
        all_struggle_preds.extend(struggle_pred.tolist())
        all_struggle_true.extend(label_df["struggle_type"].iloc[indices].tolist())
        all_friction_preds.extend(friction_pred.tolist())
        all_friction_true.extend(label_df["confusion_friction"].iloc[indices].tolist())

    # ── Classification reports ─────────────────────────────────────────────
    from sklearn.metrics import (
        classification_report, confusion_matrix, mean_absolute_error,
    )

    state_report    = classification_report(
        all_state_true, all_state_preds,
        target_names=["focused", "confused", "fatigued"],
    )
    struggle_report = classification_report(
        all_struggle_true, all_struggle_preds,
        target_names=["productive", "harmful", "neutral"],
    )

    # ── Regression MAE per head ────────────────────────────────────────────
    mae_residue  = mean_absolute_error(all_residue_true,  all_residue_preds)
    mae_preerr   = mean_absolute_error(all_preerr_true,   all_preerr_preds)
    mae_intrpt   = mean_absolute_error(all_intrpt_true,   all_intrpt_preds)
    mae_friction = mean_absolute_error(all_friction_true, all_friction_preds)

    # ── Print results ─────────────────────────────────────────────────────
    report = f"""
{'='*60}
FLOW GUARDIAN — ONNX Model Evaluation Report
{'='*60}

COGNITIVE STATE CLASSIFICATION (primary task)
{state_report}

STRUGGLE TYPE CLASSIFICATION
{struggle_report}

REGRESSION HEAD MAE (lower is better, range 0.0–1.0)
  Attention Residue  : {mae_residue:.4f}
  Pre-Error Prob     : {mae_preerr:.4f}
  Interruptibility   : {mae_intrpt:.4f}
  Confusion Friction : {mae_friction:.4f}

{'='*60}
"""
    print(report)

    # Save report
    report_path = model_dir / "evaluation_report.txt"
    report_path.write_text(report)
    print(f"[Evaluate] Report saved → {report_path}")

    # ── Confusion matrix plot ─────────────────────────────────────────────
    try:
        import matplotlib.pyplot as plt
        import seaborn as sns

        cm = confusion_matrix(all_state_true, all_state_preds, normalize="true")
        fig, ax = plt.subplots(figsize=(7, 6))
        sns.heatmap(cm, annot=True, fmt=".2f", cmap="Blues", ax=ax,
                    xticklabels=["focused", "confused", "fatigued"],
                    yticklabels=["focused", "confused", "fatigued"])
        ax.set_xlabel("Predicted"); ax.set_ylabel("True")
        ax.set_title("Cognitive State — Normalised Confusion Matrix")
        cm_path = model_dir / "confusion_matrix.png"
        fig.savefig(cm_path, dpi=120, bbox_inches="tight")
        print(f"[Evaluate] Confusion matrix saved → {cm_path}")
    except Exception as e:
        print(f"[Evaluate] Could not save confusion matrix ({e})")

    print("\n[Evaluate] Done.\n")


if __name__ == "__main__":
    main()
