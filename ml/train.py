import os
import argparse
import pandas as pd
import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import train_test_split

# ─────────────────────────────────────────────────────────────────────────────
# DATASET AND MODEL DEFINITION
# ─────────────────────────────────────────────────────────────────────────────

class TelemetryDataset(Dataset):
    def __init__(self, X, y):
        self.X = torch.tensor(X, dtype=torch.float32)
        self.state = torch.tensor(y['cognitive_state'].values, dtype=torch.long)
        self.residue = torch.tensor(y['attention_residue'].values, dtype=torch.float32)
        self.pre_error = torch.tensor(y['pre_error_prob'].values, dtype=torch.float32)
        self.interrupt = torch.tensor(y['interruptibility'].values, dtype=torch.float32)
        self.capsule = torch.tensor(y['capsule_trigger'].values, dtype=torch.float32)
        self.struggle = torch.tensor(y['struggle_type'].values, dtype=torch.long)
        self.friction = torch.tensor(y['confusion_friction'].values, dtype=torch.float32)
        self.deviation = torch.tensor(y['personal_deviation'].values, dtype=torch.float32)

    def __len__(self):
        return len(self.X)

    def __getitem__(self, idx):
        # We treat each 30-sec window as a sequence of length 1 for the LSTM
        return self.X[idx].unsqueeze(0), {
            'state': self.state[idx],
            'residue': self.residue[idx],
            'pre_error': self.pre_error[idx],
            'interrupt': self.interrupt[idx],
            'capsule': self.capsule[idx],
            'struggle': self.struggle[idx],
            'friction': self.friction[idx],
            'deviation': self.deviation[idx]
        }


class MultiTaskLSTM(nn.Module):
    def __init__(self, input_dim=18, hidden_dim=128):
        super(MultiTaskLSTM, self).__init__()
        
        # Shared Encoder
        self.lstm = nn.LSTM(
            input_size=input_dim,
            hidden_size=hidden_dim,
            num_layers=2,
            batch_first=True,
            dropout=0.4
        )
        
        # State Head - 3 classes (focused, confused, fatigued)
        self.head_state = nn.Sequential(
            nn.Linear(hidden_dim, 64),
            nn.ReLU(),
            nn.Linear(64, 3)
        )
        
        # H1: Attention Residue
        self.head_residue = nn.Sequential(
            nn.Linear(hidden_dim, 64),
            nn.ReLU(),
            nn.Linear(64, 1),
            nn.Sigmoid()
        )
        
        # H2: Pre-Error Probability
        self.head_pre_error = nn.Sequential(
            nn.Linear(hidden_dim, 64),
            nn.ReLU(),
            nn.Linear(64, 1),
            nn.Sigmoid()
        )
        
        # H3: Interruptibility
        self.head_interrupt = nn.Sequential(
            nn.Linear(hidden_dim, 64),
            nn.ReLU(),
            nn.Linear(64, 1),
            nn.Sigmoid()
        )
        
        # H4: Capsule Trigger
        self.head_capsule = nn.Sequential(
            nn.Linear(hidden_dim, 32),
            nn.ReLU(),
            nn.Linear(32, 1),
            nn.Sigmoid()
        )
        
        # H5: Struggle Type
        self.head_struggle = nn.Sequential(
            nn.Linear(hidden_dim, 32),
            nn.ReLU(),
            nn.Linear(32, 3)
        )
        
        # H6: Confusion Friction
        self.head_friction = nn.Sequential(
            nn.Linear(hidden_dim, 64),
            nn.ReLU(),
            nn.Linear(64, 1),
            nn.Sigmoid()
        )
        
        # H7: Personal Deviation
        self.head_deviation = nn.Sequential(
            nn.Linear(hidden_dim, 64),
            nn.ReLU(),
            nn.Linear(64, 1),
            nn.Sigmoid()
        )
        
    def forward(self, x):
        lstm_out, _ = self.lstm(x)
        latent = lstm_out[:, -1, :]  # Take output of last sequence step
        
        return {
            'state': self.head_state(latent),
            'residue': self.head_residue(latent).squeeze(-1),
            'pre_error': self.head_pre_error(latent).squeeze(-1),
            'interrupt': self.head_interrupt(latent).squeeze(-1),
            'capsule': self.head_capsule(latent).squeeze(-1),
            'struggle': self.head_struggle(latent),
            'friction': self.head_friction(latent).squeeze(-1),
            'deviation': self.head_deviation(latent).squeeze(-1)
        }

# ─────────────────────────────────────────────────────────────────────────────
# TRAINING LOOP AND ONNX EXPORT
# ─────────────────────────────────────────────────────────────────────────────

