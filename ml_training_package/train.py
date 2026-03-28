"""
train.py
========
Multi-Task LSTM training script for Flow Guardian cognitive state model.

Architecture: One shared LSTM encoder → 7 lightweight MLP heads.
Each head predicts one of the 7 Flow Guardian cognitive metrics.

After training, the model is exported to ONNX format for local inference
on the demo laptop using onnxruntime (no GPU or PyTorch required at runtime).

Usage:
  python train.py                             # full training with defaults
  python train.py --quick                     # fast test run (10K samples)
  python train.py --epochs 30 --batch_size 1024  # custom hyperparams
"""

from __future__ import annotations

import argparse
import os
import time
from pathlib import Path

import numpy as np
import pandas as pd
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, Dataset, random_split
from tqdm import tqdm

# ─────────────────────────────────────────────────────────────────────────────
# CONFIGURATION
# ─────────────────────────────────────────────────────────────────────────────

FEATURE_COLS = [
    "iki_mean_ms", "iki_std_ms", "hold_mean_ms", "backspace_ratio",
    "burst_length", "wpm", "pause_freq_per_min", "mouse_speed_px_s",
    "path_linearity", "click_dwell_ms", "direction_changes", "idle_ratio",
    "scroll_reversals", "perclos", "blink_rate_per_min", "ear_mean",
    "app_switches", "dwell_seconds",
]

# Loss weights — tune these to balance the multi-task training.
# Higher weight = model prioritizes this head more during training.
LOSS_WEIGHTS = {
    "cognitive_state":   2.0,   # primary classification task — high weight
    "attention_residue": 1.0,
    "pre_error_prob":    1.5,   # slightly higher — judges love this feature
    "interruptibility":  1.0,
    "capsule_trigger":   0.8,
    "struggle_type":     1.2,
    "confusion_friction":1.0,
    "personal_deviation":0.8,
}

N_FEATURES   = len(FEATURE_COLS)   # 18
N_STATE_CLS  = 3                   # focused / confused / fatigued
N_STRUGGLE   = 3                   # productive / harmful / neutral


# ─────────────────────────────────────────────────────────────────────────────
# DATASET
# ─────────────────────────────────────────────────────────────────────────────

class CognitiveDataset(Dataset):
    """
    Loads features.csv and labels.csv, groups consecutive rows into
    overlapping sequences of length `seq_len`, and returns them as tensors.

    Why sequences?
    The LSTM needs a sequence of consecutive 30-second windows to learn
    temporal patterns — especially the progressive drift of fatigue and the
    trajectory difference between productive struggle and harmful confusion.

    A seq_len of 5 = 2.5 minutes of context per training sample.
    """

    def __init__(
        self,
        features_path: str,
        labels_path: str,
        seq_len: int = 5,
    ) -> None:
        print("[Dataset] Loading CSV files...", end=" ", flush=True)
        feat_df  = pd.read_csv(features_path)
        label_df = pd.read_csv(labels_path)
        print(f"✓  {len(feat_df):,} rows")

        # Extract feature matrix and normalise to [0, 1] per column
        X = feat_df[FEATURE_COLS].values.astype(np.float32)
        self.x_min = X.min(axis=0)
        self.x_max = X.max(axis=0)
        X_norm = (X - self.x_min) / (self.x_max - self.x_min + 1e-8)

        # Extract all label arrays
        self.y_state    = label_df["cognitive_state"].values.astype(np.int64)
        self.y_residue  = label_df["attention_residue"].values.astype(np.float32)
        self.y_preerr   = label_df["pre_error_prob"].values.astype(np.float32)
        self.y_intrpt   = label_df["interruptibility"].values.astype(np.float32)
        self.y_capsule  = label_df["capsule_trigger"].values.astype(np.float32)
        self.y_struggle = label_df["struggle_type"].values.astype(np.int64)
        self.y_friction = label_df["confusion_friction"].values.astype(np.float32)
        self.y_deviation= label_df["personal_deviation"].values.astype(np.float32)

        self.X      = torch.from_numpy(X_norm)
        self.seq_len = seq_len
        self.n_valid = len(X) - seq_len + 1

        print(f"[Dataset] Sequence length={seq_len} | Valid sequences={self.n_valid:,}")

    def __len__(self) -> int:
        return self.n_valid

    def __getitem__(self, idx: int):
        # Sequence: windows [idx, idx+seq_len)
        x_seq = self.X[idx : idx + self.seq_len]      # (seq_len, 18)

        # Label taken from the LAST window in the sequence (what we are predicting)
        t = idx + self.seq_len - 1
        return (
            x_seq,
            self.y_state[t],
            self.y_residue[t],
            self.y_preerr[t],
            self.y_intrpt[t],
            self.y_capsule[t],
            self.y_struggle[t],
            self.y_friction[t],
            self.y_deviation[t],
        )

    def save_normalisation(self, path: str) -> None:
        """Save min/max for use at inference time in the daemon."""
        np.save(str(path) + "_min.npy", self.x_min)
        np.save(str(path) + "_max.npy", self.x_max)
        print(f"[Dataset] Normalisation params saved to {path}_min/max.npy")


