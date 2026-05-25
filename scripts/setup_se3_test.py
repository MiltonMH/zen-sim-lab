"""
Setup SE3 Kalkyl household and run simulations to compare with Slutkundskalkyl spreadsheet.

The spreadsheet (Slutkundskalkyl Zenion V2X) shows ~15 141 SEK/year savings for:
  - Household: SE3, Skaraborg, 20 000 kWh/year, Polestar 4 80 kWh
  - Grid: Ellevio, 83 SEK/kW peak tariff, 0.28/0.06 SEK/kWh energy tariffs
  - V2H: smart_v2x, min_soc=20 %, max_soc=80 %

NOTE: The live DB has a simplified household_profiles schema — several simulation
parameters (min_soc_pct, max_soc_pct, fuse_amps, annual_kwh) are not stored in the
database and will use the simulator's built-in defaults.  These defaults deviate from
the spreadsheet assumptions; the gaps are printed at the end.

Run from repo root:
    python scripts/setup_se3_test.py
"""

from __future__ import annotations

import sys
import os
import uuid
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from db import get_client
from engine.simulator import run_simulation
from config import DEFAULT_MIN_SOC, DEFAULT_MAX_SOC, DEFAULT_PEAK_TARIFF

# ── Constants ────────────────────────────────────────────────────────────────

ELLEVIO = "Ellevio"

# Ellevio SE3 tariff structure
# High tariff: weekdays Mon–Fri, 06:00–22:00, October–March
ELLEVIO_HIGH_TARIFF      = 0.2800   # SEK/kWh
ELLEVIO_LOW_TARIFF       = 0.0600   # SEK/kWh
ELLEVIO_PEAK_SEK_PER_KW  = 83.0    # SEK/kW/month
WINTER_PEAK_HOURS        = list(range(6, 22))   # hours 6–21 inclusive
WINTER_MONTH_FROM        = 10   # October
WINTER_MONTH_TO          = 3    # March (wraps year boundary)

# Household
HH_NAME      = "SE3 Skaraborg – Polestar 4 (Kalkyl)"
HH_AREA      = "SE3"
HH_BATTERY   = 80.0    # kWh
HH_DAILY_KM  = 50
HH_CAR_MODEL = "Polestar 4"

# Spreadsheet reference
SPREADSHEET_SAVINGS_SEK = 15_141.0


