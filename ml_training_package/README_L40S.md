# Flow Guardian — L40S Training Package
## Run this on the NVIDIA L40S server. Produces `flow_guardian.onnx`.

---

## What this package does

1. Generates 1.5 million synthetic behavioral telemetry windows (< 3 min)
2. Trains a Multi-Task LSTM on those windows (< 35 min on L40S)
3. Evaluates the model and prints per-head accuracy (< 2 min)
4. Exports the trained model to ONNX format (~12MB file)

The output `models/flow_guardian.onnx` is what you copy back to the
daemon laptop and drop into `os-observer-backend/ml/models/`.

---

## Step-by-step

### 1. Upload this folder to the L40S server
```bash
# From your local machine:
scp -r ml_training_package/ user@l40s-server:~/flow_guardian/
```

### 2. SSH into the server
```bash
ssh user@l40s-server
cd ~/flow_guardian
```

### 3. Create a Python virtual environment
```bash
python3 -m venv venv
source venv/bin/activate
```

### 4. Install dependencies (takes 3-5 minutes first time)
```bash
pip install -r requirements.txt
```

### 5. Run the full pipeline with ONE command
```bash
bash run_pipeline.sh
```

Or run each step manually if you want to inspect between steps:
```bash
# Step A: Generate data (run once, reuse for multiple training runs)
python synthetic_data_gen.py --n_per_class 500000

# Step B: Train the model
python train.py --epochs 50 --batch_size 512 --seq_len 5

# Step C: Evaluate
python evaluate.py

# The ONNX file will be at: models/flow_guardian.onnx
```

---

## Quick test (30K samples, ~5 min total — use this to verify setup first)
```bash
bash run_pipeline.sh --quick
```

---

## Output files

| File | Description |
|---|---|
| `data/features.csv` | 1.5M rows × 19 columns (18 features + state label) |
| `data/labels.csv` | 1.5M rows × 8 label columns (all 7 heads + state) |
| `models/flow_guardian.onnx` | **THE FILE YOU NEED** — copy this back to the daemon |
| `models/training_curves.png` | Loss curves per epoch, per task head |
| `models/confusion_matrix.png` | 3-class cognitive state confusion matrix |
| `models/evaluation_report.txt` | Per-head accuracy / MAE numbers |

---

## Hyperparameters (defaults are already tuned — only change if needed)

| Param | Default | Notes |
|---|---|---|
| `--n_per_class` | 500000 | Samples per cognitive state class |
| `--seq_len` | 5 | LSTM sequence length (5 windows = 2.5 min of context) |
| `--hidden_size` | 128 | LSTM hidden dimension |
| `--num_layers` | 2 | LSTM depth |
| `--dropout` | 0.4 | Applied between LSTM layers |
| `--batch_size` | 512 | Safe for L40S VRAM |
| `--epochs` | 50 | Early stopping kicks in around epoch 30-40 typically |
| `--lr` | 1e-3 | AdamW learning rate |
| `--weight_decay` | 1e-4 | L2 regularization |
| `--val_split` | 0.2 | 20% held out for validation |
| `--patience` | 8 | Early stopping patience (epochs without val improvement) |

---

## Expected results on L40S

| Stage | Expected Duration |
|---|---|
| Data generation (500K/class) | 2–4 minutes |
| Training (50 epochs, bs=512) | 20–35 minutes |
| ONNX export | < 30 seconds |
| Evaluation | 1–2 minutes |
| **Total** | **~40 minutes** |

Expected final metrics (approximate, on synthetic data):
- Cognitive state classification accuracy: > 92%
- Pre-error probability MAE: < 0.07
- Attention residue MAE: < 0.08
- Interruptibility MAE: < 0.07

---

## After training — copy back to daemon

```bash
# From your local machine:
scp user@l40s-server:~/flow_guardian/models/flow_guardian.onnx \
    D:/PROJECTS/AI/CodeCrafters3.0/CodeCrafters3_0/os-observer-backend/ml/models/
```
