"""
Train XGBoost classifier on ZenOS simulation data.

Pre-requisite (macOS only, one-time):
    brew install libomp

Usage:
    python ml_model/train_model.py

Outputs:
    ml_model/numiz_model_v1.json
    ml_model/feature_columns.json
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

# ── XGBoost pre-flight check ──────────────────────────────────────────────────
try:
    import xgboost as xgb
except Exception as exc:                            # noqa: BLE001
    sys.exit(
        f"\n[ERROR] Cannot import xgboost: {exc}\n"
        "  macOS fix:  brew install libomp\n"
        "  Then re-run this script.\n"
    )

import numpy as np
import pandas as pd
from sklearn.metrics import classification_report, confusion_matrix
from sklearn.utils.class_weight import compute_sample_weight

# ── Paths ──────────────────────────────────────────────────────────────────────
ROOT       = Path(__file__).parent.parent
DATA_FILE  = ROOT / "data" / "training_data_combined.parquet"
MODEL_DIR  = Path(__file__).parent
MODEL_FILE = MODEL_DIR / "numiz_model_v1.json"
FEAT_FILE  = MODEL_DIR / "feature_columns.json"

# ── Feature & target definitions ──────────────────────────────────────────────
FEATURES = [
    "hour_of_day",          "is_weekend",           "is_peak_hour",
    "is_night_hour",        "hours_until_leave",    "soc_pct",
    "soc_deficit_to_target","soc_margin_above_floor","v2h_possible",
    "spot_price_sek",       "price_vs_daily_avg",   "price_vs_daily_min",
    "grid_tariff_sek",      "tariff_pressure",      "total_cost_per_kwh",
    "house_consumption_kw", "morning_window",       "min_soc_pct",
    "max_soc_pct",          "leave_time",           "return_time",
    "wake_time",            "sleep_time",           "scenario_type_encoded",
]
TARGET = "decision_label"
LABEL_NAMES = {0: "pause", 1: "charge", 2: "v2h", 3: "emergency_charge"}
N_CLASSES   = len(LABEL_NAMES)


# ── Safety layer ───────────────────────────────────────────────────────────────

def apply_safety_rules(predictions: np.ndarray, df: pd.DataFrame) -> np.ndarray:
    """
    Hard constraints that override ML predictions.
    These are non-negotiable — model cannot violate them.
    """
    corrected = predictions.copy()

    # CONSTRAINT 1: Morning guarantee
    # If within 3 hours of leave_time AND soc_deficit > 10% → force charge
    morning_critical = (
        (df["morning_window"] == 1) &
        (df["soc_deficit_to_target"] > 10)
    )
    corrected[morning_critical] = 1  # force charge

    # CONSTRAINT 2: SoC floor protection
    # Never allow V2H if soc_margin_above_floor < 7%
    v2h_unsafe = (
        (corrected == 2) &
        (df["soc_margin_above_floor"] < 7)
    )
    corrected[v2h_unsafe] = 0  # force pause instead

    # CONSTRAINT 3: Emergency charge override
    # If soc_pct < min_soc_pct → always charge regardless
    emergency = df["soc_pct"] < df["min_soc_pct"]
    corrected[emergency] = 3  # emergency_charge

    # Log how many corrections were made
    n_morning   = int(morning_critical.sum())
    n_floor     = int(v2h_unsafe.sum())
    n_emergency = int(emergency.sum())
    print(f"\n── Safety rule corrections ──────────────────────────────────")
    print(f"  Morning guarantee enforced : {n_morning} rows")
    print(f"  V2H blocked (floor risk)   : {n_floor} rows")
    print(f"  Emergency charge triggered : {n_emergency} rows")
    print(f"  Total corrections          : {n_morning + n_floor + n_emergency} rows")

    return corrected

# ══════════════════════════════════════════════════════════════════════════════
# STEP 1 — Load and prepare
# ══════════════════════════════════════════════════════════════════════════════

print("\n── STEP 1 · Load & prepare ─────────────────────────────────────────")

if not DATA_FILE.exists():
    sys.exit(f"[ERROR] {DATA_FILE} not found. Run extract_training_data.py first.")

df = pd.read_parquet(DATA_FILE)

# Cast bool → int so XGBoost gets clean numeric input
bool_cols = df[FEATURES].select_dtypes("bool").columns.tolist()
df[bool_cols] = df[bool_cols].astype("int8")

# Drop rows with NaN in any feature column
before = len(df)
df = df.dropna(subset=FEATURES + [TARGET])
dropped = before - len(df)
if dropped:
    print(f"Dropped {dropped:,} rows with NaN in features/target")

print(f"Rows after cleaning: {len(df):,}")

# ══════════════════════════════════════════════════════════════════════════════
# STEP 2 — Class imbalance
# ══════════════════════════════════════════════════════════════════════════════

print("\n── STEP 2 · Class distribution ─────────────────────────────────────")

label_counts = df[TARGET].value_counts().sort_index()
for lbl, cnt in label_counts.items():
    pct = cnt / len(df) * 100
    print(f"  {lbl}  {LABEL_NAMES.get(lbl, '?'):<20}  {cnt:>6,}  ({pct:.1f}%)")


# ══════════════════════════════════════════════════════════════════════════════
# STEP 3 — Time-based train / test split (NO random shuffle)
# ══════════════════════════════════════════════════════════════════════════════

print("\n── STEP 3 · Temporal train/test split ──────────────────────────────")

df = df.sort_values("logged_at").reset_index(drop=True)
split_idx = int(len(df) * 0.80)

train_df = df.iloc[:split_idx].copy()
test_df  = df.iloc[split_idx:].copy()

X_train, y_train = train_df[FEATURES].values, train_df[TARGET].values
X_test,  y_test  = test_df[FEATURES].values,  test_df[TARGET].values

sample_weights = compute_sample_weight(class_weight="balanced", y=y_train)

test_min = test_df["logged_at"].min()
test_max = test_df["logged_at"].max()

print(f"  Train size : {len(train_df):,}")
print(f"  Test size  : {len(test_df):,}")
print(f"  Test range : {test_min.date()} → {test_max.date()}")

# ══════════════════════════════════════════════════════════════════════════════
# STEP 4 — Train XGBoost
# ══════════════════════════════════════════════════════════════════════════════

print("\n── STEP 4 · Training XGBoost ────────────────────────────────────────")

# XGBoost 2.x removed use_label_encoder; objective='multi:softprob' is standard
model = xgb.XGBClassifier(
    n_estimators=300,
    max_depth=6,
    learning_rate=0.05,
    subsample=0.8,
    colsample_bytree=0.8,
    objective="multi:softprob",
    eval_metric="mlogloss",
    random_state=42,
    early_stopping_rounds=20,
)

model.fit(
    X_train, y_train,
    sample_weight=sample_weights,
    eval_set=[(X_test, y_test)],
    verbose=50,
)

best_round = model.best_iteration
print(f"\n  Best iteration: {best_round}  |  best mlogloss: {model.best_score:.4f}")

# ══════════════════════════════════════════════════════════════════════════════
# STEP 5 — Evaluate
# ══════════════════════════════════════════════════════════════════════════════

print("\n── STEP 5 · Evaluation ─────────────────────────────────────────────")

y_pred = model.predict(X_test)

# Helper: print classification report + confusion matrix for a prediction array
def _report(label: str, y_true: np.ndarray, y_hat: np.ndarray) -> None:
    present_labels = sorted(set(y_true) | set(y_hat))
    present_names  = [LABEL_NAMES[i] for i in present_labels]
    print(f"\n{label}")
    print(classification_report(
        y_true, y_hat,
        labels=present_labels,
        target_names=present_names,
        zero_division=0,
    ))
    print("Confusion Matrix (rows=actual, cols=predicted):")
    cm     = confusion_matrix(y_true, y_hat, labels=present_labels)
    header = "         " + "  ".join(f"{n:>8}" for n in present_names)
    print(header)
    for i, row in enumerate(cm):
        row_str = "  ".join(f"{v:>8}" for v in row)
        print(f"  {present_names[i]:<8}  {row_str}")

# ── Before safety corrections ────────────────────────────────────────────────
_report("Classification Report — RAW model output (before safety rules):", y_test, y_pred)

# ── Apply safety layer ───────────────────────────────────────────────────────
test_df = test_df.reset_index(drop=True)
y_pred_safe = apply_safety_rules(y_pred, test_df)

# ── After safety corrections ─────────────────────────────────────────────────
_report("Classification Report — AFTER safety rules:", y_test, y_pred_safe)

print("\nTop 10 Feature Importances (by weight):")
importances = model.get_booster().get_score(importance_type="weight")
# Map f0, f1, … back to column names
named = {FEATURES[int(k[1:])]: v for k, v in importances.items() if k[1:].isdigit()}
top10 = sorted(named.items(), key=lambda x: x[1], reverse=True)[:10]
for rank, (feat, score) in enumerate(top10, 1):
    print(f"  {rank:>2}. {feat:<30} {score:.0f}")

# ══════════════════════════════════════════════════════════════════════════════
# STEP 6 — Safety checks on test set
# ══════════════════════════════════════════════════════════════════════════════

print("\n── STEP 6 · Safety checks (post-correction predictions) ────────────")

# test_df already reset_index'd above; attach corrected predictions
test_df["predicted_decision"] = y_pred_safe

# Check 1 — V2H predicted below safety margin (soc_margin_above_floor < 5)
unsafe_v2h = test_df[
    (test_df["predicted_decision"] == 2) &
    (test_df["soc_margin_above_floor"] < 5)
]
print(f"V2H predicted below safety margin       : {len(unsafe_v2h):,} rows")

# Check 2 — V2H during morning window with low SoC
morning_v2h = test_df[
    (test_df["morning_window"] == 1) &
    (test_df["predicted_decision"] == 2) &
    (test_df["soc_deficit_to_target"] > 10)
]
print(f"V2H during morning window with low SoC  : {len(morning_v2h):,} rows")

# Check 3 — V2H rate comparison (raw vs safety-corrected vs rule engine)
rule_v2h_rate = (y_test == 2).mean() * 100
raw_v2h_rate  = (y_pred == 2).mean() * 100
safe_v2h_rate = (y_pred_safe == 2).mean() * 100
print(f"Rule engine V2H rate                    : {rule_v2h_rate:.1f}%")
print(f"ML model V2H rate (raw)                 : {raw_v2h_rate:.1f}%")
print(f"ML model V2H rate (after safety rules)  : {safe_v2h_rate:.1f}%")

# ══════════════════════════════════════════════════════════════════════════════
# STEP 7 — Save
# ══════════════════════════════════════════════════════════════════════════════

print("\n── STEP 7 · Save ───────────────────────────────────────────────────")

model.save_model(str(MODEL_FILE))
with open(FEAT_FILE, "w") as fh:
    json.dump(FEATURES, fh, indent=2)

print(f"  Model   → {MODEL_FILE}")
print(f"  Features→ {FEAT_FILE}")
print("Model saved.")
