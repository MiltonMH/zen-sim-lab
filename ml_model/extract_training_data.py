"""
Extract and engineer training data from Supabase simulation logs.

Actual table names (verified against live DB 2026-05-27):
  optimization_logs   ← spec calls it "simulation_logs"
  simulation_runs     ← spec calls it "simulations"  (mode col = optimization_mode)
  household_profiles  ← spec calls it "households"
  household_profiles has no has_solar_panels / routine_type → filled with 0 / "unknown"

Usage:
    python ml_model/extract_training_data.py

Output:
    data/training_data.parquet
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pandas as pd

from db import get_client

# ── Constants ──────────────────────────────────────────────────────────────────

DECISION_LABEL: dict[str, int] = {
    "pause": 0,
    "charge": 1,
    "v2h": 2,
    "emergency_charge": 3,
}
PEAK_HOURS  = {17, 18, 19, 20}
NIGHT_HOURS = {0, 1, 2, 3, 4, 5}
STOCKHOLM_TZ = "Europe/Stockholm"
PAGE_SIZE = 1000

SOC_VIOLATION_PENALTY = 10.0
MORNING_FAILURE_PENALTY = 20.0


# ── Supabase helpers ───────────────────────────────────────────────────────────

def fetch_all(client, table: str, columns: str) -> list[dict]:
    """Paginate through a Supabase table and return every row."""
    rows: list[dict] = []
    start = 0
    while True:
        batch = (
            client.table(table)
            .select(columns)
            .range(start, start + PAGE_SIZE - 1)
            .execute()
            .data or []
        )
        rows.extend(batch)
        if len(batch) < PAGE_SIZE:
            break
        start += PAGE_SIZE
    return rows


# ── Main ───────────────────────────────────────────────────────────────────────

def main() -> None:
    client = get_client()

    # ── Step 1: fetch optimization_logs ───────────────────────────────────────
    print("Fetching optimization_logs …")
    logs_cols = (
        "simulation_id, household_id, logged_at, decision, spot_price_sek, "
        "soc_pct, charge_kw, house_consumption_kw, grid_draw_kw, "
        "v2h_saving_sek, combined_score, grid_tariff_sek, total_cost_per_kwh, reason"
    )
    logs = fetch_all(client, "optimization_logs", logs_cols)
    print(f"  {len(logs):,} rows")
    if not logs:
        sys.exit("No log rows found – run some simulations first.")
    df = pd.DataFrame(logs)

    # ── Step 2: fetch simulation_runs (mode) ──────────────────────────────────
    print("Fetching simulation_runs …")
    runs = fetch_all(client, "simulation_runs", "id, optimization_mode")
    runs_df = pd.DataFrame(runs).rename(columns={"id": "simulation_id", "optimization_mode": "mode"})
    df = df.merge(runs_df, on="simulation_id", how="left")

    # ── Step 3: fetch household_profiles ──────────────────────────────────────
    print("Fetching household_profiles …")
    hh_cols = (
        "id, min_soc_pct, max_soc_pct, leave_time, return_time, "
        "wake_time, sleep_time, annual_kwh, daily_km"
    )
    hh_rows = fetch_all(client, "household_profiles", hh_cols)
    hh_df = pd.DataFrame(hh_rows).rename(columns={"id": "household_id"})

    # Columns the spec requests but don't exist in DB – fill with safe defaults
    if "has_solar_panels" not in hh_df.columns:
        hh_df["has_solar_panels"] = 0
    if "routine_type" not in hh_df.columns:
        hh_df["routine_type"] = "unknown"

    df = df.merge(hh_df, on="household_id", how="left")

    # ── Step 4: drop rows with null decision or soc_pct ───────────────────────
    before = len(df)
    df = df.dropna(subset=["decision", "soc_pct"])
    if len(df) < before:
        print(f"  Dropped {before - len(df):,} rows (null decision/soc_pct)")

    # ── Step 5: parse timestamps (Stockholm timezone) ─────────────────────────
    df["logged_at"] = pd.to_datetime(df["logged_at"], utc=True).dt.tz_convert(STOCKHOLM_TZ)

    # ── Step 6: feature engineering ───────────────────────────────────────────

    # Time features
    df["hour_of_day"]   = df["logged_at"].dt.hour.astype("int8")
    df["is_weekend"]    = (df["logged_at"].dt.dayofweek >= 5)
    df["is_peak_hour"]  = df["hour_of_day"].isin(PEAK_HOURS).astype("int8")
    df["is_night_hour"] = df["hour_of_day"].isin(NIGHT_HOURS).astype("int8")

    # Schedule-relative features (require household profile)
    df["leave_time"] = pd.to_numeric(df["leave_time"], errors="coerce").fillna(8)
    df["hours_until_leave"] = ((df["leave_time"] - df["hour_of_day"]) % 24).astype("int8")
    df["morning_window"]    = (df["hours_until_leave"] <= 3).astype("int8")

    # SoC features
    df["max_soc_pct"] = pd.to_numeric(df["max_soc_pct"], errors="coerce").fillna(80.0)
    df["min_soc_pct"] = pd.to_numeric(df["min_soc_pct"], errors="coerce").fillna(20.0)
    df["soc_deficit_to_target"]  = (df["max_soc_pct"] - df["soc_pct"]).clip(lower=0.0)
    df["soc_margin_above_floor"] = (df["soc_pct"]     - df["min_soc_pct"]).clip(lower=0.0)
    df["v2h_possible"]           = (df["soc_margin_above_floor"] > 5).astype("int8")

    # Quality / constraint flags
    df["soc_violation"]    = (df["soc_pct"] < df["min_soc_pct"]).astype("int8")
    df["morning_failure"]  = (
        (df["hour_of_day"] == df["leave_time"].astype("int8"))
        & (df["soc_pct"] < df["max_soc_pct"])
    ).astype("int8")

    # Price normalisation (per household per calendar date)
    df["_date"] = df["logged_at"].dt.date.astype(str)
    grp = df.groupby(["_date", "household_id"])["spot_price_sek"]
    daily_avg = grp.transform("mean").replace(0, float("nan"))
    daily_min = grp.transform("min").replace(0, float("nan"))
    df["price_vs_daily_avg"] = (df["spot_price_sek"] / daily_avg).round(4)
    df["price_vs_daily_min"] = (df["spot_price_sek"] / daily_min).round(4)
    df.drop(columns=["_date"], inplace=True)

    # Combined cost signal
    df["tariff_pressure"] = (df["grid_tariff_sek"] * df["spot_price_sek"]).round(6)

    # ── Step 7: target variables ───────────────────────────────────────────────

    # Classification label
    df["decision_label"] = df["decision"].map(DECISION_LABEL)
    unknown_mask = df["decision_label"].isna()
    if unknown_mask.any():
        unknowns = df.loc[unknown_mask, "decision"].unique().tolist()
        print(f"  Warning: {unknown_mask.sum():,} rows with unmapped decision: {unknowns}")
    df = df.dropna(subset=["decision_label"])
    df["decision_label"] = df["decision_label"].astype("int8")

    # Reward signal
    df["reward"] = (
        df["v2h_saving_sek"]
        - (df["grid_draw_kw"] * df["total_cost_per_kwh"] * df["is_peak_hour"])
        - SOC_VIOLATION_PENALTY  * df["soc_violation"]
        - MORNING_FAILURE_PENALTY * df["morning_failure"]
    ).round(6)

    # ── Step 8: final column order ─────────────────────────────────────────────
    ordered_cols = [
        # identifiers
        "simulation_id", "household_id", "mode",
        "logged_at",
        # raw log columns
        "spot_price_sek", "soc_pct", "charge_kw", "house_consumption_kw",
        "grid_draw_kw", "v2h_saving_sek", "combined_score",
        "grid_tariff_sek", "total_cost_per_kwh",
        # household profile
        "min_soc_pct", "max_soc_pct",
        "leave_time", "return_time", "wake_time", "sleep_time",
        "annual_kwh", "daily_km",
        "has_solar_panels", "routine_type",
        # engineered features
        "hour_of_day", "is_weekend",
        "is_peak_hour", "is_night_hour",
        "hours_until_leave", "morning_window",
        "soc_deficit_to_target", "soc_margin_above_floor",
        "v2h_possible",
        "price_vs_daily_avg", "price_vs_daily_min",
        "tariff_pressure",
        "soc_violation", "morning_failure",
        # metadata
        "reason",
        # targets
        "decision_label", "reward",
    ]
    df = df[[c for c in ordered_cols if c in df.columns]]

    # ── Step 9: save ───────────────────────────────────────────────────────────
    out_path = Path(__file__).parent.parent / "data" / "training_data.parquet"
    out_path.parent.mkdir(exist_ok=True)
    df.to_parquet(out_path, index=False)
    print(f"\nSaved → {out_path}  ({out_path.stat().st_size / 1024:.1f} KB)\n")

    # ── Step 10: summary (exact format) ───────────────────────────────────────
    label_name = {v: k for k, v in DECISION_LABEL.items()}
    n = len(df)

    print("=== TRAINING DATA SUMMARY ===")
    print(f"Total rows: {n:,}")
    print(f"Date range: {df['logged_at'].min().date()} to {df['logged_at'].max().date()}")
    print(f"Households: {df['household_id'].nunique()} unique")
    modes = df["mode"].dropna().unique().tolist() if "mode" in df.columns else []
    print(f"Modes: {modes}")
    print()

    print("Decision distribution:")
    for label_int, label_str in sorted(label_name.items()):
        count = (df["decision_label"] == label_int).sum()
        pct   = count / n * 100
        print(f"{label_str}: {count} ({pct:.1f}%)")
    print()

    soc_viol = df["soc_violation"].sum()
    morn_fail = df["morning_failure"].sum()
    v2h_hours = (df["decision_label"] == DECISION_LABEL["v2h"]).sum()
    connected = (df["decision_label"] != DECISION_LABEL["pause"]).sum()

    print("Quality checks:")
    print(f"SoC violations (< min_soc): {soc_viol} rows ({soc_viol / n * 100:.1f}%)")
    print(f"Morning failures (not full at leave_time): {morn_fail} rows ({morn_fail / n * 100:.1f}%)")
    denom = connected if connected > 0 else 1
    print(f"V2H hours: {v2h_hours} ({v2h_hours / denom * 100:.1f}% of connected hours)")
    print()

    r = df["reward"]
    print("Reward stats:")
    print(f"mean: {r.mean():.4f}  std: {r.std():.4f}  min: {r.min():.4f}  max: {r.max():.4f}")


if __name__ == "__main__":
    main()
