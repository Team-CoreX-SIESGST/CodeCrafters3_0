#!/usr/bin/env bash
# run_pipeline.sh
# ================
# Runs the full Flow Guardian ML pipeline in one command.
# Usage:
#   bash run_pipeline.sh           # full run (1.5M samples, ~40 min on L40S)
#   bash run_pipeline.sh --quick   # test run (30K samples, ~5 min)

set -e  # exit immediately on any error

QUICK=false
N_PER_CLASS=500000

for arg in "$@"; do
  if [ "$arg" = "--quick" ]; then
    QUICK=true
    N_PER_CLASS=10000
    echo "[Pipeline] Quick mode: 10K samples per class"
  fi
done

echo ""
echo "========================================"
echo "  Flow Guardian — Full Training Pipeline"
echo "========================================"
echo ""

# Activate venv if present
if [ -d "venv" ]; then
  source venv/bin/activate
  echo "[Pipeline] Virtual environment activated"
fi

# ── Step 1: Generate synthetic data ──────────────────────────────────────────
echo ""
echo "[Pipeline] Step 1/3 — Generating synthetic telemetry data..."
python synthetic_data_gen.py --n_per_class "$N_PER_CLASS" --output_dir ./data
echo "[Pipeline] Step 1 complete ✓"

# ── Step 2: Train the model ───────────────────────────────────────────────────
echo ""
echo "[Pipeline] Step 2/3 — Training Multi-Task LSTM..."
if [ "$QUICK" = true ]; then
  python train.py --data_dir ./data --model_dir ./models --epochs 15 --batch_size 256
else
  python train.py --data_dir ./data --model_dir ./models --epochs 50 --batch_size 512
fi
echo "[Pipeline] Step 2 complete ✓"

# ── Step 3: Evaluate ─────────────────────────────────────────────────────────
echo ""
echo "[Pipeline] Step 3/3 — Evaluating ONNX model..."
python evaluate.py --data_dir ./data --model_dir ./models
echo "[Pipeline] Step 3 complete ✓"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "========================================"
echo "  Pipeline complete!"
echo ""
echo "  Files to copy back to daemon laptop:"
echo "  → models/flow_guardian.onnx"
echo "  → models/normalisation_min.npy"
echo "  → models/normalisation_max.npy"
echo ""
echo "  Evaluation results:"
echo "  → models/evaluation_report.txt"
echo "  → models/confusion_matrix.png"
echo "  → models/training_curves.png"
echo "========================================"
echo ""
