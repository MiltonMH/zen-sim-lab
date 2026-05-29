"""
Extract training data from legacy CSV dump files (optimization_logs__chunk*.csv)
and combine with any existing data/training_data.parquet.

Expected chunk locations (searched in order):
  1. /mnt/project/optimization_logs__chunk*.csv   (cloud / mounted volume)
  2. data/optimization_logs__chunk*.csv            (local project data/)
  3. optimization_logs__chunk*.csv                 (project root fallback)

Usage:
    python ml_model/extract_legacy_training_data.py

Output:
    data/training_data_combined.parquet
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

import glob

import pandas as pd

from db import get_client

# ── Constants (must match extract_training_data.py exactly) ───────────────────

DECISION_LABEL: dict[str, int] = {
    "pause": 0,
    "charge": 1,
    "v2h": 2,
    "emergency_charge": 3,
}
PEAK_HOURS  = {17, 18, 19, 20}
NIGHT_HOURS = {0, 1, 2, 3, 4, 5}
STOCKHOLM_TZ = "Europe/Stockholm"
PAGE_SIZE    = 1000

SOC_VIOLATION_PENALTY  = 10.0
MORNING_FAILURE_PENALTY = 20.0

HH_DEFAULTS = dict(
    min_soc_pct=40.0,
    max_soc_pct=80.0,
    leave_time=7,
    return_time=17,
    wake_time=6,
    sleep_time=23,
    battery_kwh=75.0,
    fuse_amps=20,
    annual_kwh=18000,
    daily_km=40,
)

SCENARIO_LABEL: dict[str, int] = {
    "normal":    0,
    "wfh":       1,
    "sick":      2,
    "oversleep": 3,
    "overtime":  4,
    "day_off":   5,
    "long_sick": 6,
}

CHUNK_PATTERNS = [
    "/mnt/project/optimization_logs__chunk*.csv",
    str(ROOT / "data" / "optimization_logs__chunk*.csv"),
    str(ROOT / "optimization_logs__chunk*.csv"),
]

FULL_FILE = ROOT / "data" / "optimization_logs_full.csv"

EXISTING_PARQUET = ROOT / "data" / "training_data.parquet"
OUT_PARQUET      = ROOT / "data" / "training_data_combined.parquet"


# ── Supabase helper ────────────────────────────────────────────────────────────

def fetch_all(client, table: str, columns: str) -> list[dict]:
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


# ── Feature engineering (mirrors extract_training_data.py exactly) ─────────────

def _encode_scenario(val) -> int:
    """Map scenario_type string → int.
    None / NaN (legacy CSV rows without scenario data) → 0 (normal).
    Unknown strings → -1.
    """
    import pandas as _pd
    if val is None or (_pd.api.types.is_float(val) and _pd.isna(val)):
        return 0
    return SCENARIO_LABEL.get(str(val), -1)


def engineer_features(df: pd.DataFrame) -> pd.DataFrame:
    """Add all derived feature columns in-place. Returns df."""

    # Time features
    df["hour_of_day"]   = df["logged_at"].dt.hour.astype("int8")
    df["is_weekend"]    = df["logged_at"].dt.dayofweek >= 5
    df["is_peak_hour"]  = df["hour_of_day"].isin(PEAK_HOURS).astype("int8")
    df["is_night_hour"] = df["hour_of_day"].isin(NIGHT_HOURS).astype("int8")

    # Schedule-relative
    df["leave_time"]         = pd.to_numeric(df["leave_time"], errors="coerce").fillna(7)
    df["hours_until_leave"]  = ((df["leave_time"] - df["hour_of_day"]) % 24).astype("int8")
    df["morning_window"]     = (df["hours_until_leave"] <= 3).astype("int8")

    # SoC features
    df["max_soc_pct"] = pd.to_numeric(df["max_soc_pct"], errors="coerce").fillna(80.0)
    df["min_soc_pct"] = pd.to_numeric(df["min_soc_pct"], errors="coerce").fillna(40.0)
    df["soc_deficit_to_target"]  = (df["max_soc_pct"] - df["soc_pct"]).clip(lower=0.0)
    df["soc_margin_above_floor"] = (df["soc_pct"] - df["min_soc_pct"]).clip(lower=0.0)
    df["v2h_possible"]           = (df["soc_margin_above_floor"] > 5).astype("int8")

    # Constraint flags
    df["soc_violation"]   = (df["soc_pct"] < df["min_soc_pct"]).astype("int8")
    df["morning_failure"] = (
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

    # Scenario type encoding
    # Legacy CSV rows have no scenario_type → NaN → encoded as 0 (normal)
    # Unknown strings → -1
    if "scenario_type" in df.columns:
        df["scenario_type_encoded"] = df["scenario_type"].map(_encode_scenario).astype("int8")
    else:
        df["scenario_type_encoded"] = pd.Series(0, index=df.index, dtype="int8")

    return df


def build_targets(df: pd.DataFrame) -> pd.DataFrame:
    """Add decision_label and reward columns. Returns df."""
    df["decision_label"] = df["decision"].map(DECISION_LABEL)
    unknown = df["decision_label"].isna()
    if unknown.any():
        vals = df.loc[unknown, "decision"].unique().tolist()
        print(f"  Warning: {unknown.sum():,} rows with unmapped decision values: {vals}")
    df = df.dropna(subset=["decision_label"])
    df["decision_label"] = df["decision_label"].astype("int8")

    df["reward"] = (
        df["v2h_saving_sek"]
        - (df["grid_draw_kw"] * df["total_cost_per_kwh"] * df["is_peak_hour"])
        - SOC_VIOLATION_PENALTY   * df["soc_violation"]
        - MORNING_FAILURE_PENALTY * df["morning_failure"]
    ).round(6)

    return df


# ══════════════════════════════════════════════════════════════════════════════
# STEP 1 — Load all chunk CSV files
# ══════════════════════════════════════════════════════════════════════════════

print("\n── STEP 1 · Find and load CSV chunks ────────────────────────────────")

chunk_files: list[str] = []
for pattern in CHUNK_PATTERNS:
    found = sorted(glob.glob(pattern))
    if found:
        print(f"  Found {len(found)} file(s) matching: {pattern}")
        chunk_files.extend(found)
        break   # use first location that has files

dfs: list[pd.DataFrame] = []

if chunk_files:
    for path in chunk_files:
        chunk = pd.read_csv(path, low_memory=False)
        print(f"  {Path(path).name}: {len(chunk):,} rows")
        dfs.append(chunk)
elif FULL_FILE.exists():
    full = pd.read_csv(FULL_FILE, low_memory=False, on_bad_lines="skip")
    print(f"Found combined file: data/optimization_logs_full.csv — {len(full):,} rows")
    dfs.append(full)
else:
    sys.exit(
        "No source files found. Expected one of:\n"
        + "\n".join(f"  {p}" for p in CHUNK_PATTERNS)
        + f"\n  {FULL_FILE}"
        + "\n\nPlace chunk or full CSV files in data/ and re-run."
    )

df = pd.concat(dfs, ignore_index=True)
print(f"Total rows loaded: {len(df):,}")

# ══════════════════════════════════════════════════════════════════════════════
# STEP 2 — Fetch household_profiles and join
# ══════════════════════════════════════════════════════════════════════════════

print("\n── STEP 2 · Fetch household_profiles from Supabase ─────────────────")

client = get_client()
hh_cols = (
    "id, min_soc_pct, max_soc_pct, leave_time, return_time, "
    "wake_time, sleep_time, battery_kwh, fuse_amps, annual_kwh, daily_km"
)
hh_rows = fetch_all(client, "household_profiles", hh_cols)
hh_df   = pd.DataFrame(hh_rows).rename(columns={"id": "household_id"})
print(f"  {len(hh_df):,} household profiles fetched")

df = df.merge(hh_df, on="household_id", how="left", suffixes=("", "_hh"))

# Fill missing profiles with defaults
for col, default in HH_DEFAULTS.items():
    if col in df.columns:
        df[col] = df[col].fillna(default)
    else:
        df[col] = default

missing_hh = df[hh_df.columns.difference(["household_id"])].isna().all(axis=1).sum()
if missing_hh:
    n_unknown = df.loc[~df["household_id"].isin(hh_df["household_id"])]["household_id"].nunique()
    print(f"  {n_unknown} household_id(s) not in profiles — defaults applied")

# ══════════════════════════════════════════════════════════════════════════════
# STEP 2b — Fetch new simulation data from Supabase
# ══════════════════════════════════════════════════════════════════════════════

print("\n── STEP 2b · Fetch simulation logs from Supabase ────────────────────")

LOG_COLS = (
    "logged_at, decision, spot_price_sek, soc_pct, "
    "charge_kw, house_consumption_kw, grid_draw_kw, "
    "v2h_saving_sek, combined_score, grid_tariff_sek, "
    "energy_tax_sek, total_cost_per_kwh, reason, "
    "household_id, scenario_type, simulation_id"
)

supa_rows: list[dict] = []
page = 0

while True:
    start = page * PAGE_SIZE
    end   = start + PAGE_SIZE - 1
    batch = (
        client.table("optimization_logs")
        .select(LOG_COLS)
        .range(start, end)
        .execute()
        .data or []
    )
    supa_rows.extend(batch)
    # Print progress every 50,000 rows
    prev = len(supa_rows) - len(batch)
    if len(supa_rows) // 50_000 > prev // 50_000:
        print(f"  ... {len(supa_rows):,} rows fetched")
    if len(batch) < PAGE_SIZE:
        break
    page += 1

print(f"  Total rows fetched from Supabase: {len(supa_rows):,}")

# Join simulation_runs to get optimization_mode → mode
runs = fetch_all(client, "simulation_runs", "id, optimization_mode")
runs_df = pd.DataFrame(runs).rename(columns={"id": "simulation_id", "optimization_mode": "mode"})
print(f"  simulation_runs fetched: {len(runs_df):,} rows")

if supa_rows:
    df_supa = pd.DataFrame(supa_rows)
    # Join simulation_runs → mode
    df_supa = df_supa.merge(runs_df, on="simulation_id", how="left")
    # Join household_profiles (already fetched in STEP 2)
    df_supa = df_supa.merge(hh_df, on="household_id", how="left", suffixes=("", "_hh"))
    for col, default in HH_DEFAULTS.items():
        if col in df_supa.columns:
            df_supa[col] = df_supa[col].fillna(default)
        else:
            df_supa[col] = default
    print(f"  Supabase rows : {len(df_supa):,}  ({df_supa['household_id'].nunique()} households)")
    print(f"  CSV rows      : {len(df):,}")

    # Combine CSV + Supabase; deduplicate on (household_id, logged_at), Supabase wins on tie
    df = pd.concat([df, df_supa], ignore_index=True)
    before_dedup = len(df)
    df["_ts_sort"] = pd.to_datetime(df["logged_at"], utc=True)
    df = (
        df
        .sort_values("_ts_sort")
        .drop_duplicates(subset=["household_id", "logged_at"], keep="last")
        .drop(columns=["_ts_sort"])
        .reset_index(drop=True)
    )
    dupes = before_dedup - len(df)
    if dupes:
        print(f"  Removed {dupes:,} duplicate rows (same household_id + logged_at)")
    print(f"  Combined total: {len(df):,} rows")
else:
    print("  No simulation data found in Supabase — proceeding with CSV data only")

# ── Mode filter ───────────────────────────────────────────────────────────────
# Keep only smart_v2x mode rows from Supabase data.
# CSV legacy rows have no mode column → NaN → always kept.

if "mode" in df.columns:
    mode_counts = df["mode"].value_counts(dropna=False)
    print("\n  Mode distribution before filter:")
    for mode_val, cnt in mode_counts.items():
        label = str(mode_val) if mode_val is not None and mode_val == mode_val else "null/legacy"
        print(f"    {label:<25}  {cnt:>8,}")

    before_mode = len(df)
    df = df[df["mode"].isna() | (df["mode"] == "smart_v2x")].reset_index(drop=True)
    print(f"  Rows after v2x filter: {len(df):,}  (removed {before_mode - len(df):,} non-v2x rows)")
else:
    print("\n  No mode column present — all rows kept (CSV-only run)")

# ══════════════════════════════════════════════════════════════════════════════
# STEP 3 — Filter out cable_disconnected rows
# ══════════════════════════════════════════════════════════════════════════════

print("\n── STEP 3 · Filter cable_disconnected rows ──────────────────────────")

before = len(df)
df = df[df["reason"] != "cable_disconnected"].reset_index(drop=True)
print(f"Rows after removing disconnected: {len(df):,}  (removed {before - len(df):,})")

# Also drop rows with null decision or soc_pct
before = len(df)
df = df.dropna(subset=["decision", "soc_pct"])
if len(df) < before:
    print(f"Dropped {before - len(df):,} rows with null decision/soc_pct")

# ══════════════════════════════════════════════════════════════════════════════
# STEP 4 — Engineer features
# ══════════════════════════════════════════════════════════════════════════════

print("\n── STEP 4 · Feature engineering ────────────────────────────────────")

df["logged_at"] = pd.to_datetime(df["logged_at"], utc=True).dt.tz_convert(STOCKHOLM_TZ)

# Cast bool-like columns from CSV (may arrive as object)
for col in ["is_weekend"]:
    if col in df.columns:
        df[col] = df[col].astype(bool)

df = engineer_features(df)
print(f"  Features engineered on {len(df):,} rows")

# ══════════════════════════════════════════════════════════════════════════════
# STEP 5 — Target + reward
# ══════════════════════════════════════════════════════════════════════════════

print("\n── STEP 5 · Target variable + reward ────────────────────────────────")

df = build_targets(df)
print(f"  Targets built — {len(df):,} rows remain after label mapping")

# ══════════════════════════════════════════════════════════════════════════════
# STEP 6 — Combine with existing training_data.parquet
# ══════════════════════════════════════════════════════════════════════════════

print("\n── STEP 6 · Combine with existing parquet ───────────────────────────")

if EXISTING_PARQUET.exists():
    existing = pd.read_parquet(EXISTING_PARQUET)
    print(f"  Existing parquet: {len(existing):,} rows")

    combined = pd.concat([existing, df], ignore_index=True)

    # Deduplicate on (household_id, logged_at) — keep last (legacy data wins on tie)
    before_dedup = len(combined)
    combined["_ts_sort"] = pd.to_datetime(combined["logged_at"], utc=True)
    combined = (
        combined
        .sort_values("_ts_sort")
        .drop_duplicates(subset=["household_id", "logged_at"], keep="last")
        .drop(columns=["_ts_sort"])
        .reset_index(drop=True)
    )
    dupes = before_dedup - len(combined)
    if dupes:
        print(f"  Removed {dupes:,} duplicate rows (same household_id + logged_at)")
    print(f"  Combined total   : {len(combined):,} rows")
else:
    print(f"  No existing parquet found at {EXISTING_PARQUET} — using legacy data only")
    combined = df

OUT_PARQUET.parent.mkdir(exist_ok=True)
combined.to_parquet(OUT_PARQUET, index=False)
print(f"\nSaved → {OUT_PARQUET}  ({OUT_PARQUET.stat().st_size / 1024:.1f} KB)")

# ══════════════════════════════════════════════════════════════════════════════
# STEP 7 — Summary
# ══════════════════════════════════════════════════════════════════════════════

label_name = {v: k for k, v in DECISION_LABEL.items()}
n = len(combined)

print("\n=== COMBINED DATASET SUMMARY ===")
print(f"Total rows: {n:,}")
print(f"Date range: {combined['logged_at'].min().date()} to {combined['logged_at'].max().date()}")
print(f"Households: {combined['household_id'].nunique()} unique")

print("\nDecision distribution:")
for label_int, label_str in sorted(label_name.items()):
    count = (combined["decision_label"] == label_int).sum()
    pct   = count / n * 100 if n else 0
    print(f"  {label_str:<20} {count:>8,}  ({pct:.1f}%)")

soc_viol  = combined["soc_violation"].sum()
morn_fail = combined["morning_failure"].sum()
v2h_hours = (combined["decision_label"] == DECISION_LABEL["v2h"]).sum()
connected = (combined["decision_label"] != DECISION_LABEL["pause"]).sum()

print("\nQuality checks:")
print(f"  SoC violations (< min_soc)            : {soc_viol:,} rows ({soc_viol / n * 100:.1f}%)")
print(f"  Morning failures (not full at leave)   : {morn_fail:,} rows ({morn_fail / n * 100:.1f}%)")
denom = connected if connected else 1
print(f"  V2H hours                              : {v2h_hours:,} ({v2h_hours / denom * 100:.1f}% of connected hours)")

if "reward" in combined.columns:
    r = combined["reward"]
    print(f"\nReward stats:")
    print(f"  mean={r.mean():.4f}  std={r.std():.4f}  min={r.min():.4f}  max={r.max():.4f}")
