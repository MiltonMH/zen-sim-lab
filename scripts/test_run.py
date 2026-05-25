"""Dry-run connectivity and planner test — no writes to the database.

Usage:
    python scripts/test_run.py

Verifies:
  - Supabase credentials work
  - spot_prices, grid_tariffs, household_profiles are reachable
  - plan_day() produces sensible output for a real day's prices
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from zoneinfo import ZoneInfo

from config import DEFAULT_WEIGHTS, ENERGY_TAX_SEK, VAT_MULTIPLIER
from db import get_client
from engine.planner import plan_day
from schemas.grid_tariff import GridTariff, lookup_tariff
from schemas.household import EVModel, HouseholdProfile
from schemas.spot_price import DayHour, SpotPrice

_STOCKHOLM = ZoneInfo("Europe/Stockholm")

FROM_DATE = "2025-01-01"
TO_DATE   = "2025-01-07"
TARGET_DAY = "2025-01-02"   # the day we'll run plan_day() on


def main() -> None:
    print("─" * 60)
    print("ZenOS dry-run test")
    print(f"Period: {FROM_DATE} → {TO_DATE}  (plan day: {TARGET_DAY})")
    print("─" * 60)

    db = get_client()

    # ── 1. Household ─────────────────────────────────────────────────────────
    hh_rows = db.table("household_profiles").select("*").limit(1).execute().data
    if not hh_rows:
        sys.exit("ERROR: no rows in household_profiles")
    hh = HouseholdProfile.from_row(hh_rows[0])

    print(f"\nHousehold:   {hh.name}")
    print(f"price_area:  {hh.price_area}")
    print(f"battery_kwh: {hh.battery_kwh}")
    print(f"fuse_amps:   {hh.fuse_amps}  (fuse_max_kw = {hh.fuse_max_kw:.1f} kW)")
    print(f"daily_km:    {hh.daily_km}")
    print(f"soc range:   {hh.min_soc_pct}% – {hh.max_soc_pct}%")
    print(f"schedule:    wake={hh.wake_time}h  leave={hh.leave_time}h  "
          f"return={hh.return_time}h  sleep={hh.sleep_time}h")
    print(f"grid_company:{hh.grid_company or '(none)'}")
    print(f"ev_model_id: {hh.ev_model_id or '(none)'}")

    # ── 2. EV model ──────────────────────────────────────────────────────────
    ev = EVModel(
        id=hh.ev_model_id or "",
        brand="", model="",
        battery_kwh=hh.battery_kwh or 60.0,
        max_dc_charge_kw=11.0,
        max_v2x_discharge_kw=11.0,
        ccs2_port=True,
    )
    if hh.ev_model_id:
        ev_row = (
            db.table("ev_models")
            .select("brand, model, battery_kwh, max_dc_charge_kw, max_v2x_discharge_kw, ccs2_port")
            .eq("id", hh.ev_model_id)
            .maybe_single()
            .execute()
            .data
        )
        if ev_row:
            ev = EVModel(
                id=hh.ev_model_id,
                brand=ev_row.get("brand", ""),
                model=ev_row.get("model", ""),
                battery_kwh=float(ev_row.get("battery_kwh") or hh.battery_kwh or 60.0),
                max_dc_charge_kw=float(ev_row.get("max_dc_charge_kw") or 11.0),
                max_v2x_discharge_kw=float(ev_row.get("max_v2x_discharge_kw") or 11.0),
                ccs2_port=ev_row.get("ccs2_port") is not False,
            )
            print(f"\nEV model:    {ev.brand} {ev.model}")
            print(f"battery_kwh: {ev.battery_kwh}  max_dc={ev.max_dc_charge_kw} kW  "
                  f"ccs2={ev.ccs2_port}")
        else:
            print(f"\nEV model:    (row not found for id {hh.ev_model_id})")
    else:
        print("\nEV model:    (none — using defaults)")

    # ── 3. Spot prices ───────────────────────────────────────────────────────
    from_iso = f"{FROM_DATE}T00:00:00+00:00"
    to_iso   = f"{TO_DATE}T23:59:59+00:00"

    price_rows = (
        db.table("spot_prices")
        .select("hour, price_sek_kwh, price_area")
        .eq("price_area", hh.price_area or "SE3")
        .gte("hour", from_iso)
        .lte("hour", to_iso)
        .order("hour")
        .execute()
        .data or []
    )

    # SE3 fallback
    used_area = hh.price_area or "SE3"
    if not price_rows and hh.price_area and hh.price_area != "SE3":
        price_rows = (
            db.table("spot_prices")
            .select("hour, price_sek_kwh, price_area")
            .eq("price_area", "SE3")
            .gte("hour", from_iso)
            .lte("hour", to_iso)
            .order("hour")
            .execute()
            .data or []
        )
        used_area = "SE3 (fallback)"

    prices = [SpotPrice.from_row(r) for r in price_rows]
    print(f"\nSpot prices: {len(prices)} rows  (area: {used_area})")
    if prices:
        p_vals = [p.price_sek_kwh for p in prices]
        print(f"  min={min(p_vals):.4f}  max={max(p_vals):.4f}  "
              f"avg={sum(p_vals)/len(p_vals):.4f}  SEK/kWh")

    if not prices:
        sys.exit(f"ERROR: no spot prices found for {used_area} in {FROM_DATE}–{TO_DATE}")

    # ── 4. Grid tariffs ──────────────────────────────────────────────────────
    tariffs: list[GridTariff] = []
    if hh.grid_company:
        t_rows = (
            db.table("grid_tariffs")
            .select("grid_company, hour_of_day, is_weekend, tariff_sek_kwh, month_from, month_to")
            .eq("grid_company", hh.grid_company)
            .execute()
            .data or []
        )
        tariffs = [GridTariff.from_row(r) for r in t_rows]

    print(f"\nGrid tariffs: {len(tariffs)} rows  "
          f"({'grid_company=' + hh.grid_company if hh.grid_company else 'no grid_company — default 0.30 SEK/kWh used'})")
    if tariffs:
        t_vals = [t.tariff_sek_kwh for t in tariffs]
        print(f"  min={min(t_vals):.4f}  max={max(t_vals):.4f}  SEK/kWh")

    # ── 5. Consumption weights ───────────────────────────────────────────────
    weights = list(DEFAULT_WEIGHTS)
    cp_rows = (
        db.table("consumption_profiles")
        .select("hour, weight")
        .eq("household_id", hh.id)
        .execute()
        .data or []
    )
    if cp_rows:
        for r in cp_rows:
            h_idx = int(r["hour"])
            if 0 <= h_idx < 24:
                weights[h_idx] = float(r["weight"])
        print(f"\nConsumption profile: {len(cp_rows)} custom rows loaded")
    else:
        print("\nConsumption profile: none found — using DEFAULT_WEIGHTS")
    sum_weights = sum(weights)

    # ── 6. Build DayHour list for TARGET_DAY ─────────────────────────────────
    day_hours: list[DayHour] = []
    for sp in prices:
        dt_sthlm = sp.hour.astimezone(_STOCKHOLM)
        if dt_sthlm.strftime("%Y-%m-%d") != TARGET_DAY:
            continue
        hod = dt_sthlm.hour
        tariff = lookup_tariff(tariffs, sp.hour.isoformat(), hod)
        total_cost = (sp.price_sek_kwh + tariff + ENERGY_TAX_SEK) * VAT_MULTIPLIER
        day_hours.append(DayHour(
            iso=sp.hour.isoformat(),
            hour_of_day=hod,
            price=sp.price_sek_kwh,
            weight=weights[hod],
            grid_tariff=tariff,
            total_cost=total_cost,
            combined_score=0.0,  # not needed for planner test
        ))

    # Sort by hour (just in case)
    day_hours.sort(key=lambda h: h.hour_of_day)

    print(f"\nDay {TARGET_DAY}: {len(day_hours)} hours loaded")
    if not day_hours:
        sys.exit(f"ERROR: no spot prices found for {TARGET_DAY}")

    tc_vals = [h.total_cost for h in day_hours]
    p_vals_day = [h.price for h in day_hours]
    print(f"  spot:       min={min(p_vals_day):.4f}  max={max(p_vals_day):.4f}  SEK/kWh")
    print(f"  total_cost: min={min(tc_vals):.4f}  max={max(tc_vals):.4f}  SEK/kWh (incl tariff+tax+VAT)")

    # ── 7. Run plan_day() ─────────────────────────────────────────────────────
    daily_kwh_needed = ((hh.daily_km or 30) / 5) * (hh.battery_kwh or 60.0) / 100
    plan = plan_day(day_hours, hh, ev, soc=50.0, mode="smart_v2x", daily_kwh_needed=daily_kwh_needed)

    print(f"\n{'─'*60}")
    print(f"plan_day() result for {TARGET_DAY} (mode=smart_v2x, soc=50%)")
    print(f"{'─'*60}")
    print(f"  locked_charge_isos : {len(plan.locked_charge_isos)} hours")
    if plan.locked_charge_isos:
        locked_hours = sorted(
            h.hour_of_day for h in day_hours if h.iso in plan.locked_charge_isos
        )
        print(f"    hours: {locked_hours}")
        locked_costs = [h.total_cost for h in day_hours if h.iso in plan.locked_charge_isos]
        print(f"    total_cost range: {min(locked_costs):.4f} – {max(locked_costs):.4f}")
    print(f"  planned_v2h_isos   : {len(plan.planned_v2h_isos)} hours")
    if plan.planned_v2h_isos:
        v2h_hours = sorted(
            h.hour_of_day for h in day_hours if h.iso in plan.planned_v2h_isos
        )
        print(f"    hours: {v2h_hours}")
    print(f"  avg_charge_cost    : {plan.avg_charge_cost:.4f} SEK/kWh")
    print(f"  v2h_threshold      : {plan.v2h_threshold:.4f} SEK/kWh")

    # Sanity checks
    overlap = plan.locked_charge_isos & plan.planned_v2h_isos
    if overlap:
        print(f"\n  WARNING: {len(overlap)} iso(s) in both locked_charge and planned_v2h — should be 0")
    else:
        print(f"\n  ✓ No overlap between locked_charge and planned_v2h sets")

    if plan.avg_charge_cost > 0:
        print(f"  ✓ avg_charge_cost is positive")
    if plan.v2h_threshold > plan.avg_charge_cost:
        print(f"  ✓ v2h_threshold > avg_charge_cost (spread = {plan.v2h_threshold - plan.avg_charge_cost:.4f})")

    print(f"\n{'─'*60}")
    print("Dry-run complete — no writes made to the database.")
    print("─" * 60)


if __name__ == "__main__":
    main()
