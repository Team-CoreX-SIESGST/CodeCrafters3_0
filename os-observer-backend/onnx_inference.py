import numpy as np
import onnxruntime as ort
from pathlib import Path

FEATURE_COLS = [
    "iki_mean_ms", "iki_std_ms", "hold_mean_ms", "backspace_ratio",
    "burst_length", "wpm", "pause_freq_per_min", "mouse_speed_px_s",
    "path_linearity", "click_dwell_ms", "direction_changes", "idle_ratio",
    "scroll_reversals", "perclos", "blink_rate_per_min", "ear_mean",
    "app_switches", "dwell_seconds",
]

class FlowGuardianInference:
    def __init__(self, model_dir: str = "ml/models", seq_len: int = 5):
        self.seq_len = seq_len
        model_path = Path(model_dir) / "flow_guardian.onnx"
        
        # CPU execution provider explicitly configured for broad compatibility
        self.session = ort.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])
        
        # Load min/max values for input normalization
        self.x_min = np.load(str(Path(model_dir) / "normalisation_min.npy"))
        self.x_max = np.load(str(Path(model_dir) / "normalisation_max.npy"))
        
        self.history = []

    def infer(self, current_features: dict) -> dict | None:
        """
        Takes a dictionary of 18 features representing the current 30-second window.
        Maintains a rolling history queue of length `seq_len` (5 windows = 2.5 minutes).
        Returns None until `seq_len` windows have been collected.
        """
        # 1. Convert dictionary to array in correct order (pad with 0.0 if missing) 
        # (Useful for initial testing before MediaPipe is wired in)
        feat_array = np.zeros(len(FEATURE_COLS), dtype=np.float32)
        for i, col in enumerate(FEATURE_COLS):
            feat_array[i] = current_features.get(col, 0.0)
            
        # 2. Normalize inputs to [0, 1] scale exactly as done during training
        feat_norm = (feat_array - self.x_min) / (self.x_max - self.x_min + 1e-8)
        
        # 3. Queue management
        self.history.append(feat_norm)
        if len(self.history) > self.seq_len:
            self.history.pop(0)
            
        if len(self.history) < self.seq_len:
            return None # Waiting to accumulate 2.5 minutes of context baseline
            
        # 4. Build batched tensor sequence (batch=1, seq_len=5, features=18)
        seq = np.stack(self.history)
        seq_batch = np.expand_dims(seq, axis=0) # shape: (1, 5, 18)
        
        # 5. Run low-latency inference
        outputs = self.session.run(None, {"telemetry": seq_batch})
        
        # Unpack the 8 model output heads
        state_logits  = outputs[0][0]
        residue_pred  = outputs[1][0]
        preerr_pred   = outputs[2][0]
        intrpt_pred   = outputs[3][0]
        capsule_pred  = outputs[4][0]
        struggle_log  = outputs[5][0]
        friction_pred = outputs[6][0]
        dev_pred      = outputs[7][0]
        
        # Decode max logits to classes
        state_idx = int(np.argmax(state_logits))
        state_names = {0: "focused", 1: "confused", 2: "fatigued"}
        
        struggle_idx = int(np.argmax(struggle_log))
        struggle_names = {0: "productive", 1: "harmful", 2: "neutral"}
        
        return {
            "cognitive_state": state_names[state_idx],
            "attention_residue": float(residue_pred),
            "pre_error_prob": float(preerr_pred),
            "interruptibility": float(intrpt_pred),
            "capsule_trigger": float(capsule_pred),
            "struggle_type": struggle_names[struggle_idx],
            "confusion_friction": float(friction_pred),
            "personal_deviation": float(dev_pred),
        }