# ─────────────────────────────────────────────────────────────────────────────
# MODEL
# ─────────────────────────────────────────────────────────────────────────────

class FlowGuardianLSTM(nn.Module):
    """
    Multi-Task LSTM for cognitive state inference.

    One shared LSTM encoder compresses the input sequence into a latent
    cognitive vector. Seven lightweight MLP heads decode that vector into
    the 7 Flow Guardian cognitive metrics.

    Inputs:  (batch, seq_len, 18)
    Outputs: dict of 7 tensors, one per task head
    """

    def __init__(
        self,
        input_size:  int = N_FEATURES,
        hidden_size: int = 128,
        num_layers:  int = 2,
        dropout:     float = 0.4,
    ) -> None:
        super().__init__()

        self.lstm = nn.LSTM(
            input_size  = input_size,
            hidden_size = hidden_size,
            num_layers  = num_layers,
            batch_first = True,
            dropout     = dropout if num_layers > 1 else 0.0,
        )
        self.layer_norm = nn.LayerNorm(hidden_size)

        def _reg_head(in_dim: int = hidden_size) -> nn.Sequential:
            """Regression head — outputs a single value in [0, 1] via Sigmoid."""
            return nn.Sequential(
                nn.Linear(in_dim, 64), nn.GELU(), nn.Dropout(0.2),
                nn.Linear(64, 1), nn.Sigmoid(),
            )

        def _cls_head(in_dim: int, n_classes: int) -> nn.Sequential:
            """Classification head — outputs logits (no softmax, use CrossEntropy)."""
            return nn.Sequential(
                nn.Linear(in_dim, 32), nn.GELU(), nn.Dropout(0.2),
                nn.Linear(32, n_classes),
            )

        # ── 7 output heads ──────────────────────────────────────────────────
        # H1: Attention Residue (regression)
        self.head_residue    = _reg_head()
        # H2: Pre-Error Probability (regression)
        self.head_pre_error  = _reg_head()
        # H3: Interruptibility (regression)
        self.head_intrpt     = _reg_head()
        # H4: Capsule Trigger (binary, regression treated as probability)
        self.head_capsule    = _reg_head()
        # H5: Struggle Type (3-class classification: productive/harmful/neutral)
        self.head_struggle   = _cls_head(hidden_size, N_STRUGGLE)
        # H6: Confusion Friction (regression)
        self.head_friction   = _reg_head()
        # H7: Personal Deviation (regression)
        self.head_deviation  = _reg_head()
        # Primary: Cognitive State (3-class classification: focused/confused/fatigued)
        self.head_state      = _cls_head(hidden_size, N_STATE_CLS)

    def forward(self, x: torch.Tensor) -> dict[str, torch.Tensor]:
        # x: (batch, seq_len, 18)
        lstm_out, _ = self.lstm(x)             # (batch, seq_len, hidden)
        # Use ONLY the last time step — this is the "current state" prediction
        h = self.layer_norm(lstm_out[:, -1, :])  # (batch, hidden)

        return {
            "cognitive_state":   self.head_state(h).squeeze(-1),     # (batch, 3) logits
            "attention_residue": self.head_residue(h).squeeze(-1),   # (batch,)
            "pre_error_prob":    self.head_pre_error(h).squeeze(-1), # (batch,)
            "interruptibility":  self.head_intrpt(h).squeeze(-1),    # (batch,)
            "capsule_trigger":   self.head_capsule(h).squeeze(-1),   # (batch,)
            "struggle_type":     self.head_struggle(h).squeeze(-1),  # (batch, 3) logits
            "confusion_friction":self.head_friction(h).squeeze(-1),  # (batch,)
            "personal_deviation":self.head_deviation(h).squeeze(-1), # (batch,)
        }

    def count_params(self) -> int:
        return sum(p.numel() for p in self.parameters() if p.requires_grad)