def train_model(data_dir='./data', epochs=50, batch_size=512, lr=1e-3, export_dir='./models'):
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    print(f"Using device: {device}")
    
    # Load data
    features_df = pd.read_csv(os.path.join(data_dir, 'features.csv'))
    labels_df = pd.read_csv(os.path.join(data_dir, 'labels.csv'))
    
    # Features (first 18 columns)
    feature_cols = [col for col in features_df.columns if col != 'cognitive_state']
    X = features_df[feature_cols].values
    
    # Scale features
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)
    
    # Split
    X_train, X_val, y_train, y_val = train_test_split(X_scaled, labels_df, test_size=0.2, random_state=42)
    
    train_dataset = TelemetryDataset(X_train, y_train)
    val_dataset = TelemetryDataset(X_val, y_val)
    
    train_loader = DataLoader(train_dataset, batch_size=batch_size, shuffle=True)
    val_loader = DataLoader(val_dataset, batch_size=batch_size, shuffle=False)
    
    model = MultiTaskLSTM().to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs)
    
    # Loss functions
    crit_ce = nn.CrossEntropyLoss()
    crit_mse = nn.MSELoss()
    crit_bce = nn.BCELoss()
    
    # Training Loop
    best_val_loss = float('inf')
    patience = 8
    patience_counter = 0
    
    print("\nStarting training...")
    for epoch in range(epochs):
        model.train()
        train_loss = 0.0
        for batch_X, batch_y in train_loader:
            batch_X = batch_X.to(device)
            # Send targets to device
            batch_y = {k: v.to(device) for k, v in batch_y.items()}
            
            optimizer.zero_grad()
            outputs = model(batch_X)
            
            # Composite Loss computation
            loss = (
                1.0 * crit_ce(outputs['state'], batch_y['state']) +
                1.0 * crit_mse(outputs['residue'], batch_y['residue']) +
                1.0 * crit_mse(outputs['pre_error'], batch_y['pre_error']) +
                1.0 * crit_mse(outputs['interrupt'], batch_y['interrupt']) +
                1.0 * crit_bce(outputs['capsule'], batch_y['capsule']) +
                1.0 * crit_ce(outputs['struggle'], batch_y['struggle']) +
                1.0 * crit_mse(outputs['friction'], batch_y['friction']) +
                1.0 * crit_mse(outputs['deviation'], batch_y['deviation'])
            )
            
            loss.backward()
            optimizer.step()
            train_loss += loss.item()
            
        scheduler.step()
        train_loss /= len(train_loader)
        
        # Validation
        model.eval()
        val_loss = 0.0
        with torch.no_grad():
            for batch_X, batch_y in val_loader:
                batch_X = batch_X.to(device)
                batch_y = {k: v.to(device) for k, v in batch_y.items()}
                
                outputs = model(batch_X)
                loss = (
                    1.0 * crit_ce(outputs['state'], batch_y['state']) +
                    1.0 * crit_mse(outputs['residue'], batch_y['residue']) +
                    1.0 * crit_mse(outputs['pre_error'], batch_y['pre_error']) +
                    1.0 * crit_mse(outputs['interrupt'], batch_y['interrupt']) +
                    1.0 * crit_bce(outputs['capsule'], batch_y['capsule']) +
                    1.0 * crit_ce(outputs['struggle'], batch_y['struggle']) +
                    1.0 * crit_mse(outputs['friction'], batch_y['friction']) +
                    1.0 * crit_mse(outputs['deviation'], batch_y['deviation'])
                )
                val_loss += loss.item()
                
        val_loss /= len(val_loader)
        print(f"Epoch {epoch+1:02d}/{epochs} | Train Loss: {train_loss:.4f} | Val Loss: {val_loss:.4f}")
        
        # Early Stopping
        if val_loss < best_val_loss:
            best_val_loss = val_loss
            patience_counter = 0
            best_model_state = model.state_dict().copy()
        else:
            patience_counter += 1
            if patience_counter >= patience:
                print(f"Early stopping at epoch {epoch+1}")
                break
                
    # Load best model
    model.load_state_dict(best_model_state)
    
    # Export to ONNX
    os.makedirs(export_dir, exist_ok=True)
    onnx_path = os.path.join(export_dir, 'flow_guardian.onnx')
    model.eval()
    model.to('cpu')
    dummy_input = torch.randn(1, 1, 18)
    
    print(f"\nExporting ONNX model to {onnx_path}...")
    torch.onnx.export(
        model, 
        dummy_input, 
        onnx_path,
        opset_version=17,
        input_names=["telemetry"],
        output_names=["state", "residue", "pre_error", "interruptibility", 
                      "capsule", "struggle", "friction", "deviation"],
        dynamic_axes={"telemetry": {0: "batch_size", 1: "seq_len"}}
    )
    print("Export complete. Flow Guardian Model Ready!")

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="Multi-Task LSTM Training")
    parser.add_argument("--data_dir", type=str, default="./data")
    parser.add_argument("--export_dir", type=str, default="./models")
    parser.add_argument("--epochs", type=int, default=50)
    args = parser.parse_args()
    
    train_model(data_dir=args.data_dir, epochs=args.epochs, export_dir=args.export_dir)