def main() -> None:
    db = get_client()

    print("=" * 65)
    print("  ZenOS – SE3 Kalkyl Setup & Simulation")
    print("=" * 65)

    # ── Step 1: Inspect DB ───────────────────────────────────────────────────
    print("\n📋 Step 1: Inspecting DB state")

    hh_sample = db.table("household_profiles").select("*").limit(1).execute().data
    hh_columns = set(hh_sample[0].keys()) if hh_sample else set()
    print(f"   household_profiles columns: {sorted(hh_columns)}")

    # Grid company settings
    gcs_rows = db.table("grid_company_settings").select("grid_company, peak_tariff_sek_per_kw").execute().data or []
    print(f"   Grid companies: {len(gcs_rows)}")
    for g in gcs_rows:
        print(f"      {g['grid_company']:20s}  peak: {g['peak_tariff_sek_per_kw']} SEK/kW")

    # Existing Ellevio tariffs
    ellevio_tariffs = db.table("grid_tariffs").select("id").eq("grid_company", ELLEVIO).execute().data or []
    print(f"   Ellevio grid_tariffs (current): {len(ellevio_tariffs)} rows")

    # ── Step 2: Update Ellevio peak tariff ───────────────────────────────────
    print(f"\n⚡ Step 2: Updating Ellevio peak tariff to {ELLEVIO_PEAK_SEK_PER_KW} SEK/kW")
    _gcs_rows = (
        db.table("grid_company_settings")
        .select("peak_tariff_sek_per_kw")
        .eq("grid_company", ELLEVIO)
        .limit(1)
        .execute()
        .data or []
    )
    existing_gcs = _gcs_rows[0] if _gcs_rows else None
    if existing_gcs:
        prev = existing_gcs["peak_tariff_sek_per_kw"]
        db.table("grid_company_settings").update({
            "peak_tariff_sek_per_kw": ELLEVIO_PEAK_SEK_PER_KW,
            "has_peak_tariff": True,
        }).eq("grid_company", ELLEVIO).execute()
        print(f"   ✅ Updated: {prev} → {ELLEVIO_PEAK_SEK_PER_KW} SEK/kW")
    else:
        db.table("grid_company_settings").insert({
            "grid_company":           ELLEVIO,
            "has_peak_tariff":        True,
            "peak_tariff_sek_per_kw": ELLEVIO_PEAK_SEK_PER_KW,
        }).execute()
        print(f"   ✅ Created Ellevio at {ELLEVIO_PEAK_SEK_PER_KW} SEK/kW")

    # ── Step 3: Re-insert Ellevio grid tariffs ───────────────────────────────
    print(f"\n📊 Step 3: Re-inserting Ellevio grid tariffs")
    print(f"   Winter peak (Oct–Mar, weekday 06:00–22:00): {ELLEVIO_HIGH_TARIFF} SEK/kWh")
    print(f"   All other hours:                            {ELLEVIO_LOW_TARIFF} SEK/kWh")

    db.table("grid_tariffs").delete().eq("grid_company", ELLEVIO).execute()
    print("   Deleted old Ellevio tariffs")

    tariff_rows: list[dict] = []
    for hour in range(24):
        # Weekday base (no month restriction)
        tariff_rows.append({
            "grid_company":   ELLEVIO,
            "hour_of_day":    hour,
            "is_weekend":     False,
            "tariff_sek_kwh": ELLEVIO_LOW_TARIFF,
            "valid_from":     "2020-01-01",
        })
        # Weekend base (no month restriction, always low)
        tariff_rows.append({
            "grid_company":   ELLEVIO,
            "hour_of_day":    hour,
            "is_weekend":     True,
            "tariff_sek_kwh": ELLEVIO_LOW_TARIFF,
            "valid_from":     "2020-01-01",
        })

    # Winter peak override (sorted first by lookup_tariff due to month-specificity sort)
    for hour in WINTER_PEAK_HOURS:
        tariff_rows.append({
            "grid_company":   ELLEVIO,
            "hour_of_day":    hour,
            "is_weekend":     False,
            "tariff_sek_kwh": ELLEVIO_HIGH_TARIFF,
            "month_from":     WINTER_MONTH_FROM,
            "month_to":       WINTER_MONTH_TO,
            "valid_from":     "2020-01-01",
        })

    db.table("grid_tariffs").insert(tariff_rows).execute()
    n_base = 48
    n_winter = len(WINTER_PEAK_HOURS)
    print(f"   ✅ Inserted {len(tariff_rows)} rows ({n_base} base + {n_winter} winter peak)")

    # ── Step 4: Create SE3 household ─────────────────────────────────────────
    print(f"\n🏠 Step 4: Ensuring SE3 Skaraborg household exists")
    _hh_rows = (
        db.table("household_profiles")
        .select("id")
        .eq("name", HH_NAME)
        .limit(1)
        .execute()
        .data or []
    )
    existing_hh = _hh_rows[0] if _hh_rows else None

    household_id: str
    if existing_hh:
        household_id = existing_hh["id"]
        db.table("household_profiles").update({
            "price_area":    HH_AREA,
            "battery_kwh":   HH_BATTERY,
            "daily_km":      HH_DAILY_KM,
            "grid_company":  ELLEVIO,
            "car_model":     HH_CAR_MODEL,
            "house_type":    "villa",
        }).eq("id", household_id).execute()
        print(f"   ✓ Updated existing: id={household_id}")
    else:
        household_id = str(uuid.uuid4())
        db.table("household_profiles").insert({
            "id":           household_id,
            "name":         HH_NAME,
            "price_area":   HH_AREA,
            "battery_kwh":  HH_BATTERY,
            "daily_km":     HH_DAILY_KM,
            "grid_company": ELLEVIO,
            "car_model":    HH_CAR_MODEL,
            "house_type":   "villa",
            "created_at":   datetime.now(timezone.utc).isoformat(),
        }).execute()
        print(f"   ✅ Created: id={household_id}")

    # Print parameter gaps upfront
    print(f"\n  ⚠  Parameter gap (DB schema vs spreadsheet):")
    print(f"     battery_kwh   : {HH_BATTERY} kWh  ✓  (in DB)")
    print(f"     daily_km      : {HH_DAILY_KM} km   ✓  (in DB)")
    print(f"     price_area    : {HH_AREA}          ✓  (in DB)")
    print(f"     grid_company  : {ELLEVIO}     ✓  (in DB)")
    print(f"     annual_kwh    : DB missing   → simulator default 18 000 (spreadsheet: 20 000)")
    print(f"     min_soc_pct   : DB missing   → simulator default {DEFAULT_MIN_SOC:.0f}%   (spreadsheet: 20%)")
    print(f"     max_soc_pct   : DB missing   → simulator default {DEFAULT_MAX_SOC:.0f}%   (spreadsheet: 80%) ✓")
    print(f"     fuse_amps     : DB missing   → simulator default 20A    (spreadsheet: 32A)")

    # ── Step 5: Run simulations ───────────────────────────────────────────────
    results: dict[str, dict] = {}
    for year in ("2024", "2025"):
        period_from = f"{year}-01-01"
        period_to   = f"{year}-12-31"
        sim_id      = str(uuid.uuid4())

        print(f"\n🔄 Step 5: Running smart_v2x for {year}  ({period_from} → {period_to})")
        db.table("simulation_runs").insert({
            "id":                sim_id,
            "household_id":      household_id,
            "period_from":       period_from,
            "period_to":         period_to,
            "optimization_mode": "smart_v2x",
            "status":            "pending",
            "scenario_number":   1,
            "created_at":        datetime.now(timezone.utc).isoformat(),
        }).execute()

        result = run_simulation(sim_id)
        results[year] = result
        print(f"   ✅ {year}: {result['days_processed']} days  •  sim_id={sim_id}")

    # ── Step 6: Comparison table ──────────────────────────────────────────────
    r24 = results["2024"]
    r25 = results["2025"]

    def _fmt(v) -> str:
        if isinstance(v, (int, float)):
            return f"{v:>9,.0f} SEK"
        return f"{str(v):>13s}"

    def _fkwh(v: float) -> str:
        return f"{v:>8,.0f} kWh"

    print("\n" + "=" * 65)
    print("  COMPARISON: Slutkundskalkyl vs Simulation")
    print("=" * 65)
    print(f"  {'Metric':<32s}  {'Spreadsheet':>13s}  {'Sim 2024':>13s}  {'Sim 2025':>13s}")
    print("  " + "-" * 61)

    def row(label: str, sheet: str, v24: float, v25: float) -> None:
        print(f"  {label:<32s}  {sheet:>13s}  {_fmt(v24):>13s}  {_fmt(v25):>13s}")

    row("Total savings",
        f"{SPREADSHEET_SAVINGS_SEK:,.0f} SEK",
        r24["total_saved_sek"],
        r25["total_saved_sek"])
    row("  – V2H energy savings",
        "?",
        r24["total_v2h_saving_sek"],
        r25["total_v2h_saving_sek"])
    row("  – Price/schedule savings",
        "?",
        r24["price_savings_sek"],
        r25["price_savings_sek"])
    row("  – Peak demand savings",
        "?",
        r24["peak_demand_saving_sek"],
        r25["peak_demand_saving_sek"])

    print(f"  {'V2H kWh discharged':<32s}  {'~14 400 kWh':>13s}  {_fkwh(r24['total_v2h_kwh']):>13s}  {_fkwh(r25['total_v2h_kwh']):>13s}")

    gap_24 = SPREADSHEET_SAVINGS_SEK - r24["total_saved_sek"]
    gap_25 = SPREADSHEET_SAVINGS_SEK - r25["total_saved_sek"]
    print(f"\n  Gap (spreadsheet − sim 2024): {gap_24:+,.0f} SEK")
    print(f"  Gap (spreadsheet − sim 2025): {gap_25:+,.0f} SEK")

    print("\n  Why the simulation is lower than the spreadsheet:")
    print("  1. V2H capped to house load — not full battery dump per day")
    print(f"     Avg house load ~{18000/8760:.1f} kW (18 000 kWh default) → 2–4 kW during peak hours")
    print(f"     Spreadsheet assumes ~40 kWh/day × 360 days = 14 400 kWh V2H")
    print(f"  2. min_soc_pct default={DEFAULT_MIN_SOC:.0f}% (V2H floor at {DEFAULT_MIN_SOC/100*HH_BATTERY:.0f} kWh)")
    print(f"     Spreadsheet uses 20% (floor at 16 kWh) → 50% more V2H headroom")
    print(f"  3. Car away 07:00–17:00 → misses daytime expensive hours")
    print(f"  4. DC round-trip efficiency: 0.95² ≈ 0.90 (reduces effective savings)")
    print(f"  5. Spreadsheet uses simplified daily savings × 365 formula")
    print(f"     (no SoC tracking, no car-away modelling, no battery cycling limits)")

    # Estimate potential uplift if min_soc were 20%
    usable_default = HH_BATTERY * (DEFAULT_MAX_SOC - DEFAULT_MIN_SOC) / 100
    usable_ideal   = HH_BATTERY * (80.0 - 20.0) / 100
    uplift_factor  = usable_ideal / usable_default if usable_default > 0 else 1.0
    print(f"\n  If min_soc_pct=20% were supported in DB:")
    print(f"     Usable V2H: {usable_default:.0f} kWh → {usable_ideal:.0f} kWh (×{uplift_factor:.2f})")
    est_24 = r24["total_saved_sek"] * uplift_factor
    est_25 = r25["total_saved_sek"] * uplift_factor
    print(f"     Estimated savings 2024: ~{est_24:,.0f} SEK  (still w/ car-away & efficiency losses)")
    print(f"     Estimated savings 2025: ~{est_25:,.0f} SEK")

    print(f"\n  Household id : {household_id}")
    print(f"  Car model    : {HH_CAR_MODEL} (no ev_models table in DB; uses ARC defaults)")
    print("=" * 65)


if __name__ == "__main__":
    main()