# ─────────────────────────────────────────────────────────────────────────────
# LOSS
# ─────────────────────────────────────────────────────────────────────────────

class MultiTaskLoss(nn.Module):
    """
    Weighted combination of per-head losses.

    Classification heads use CrossEntropyLoss.
    Regression heads use MSELoss (SmoothL1 for robustness to outliers).
    """

    def __init__(self, weights: dict = LOSS_WEIGHTS) -> None:
        super().__init__()
        self.w   = weights
        self.ce  = nn.CrossEntropyLoss()
        self.mse = nn.SmoothL1Loss()
        self.bce = nn.BCELoss()

    def forward(self, preds: dict, batch: tuple) -> tuple[torch.Tensor, dict]:
        (_, y_state, y_res, y_prerr, y_intrpt,
         y_cap, y_struggle, y_fric, y_dev) = batch

        losses = {
            "cognitive_state":    self.ce(preds["cognitive_state"],   y_state),
            "attention_residue":  self.mse(preds["attention_residue"],y_res),
            "pre_error_prob":     self.mse(preds["pre_error_prob"],   y_prerr),
            "interruptibility":   self.mse(preds["interruptibility"], y_intrpt),
            "capsule_trigger":    self.bce(preds["capsule_trigger"],  y_cap),
            "struggle_type":      self.ce(preds["struggle_type"],     y_struggle),
            "confusion_friction": self.mse(preds["confusion_friction"],y_fric),
            "personal_deviation": self.mse(preds["personal_deviation"],y_dev),
        }

        total = sum(self.w[k] * v for k, v in losses.items())
        return total, losses


# ─────────────────────────────────────────────────────────────────────────────
# TRAINING LOOP
# ─────────────────────────────────────────────────────────────────────────────

def move_batch_to_device(batch: tuple, device: torch.device) -> tuple:
    """Move all tensors in a batch tuple to the target device."""
    return tuple(
        t.to(device) if isinstance(t, torch.Tensor) else t
        for t in batch
    )


def run_epoch(
    model: FlowGuardianLSTM,
    loader: DataLoader,
    criterion: MultiTaskLoss,
    optimizer: torch.optim.Optimizer | None,
    device: torch.device,
    is_train: bool,
) -> tuple[float, dict]:
    """Single train or validation epoch. Returns (total_loss, per_head_losses)."""
    model.train(is_train)
    total_loss  = 0.0
    head_losses = {k: 0.0 for k in LOSS_WEIGHTS}
    n_batches   = 0

    ctx = torch.enable_grad() if is_train else torch.no_grad()
    with ctx:
        for raw_batch in loader:
            batch = move_batch_to_device(raw_batch, device)
            x_seq = batch[0]                      # (batch, seq_len, 18)

            preds = model(x_seq)
            loss, per_head = criterion(preds, batch)

            if is_train:
                optimizer.zero_grad()
                loss.backward()
                nn.utils.clip_grad_norm_(model.parameters(), 1.0)  # prevent exploding gradients
                optimizer.step()

            total_loss += loss.item()
            for k, v in per_head.items():
                head_losses[k] += v.item()
            n_batches += 1

    avg_total  = total_loss / max(n_batches, 1)
    avg_heads  = {k: v / max(n_batches, 1) for k, v in head_losses.items()}
    return avg_total, avg_heads


# ─────────────────────────────────────────────────────────────────────────────
# ONNX EXPORT
# ─────────────────────────────────────────────────────────────────────────────

def export_onnx(
    model: FlowGuardianLSTM,
    seq_len: int,
    output_path: str,
    device: torch.device,
) -> None:
    """
    Exports the trained PyTorch model to ONNX format.

    The exported model accepts a batch of telemetry sequences and returns
    all 7 cognitive metric outputs in a single forward pass.

    At inference time, the daemon calls:
      session = onnxruntime.InferenceSession("flow_guardian.onnx")
      outputs = session.run(None, {"telemetry": feature_array})
    """
    model.eval()
    # dummy input: batch=1, seq=seq_len, features=18
    dummy = torch.zeros(1, seq_len, N_FEATURES, device=device)

    # Trace through the model once to get output names
    with torch.no_grad():
        sample_out = model(dummy)
    output_names = list(sample_out.keys())

    torch.onnx.export(
        model,
        dummy,
        output_path,
        opset_version    = 17,
        input_names      = ["telemetry"],
        output_names     = output_names,
        dynamic_axes     = {
            "telemetry": {0: "batch_size"},
            **{k: {0: "batch_size"} for k in output_names},
        },
        do_constant_folding = True,
    )
    size_mb = os.path.getsize(output_path) / 1e6
    print(f"\n[ONNX] Exported → {output_path}  ({size_mb:.1f} MB)")
    print(f"[ONNX] Output names: {output_names}")


def validate_onnx(onnx_path: str, seq_len: int) -> None:
    """Quick smoke test — runs one forward pass with onnxruntime."""
    import onnxruntime as ort
    session = ort.InferenceSession(onnx_path, providers=["CPUExecutionProvider"])
    dummy = np.zeros((1, seq_len, N_FEATURES), dtype=np.float32)
    outputs = session.run(None, {"telemetry": dummy})
    print(f"[ONNX] Validation passed — {len(outputs)} output(s), first shape: {outputs[0].shape}")


# ─────────────────────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────────────────────

def parse_args():
    p = argparse.ArgumentParser(description="Flow Guardian Multi-Task LSTM Trainer")
    p.add_argument("--data_dir",     type=str,   default="./data",   help="Directory with features.csv and labels.csv")
    p.add_argument("--model_dir",    type=str,   default="./models", help="Output directory for model files")
    p.add_argument("--seq_len",      type=int,   default=5,          help="LSTM sequence length (windows)")
    p.add_argument("--hidden_size",  type=int,   default=128,        help="LSTM hidden dimension")
    p.add_argument("--num_layers",   type=int,   default=2,          help="Number of LSTM layers")
    p.add_argument("--dropout",      type=float, default=0.4,        help="LSTM dropout between layers")
    p.add_argument("--batch_size",   type=int,   default=512,        help="Training batch size")
    p.add_argument("--epochs",       type=int,   default=50,         help="Maximum training epochs")
    p.add_argument("--lr",           type=float, default=1e-3,       help="AdamW learning rate")
    p.add_argument("--weight_decay", type=float, default=1e-4,       help="AdamW weight decay (L2 reg)")
    p.add_argument("--val_split",    type=float, default=0.2,        help="Validation set fraction")
    p.add_argument("--patience",     type=int,   default=8,          help="Early stopping patience")
    p.add_argument("--seed",         type=int,   default=42,         help="Random seed")
    p.add_argument("--quick",        action="store_true",            help="Quick mode: generate 10K/class data first")
    return p.parse_args()


def main():
    args = parse_args()
    torch.manual_seed(args.seed)
    np.random.seed(args.seed)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"\n{'='*60}")
    print(f"  Flow Guardian — Multi-Task LSTM Training")
    print(f"{'='*60}")
    print(f"  Device      : {device}")
    if device.type == "cuda":
        print(f"  GPU         : {torch.cuda.get_device_name(0)}")
        print(f"  VRAM        : {torch.cuda.get_device_properties(0).total_memory / 1e9:.1f} GB")
    print(f"  Seq length  : {args.seq_len} windows (~{args.seq_len * 0.5:.1f} min context)")
    print(f"  Batch size  : {args.batch_size}")
    print(f"  Max epochs  : {args.epochs}  (early stopping patience={args.patience})")
    print(f"{'='*60}\n")

    # ── Maybe generate data first ──────────────────────────────────────────
    feat_path  = Path(args.data_dir) / "features.csv"
    label_path = Path(args.data_dir) / "labels.csv"

    if not feat_path.exists():
        print("[Main] Data not found — generating now...")
        n = 10_000 if args.quick else 500_000
        os.system(f"python synthetic_data_gen.py --n_per_class {n} --output_dir {args.data_dir}")

    # ── Dataset & DataLoaders ──────────────────────────────────────────────
    dataset = CognitiveDataset(str(feat_path), str(label_path), seq_len=args.seq_len)

    val_size   = int(len(dataset) * args.val_split)
    train_size = len(dataset) - val_size
    train_ds, val_ds = random_split(
        dataset, [train_size, val_size],
        generator=torch.Generator().manual_seed(args.seed)
    )
    print(f"[Main] Train={train_size:,}  Val={val_size:,}")

    train_loader = DataLoader(train_ds, batch_size=args.batch_size, shuffle=True,
                              num_workers=4, pin_memory=(device.type == "cuda"))
    val_loader   = DataLoader(val_ds,   batch_size=args.batch_size, shuffle=False,
                              num_workers=4, pin_memory=(device.type == "cuda"))

    # ── Model ─────────────────────────────────────────────────────────────
    model = FlowGuardianLSTM(
        input_size  = N_FEATURES,
        hidden_size = args.hidden_size,
        num_layers  = args.num_layers,
        dropout     = args.dropout,
    ).to(device)
    print(f"[Model] Parameters: {model.count_params():,}")

    criterion = MultiTaskLoss(LOSS_WEIGHTS)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=args.weight_decay)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=args.epochs)

    # ── Training loop ─────────────────────────────────────────────────────
    best_val_loss = float("inf")
    patience_ctr  = 0
    history       = {"train": [], "val": []}

    model_dir = Path(args.model_dir)
    model_dir.mkdir(parents=True, exist_ok=True)
    best_ckpt = model_dir / "best_checkpoint.pt"

    print(f"\n[Train] Starting training...\n")
    t_start = time.time()

    for epoch in range(1, args.epochs + 1):
        t_ep = time.time()
        train_loss, train_heads = run_epoch(model, train_loader, criterion, optimizer, device, is_train=True)
        val_loss,   val_heads   = run_epoch(model, val_loader,   criterion, None,      device, is_train=False)
        scheduler.step()

        history["train"].append(train_loss)
        history["val"].append(val_loss)

        elapsed  = time.time() - t_ep
        improved = "✓ best" if val_loss < best_val_loss else ""
        print(
            f"  Epoch {epoch:3d}/{args.epochs}  "
            f"train={train_loss:.4f}  val={val_loss:.4f}  "
            f"lr={scheduler.get_last_lr()[0]:.2e}  "
            f"t={elapsed:.1f}s  {improved}"
        )

        if val_loss < best_val_loss:
            best_val_loss = val_loss
            patience_ctr  = 0
            torch.save({
                "epoch":       epoch,
                "model_state": model.state_dict(),
                "val_loss":    val_loss,
                "args":        vars(args),
            }, best_ckpt)
        else:
            patience_ctr += 1
            if patience_ctr >= args.patience:
                print(f"\n[Train] Early stopping triggered at epoch {epoch} (patience={args.patience})")
                break

    total_time = time.time() - t_start
    print(f"\n[Train] Finished in {total_time/60:.1f} minutes. Best val loss: {best_val_loss:.4f}")

    # ── Reload best checkpoint ─────────────────────────────────────────────
    print(f"[Train] Loading best checkpoint from epoch with val_loss={best_val_loss:.4f}")
    ckpt = torch.load(best_ckpt, map_location=device)
    model.load_state_dict(ckpt["model_state"])

    # ── Save normalisation params (needed at inference time) ───────────────
    norm_path = str(model_dir / "normalisation")
    dataset.save_normalisation(norm_path)

    # ── Save loss history ──────────────────────────────────────────────────
    try:
        import matplotlib.pyplot as plt
        fig, ax = plt.subplots(figsize=(10, 5))
        ax.plot(history["train"], label="Train Loss")
        ax.plot(history["val"],   label="Val Loss")
        ax.set_xlabel("Epoch"); ax.set_ylabel("Total Loss"); ax.legend()
        ax.set_title("Flow Guardian — Multi-Task Training Curves")
        fig.savefig(model_dir / "training_curves.png", dpi=120, bbox_inches="tight")
        print(f"[Train] Training curves saved → {model_dir / 'training_curves.png'}")
    except Exception as e:
        print(f"[Train] Could not save plot ({e}) — skipping")

    # ── ONNX Export ───────────────────────────────────────────────────────
    onnx_path = str(model_dir / "flow_guardian.onnx")
    export_onnx(model, args.seq_len, onnx_path, device)
    validate_onnx(onnx_path, args.seq_len)

    print(f"\n{'='*60}")
    print(f"  DONE. Copy this file to the daemon:           ")
    print(f"  {onnx_path}")
    print(f"  Also copy: {norm_path}_min.npy and _max.npy  ")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    main()
