"""Outer simulation loop — port of the Deno edge function run-simulation.ts.

Loads all required data from Supabase, runs the daily planner + hour-by-hour
decision engine, accumulates results, and writes back to the database.

Reference: run-simulation.ts (the full Deno.serve handler, ~900 lines).
"""
from __future__ import annotations

import math
import random as _random
from datetime import date as _date
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from config import (
    ARC_MAX_KW,
    DC_EFFICIENCY,
    DEFAULT_HARD_MAX_PRICE,
    DEFAULT_PEAK_TARIFF,
    DEFAULT_SOC_EMERGENCY,
    DEFAULT_WEIGHTS,
    ENERGY_TAX_SEK,
    KM_PER_PCT,
    PEAK_HOURS,
    SOC_HEALTH_MAX,
    SOC_PROTECT,
    TARGET_CHARGE_HOURS,
    TOO_CHEAP_PRICE,
    VAT_MULTIPLIER,
)
from db import get_client
from engine.decision import DecisionResult, apply_soc_update, decide_hour
from engine.planner import DayPlan, is_connected, is_sleeping, plan_day
from engine.scenarios import (
    build_scenario_map,
    effective_times,
    scenario_summary,
)
from schemas.grid_tariff import (
    GridCompanySettings,
    GridTariff,
    lookup_tariff,
)
from schemas.household import EVModel, HouseholdProfile
from schemas.spot_price import DayHour, SpotPrice

_STOCKHOLM = ZoneInfo("Europe/Stockholm")


def run_simulation(simulation_id: str) -> dict:
    """Run a full simulation for the given simulation_runs.id."""
    db = get_client()

    # ── SIM-1: load simulation run, mark running ──────────────────────────────
    sim = (
        db.table("simulation_runs")
        .select("*")
        .eq("id", simulation_id)
        .maybe_single()
        .execute()
        .data
    )
    if not sim:
        raise ValueError(f"simulation_run {simulation_id} not found")
    db.table("simulation_runs").update({"status": "running"}).eq("id", simulation_id).execute()

    mode = _normalize_mode(sim.get("optimization_mode"))
    sp = sim.get("scenario_params") or {}

    # ── SIM-2: household ──────────────────────────────────────────────────────
    hh_row = (
        db.table("household_profiles")
        .select("*")
        .eq("id", sim["household_id"])
        .maybe_single()
        .execute()
        .data
    )
    if not hh_row:
        db.table("simulation_runs").update({"status": "failed"}).eq("id", simulation_id).execute()
        raise ValueError("Household not found")
    hh = HouseholdProfile.from_row(hh_row)

    # Scenario params (mirroring TS clamp logic)
    starting_soc = max(5.0, min(100.0, float(sp.get("starting_soc", 50))))
    daily_km_mul = max(0.1, min(3.0, float(sp.get("daily_km_multiplier", 1.0))))
    price_threshold = max(0.5, min(10.0, float(sp.get("price_threshold", DEFAULT_HARD_MAX_PRICE))))
    min_soc = max(5.0, min(80.0, float(sp.get("min_soc", DEFAULT_SOC_EMERGENCY))))

    household_min_soc = max(10.0, min(70.0, hh.min_soc_pct))
    household_max_soc = max(50.0, min(100.0, hh.max_soc_pct))
    avg_house_kw = (hh.annual_kwh or 18000) / 8760

    daily_km = (hh.daily_km or 30) * daily_km_mul
    daily_kwh_needed = (daily_km / KM_PER_PCT) * (hh.battery_kwh or 60.0) / 100

    # ── SIM-3: EV model + CCS2 gate ──────────────────────────────────────────
    battery_kwh = hh.battery_kwh or 60.0
    charge_max_kw = ARC_MAX_KW
    v2h_max_kw = ARC_MAX_KW
    ccs2_port = True

    if hh.ev_model_id:
        ev_row = (
            db.table("ev_models")
            .select("ccs2_port, max_dc_charge_kw, max_v2x_discharge_kw, battery_kwh, brand, model")
            .eq("id", hh.ev_model_id)
            .maybe_single()
            .execute()
            .data
        )
        if ev_row:
            ccs2_port = ev_row.get("ccs2_port") is not False
            if ev_row.get("max_dc_charge_kw") is not None:
                charge_max_kw = min(ARC_MAX_KW, float(ev_row["max_dc_charge_kw"]))
            if ev_row.get("max_v2x_discharge_kw") is not None:
                v2h_max_kw = min(ARC_MAX_KW, float(ev_row["max_v2x_discharge_kw"]))
            if ev_row.get("battery_kwh") is not None:
                battery_kwh = float(ev_row["battery_kwh"])
                daily_kwh_needed = (daily_km / KM_PER_PCT) * battery_kwh / 100

    if mode == "smart_v2x" and not ccs2_port:
        db.table("simulation_runs").update({"status": "failed"}).eq("id", simulation_id).execute()
        raise ValueError("Denna bil saknar CCS2-port och är inte kompatibel med Arc laddbox.")

    ev = EVModel(
        id=hh.ev_model_id or "",
        brand="",
        model="",
        battery_kwh=battery_kwh,
        max_dc_charge_kw=charge_max_kw,
        max_v2x_discharge_kw=v2h_max_kw,
        ccs2_port=ccs2_port,
    )

    # ── SIM-4: consumption profile weights ────────────────────────────────────
    weights = list(DEFAULT_WEIGHTS)
    warnings: dict[str, str] = {}
    cp_rows = (
        db.table("consumption_profiles")
        .select("hour, weight")
        .eq("household_id", sim["household_id"])
        .execute()
        .data or []
    )
    if cp_rows:
        for r in cp_rows:
            h_idx = int(r["hour"])
            if 0 <= h_idx < 24:
                weights[h_idx] = float(r["weight"])
    else:
        warnings["consumption_warning"] = "Ingen förbrukningsprofil — standardvärden används"
    sum_weights = sum(weights)

    # ── SIM-5: spot prices (fall back to SE3 if price_area has no data) ───────
    price_area = hh.price_area or "SE3"
    prices = _fetch_spot_prices(db, price_area, sim["period_from"], sim["period_to"])
    if not prices:
        prices = _fetch_spot_prices(db, "SE3", sim["period_from"], sim["period_to"])
    if not prices:
        db.table("simulation_runs").update({"status": "failed"}).eq("id", simulation_id).execute()
        raise ValueError(
            f"No spot prices found for {price_area} between "
            f"{sim['period_from']} and {sim['period_to']}"
        )

    # ── SIM-6: grid tariffs + peak tariff settings ────────────────────────────
    tariffs: list[GridTariff] = []
    gcs: GridCompanySettings | None = None
    if hh.grid_company:
        t_rows = (
            db.table("grid_tariffs")
            .select("grid_company, hour_of_day, is_weekend, tariff_sek_kwh, month_from, month_to")
            .eq("grid_company", hh.grid_company)
            .execute()
            .data or []
        )
        tariffs = [GridTariff.from_row(r) for r in t_rows]
        gcs_row = (
            db.table("grid_company_settings")
            .select("*")
            .eq("grid_company", hh.grid_company)
            .maybe_single()
            .execute()
            .data
        )
        if gcs_row:
            gcs = GridCompanySettings.from_row(gcs_row)
        else:
            warnings["grid_tariff_warning"] = (
                f"{hh.grid_company} ej funnen i grid_company_settings "
                f"— standardvärde {DEFAULT_PEAK_TARIFF} SEK/kW används"
            )
    else:
        warnings["grid_tariff_warning"] = "Inget elnätsbolag valt — standardvärde 55 SEK/kW används"

    has_peak_tariff = gcs.has_peak_tariff if gcs else True
    peak_tariff_per_kw = gcs.peak_tariff_sek_per_kw if gcs else DEFAULT_PEAK_TARIFF
    peak_tariff_missing = gcs is None

    # ── SIM-7: group spot prices by Stockholm calendar day ────────────────────
    by_day: dict[str, list[dict]] = {}
    for sp_row in prices:
        dt_sthlm = sp_row.hour.astimezone(_STOCKHOLM)
        day_key = dt_sthlm.strftime("%Y-%m-%d")
        hod = dt_sthlm.hour
        tariff = lookup_tariff(tariffs, sp_row.hour.isoformat(), hod)
        total_cost = (sp_row.price_sek_kwh + tariff + ENERGY_TAX_SEK) * VAT_MULTIPLIER
        by_day.setdefault(day_key, []).append({
            "iso": sp_row.hour.isoformat(),
            "hour_of_day": hod,
            "price": sp_row.price_sek_kwh,
            "weight": weights[hod],
            "grid_tariff": tariff,
            "total_cost": total_cost,
        })

    # ── SIM-7b: build daily scenario map ──────────────────────────────────────
    # Seed: use stored value for reproducibility; generate+persist a new one
    # on the first run so the simulation can always be re-run identically.
    scenario_seed: int = sp.get("scenario_seed")  # type: ignore[assignment]
    if scenario_seed is None:
        scenario_seed = _random.randint(0, 2**31 - 1)
        updated_sp = {**(sp or {}), "scenario_seed": scenario_seed}
        db.table("simulation_runs").update(
            {"scenario_params": updated_sp}
        ).eq("id", simulation_id).execute()

    _period_from = _date.fromisoformat(sim["period_from"])
    _period_to   = _date.fromisoformat(sim["period_to"])
    scenario_map = build_scenario_map(_period_from, _period_to, scenario_seed)

    # ── Accumulators ──────────────────────────────────────────────────────────
    soc = starting_soc
    baseline_soc = starting_soc
    logs_batch: list[dict] = []
    events_batch: list[dict] = []

    total_kwh_charged = 0.0
    total_cost_optimized = 0.0
    total_cost_baseline = 0.0
    total_cost_with_tariff = 0.0
    total_cost_baseline_with_tariff = 0.0
    total_v2h_kwh = 0.0
    total_v2h_saving_sek = 0.0
    peak_hours_avoided = 0
    peaks_avoided_count = 0

    monthly_peak: dict[str, float] = {}           # YYYY-MM → optimized peak kW
    baseline_monthly_peak: dict[str, float] = {}   # YYYY-MM → baseline peak kW

    prev_decision: str | None = None
    prev_price_cheap = False
    prev_price_expensive = False
    cable_days_seen: set[str] = set()

    v2h_allowed = mode != "smart_charge_basic" and ccs2_port

    # ── SIM-8 → SIM-12: daily loop ────────────────────────────────────────────
    for day_key in sorted(by_day.keys()):
        raw_hours = by_day[day_key]
        if not raw_hours:
            continue
        month_key = day_key[:7]

        # Build DayHour list with per-day normalised combined_score
        max_price = max(r["price"] for r in raw_hours) or 1.0
        max_weight = max(r["weight"] for r in raw_hours) or 1.0
        day_hours: list[DayHour] = []
        for r in raw_hours:
            price_score = 1.0 - (r["price"] / max_price) if max_price > 0 else 1.0
            cons_score = 1.0 - (r["weight"] / max_weight) if max_weight > 0 else 1.0
            day_hours.append(DayHour(
                iso=r["iso"],
                hour_of_day=r["hour_of_day"],
                price=r["price"],
                weight=r["weight"],
                grid_tariff=r["grid_tariff"],
                total_cost=r["total_cost"],
                combined_score=price_score * 0.7 + cons_score * 0.3,
            ))

        daily_avg_price = sum(h.price for h in day_hours) / len(day_hours)

        # ── Per-day scenario ──────────────────────────────────────────────────
        scenario_name = scenario_map.get(day_key, "normal")
        day_wake, day_leave, day_return, day_sleep, day_car_home = effective_times(
            scenario_name,
            hh.wake_time, hh.leave_time, hh.return_time, hh.sleep_time,
        )
        # Car-home days don't need drive energy replenishment
        day_min_kwh_needed = 0.0 if day_car_home else daily_kwh_needed

        # Build v2x-like pickedCharge set unconditionally (used for peak_hours_avoided)
        connected_idx = [
            (i, h) for i, h in enumerate(day_hours)
            if is_connected(h.hour_of_day, day_leave, day_return)
        ]
        v2x_picked_indices: frozenset[int] = frozenset(
            i for i, _ in sorted(connected_idx, key=lambda x: x[1].price)[:TARGET_CHARGE_HOURS]
        )

        day_plan = plan_day(
            day_hours, hh, ev, soc, mode, daily_kwh_needed,
            leave_time=day_leave, return_time=day_return,
            wake_time=day_wake,   sleep_time=day_sleep,
        )
        # For smart_v2x, plan_day returns empty picked_charge_indices; use v2x_picked_indices
        # for the peak_hours_avoided counter (matches TS behaviour)
        picked_indices = (
            day_plan.picked_charge_indices if mode != "smart_v2x" else v2x_picked_indices
        )

        day_kwh_charged = 0.0
        day_charge_cost = 0.0
        day_charge_cost_with_tariff = 0.0
        day_logs_start = len(logs_batch)
        day_start_soc = soc
        hour_connected_map = {
            h.iso: is_connected(h.hour_of_day, day_leave, day_return)
            for h in day_hours
        }

        for idx, h in enumerate(day_hours):
            house_kw = avg_house_kw * (h.weight / (sum_weights / 24))
            fuse_available_kw = max(0.0, hh.fuse_max_kw - house_kw)
            effective_charge_kw = min(charge_max_kw, fuse_available_kw)
            connected = is_connected(h.hour_of_day, day_leave, day_return)

            # Morning guarantee: must reach target before leave_time
            morning_force = False
            if (
                mode == "smart_v2x"
                and connected
                and h.hour_of_day < day_leave
                and soc < household_max_soc - 10
            ):
                hours_left = day_leave - h.hour_of_day
                kwh_still_needed = ((household_max_soc - soc) / 100) * battery_kwh
                kwh_possible = hours_left * charge_max_kw * DC_EFFICIENCY
                if kwh_possible <= kwh_still_needed * 1.05:
                    morning_force = True

            locked = h.iso in day_plan.locked_charge_isos
            planned_v2h = h.iso in day_plan.planned_v2h_isos
            picked = idx in picked_indices

            result = decide_hour(
                h=h,
                soc=soc,
                connected=connected,
                locked_charge=locked,
                planned_v2h=planned_v2h,
                avg_charge_cost=day_plan.avg_charge_cost,
                hh=hh,
                ev=ev,
                mode=mode,
                house_kw=house_kw,
                price_threshold=price_threshold,
                min_soc=min_soc,
                monthly_peak_kw=monthly_peak.get(month_key, 0.0),
                peak_tariff_per_kw=peak_tariff_per_kw,
                has_peak_tariff=has_peak_tariff,
                peak_tariff_missing=peak_tariff_missing,
                month_key=month_key,
                picked_charge=picked,
                morning_guarantee_force=morning_force,
                daily_avg_price=daily_avg_price,
                daily_max_weight=max_weight,
            )

            # SIM-12: monthly peak tracking (charge + pause update peak; v2h does not)
            if mode == "smart_v2x" and has_peak_tariff and result.decision != "v2h":
                if result.grid_draw_kw > monthly_peak.get(month_key, 0.0):
                    monthly_peak[month_key] = result.grid_draw_kw

            # Accumulate V2H totals
            if result.decision == "v2h":
                total_v2h_kwh += abs(result.charge_kw)
                total_v2h_saving_sek += result.v2h_saving_sek

            # peak_hours_avoided counters (match TS)
            if "spot_above" in result.reason and idx in picked_indices:
                peak_hours_avoided += 1
            if (
                result.decision == "pause"
                and result.reason in ("house_peak_consumption", "lower_score")
                and h.hour_of_day in PEAK_HOURS
            ):
                peak_hours_avoided += 1
            if "peak_tariff_avoided" in result.reason:
                peaks_avoided_count += 1

            # Apply SoC update
            soc = apply_soc_update(result, soc, hh, ev, daily_kwh_needed, connected)

            # Accumulate charge costs
            if result.decision in ("charge", "emergency_charge"):
                day_kwh_charged += result.charge_kw * DC_EFFICIENCY
                day_charge_cost += result.charge_kw * h.price
                day_charge_cost_with_tariff += result.charge_kw * h.total_cost

            soc_now = round(soc, 2)

            # Build log row — scenario appended to reason for per-hour traceability
            _reason = (
                result.reason if scenario_name == "normal"
                else f"{result.reason}::scenario={scenario_name}"
            )
            logs_batch.append({
                "simulation_id": simulation_id,
                "household_id": sim["household_id"],
                "logged_at": h.iso,
                "decision": result.decision,
                "spot_price_sek": h.price,
                "soc_pct": soc_now,
                "reason": _reason,
                "charge_kw": round(result.charge_kw, 2),
                "house_consumption_kw": round(house_kw, 3),
                "grid_draw_kw": round(result.grid_draw_kw, 3),
                "v2h_saving_sek": round(result.v2h_saving_sek, 4),
                "combined_score": round(h.combined_score, 4),
                "grid_tariff_sek": round(h.grid_tariff, 4),
                "energy_tax_sek": ENERGY_TAX_SEK,
                "total_cost_per_kwh": round(h.total_cost, 4),
            })

            # ── SIM-10: event detection ────────────────────────────────────────
            def _ev(extra: dict) -> None:
                events_batch.append({
                    "simulation_id": simulation_id,
                    "household_id": sim["household_id"],
                    **extra,
                })

            # Cable connect / disconnect events (once per day per direction)
            # Car-home scenarios (day_leave=24) never fire a disconnect event.
            if h.hour_of_day == day_leave and f"{day_key}-leave" not in cable_days_seen:
                cable_days_seen.add(f"{day_key}-leave")
                _ev({"occurred_at": h.iso, "event_type": "cable_disconnected",
                     "value_soc_pct": soc_now, "reason": "Kunden lämnade hemmet"})
            if h.hour_of_day == day_return and f"{day_key}-return" not in cable_days_seen:
                cable_days_seen.add(f"{day_key}-return")
                _ev({"occurred_at": h.iso, "event_type": "cable_connected",
                     "value_soc_pct": soc_now, "reason": "Kunden kom hem"})

            # Price extreme events
            is_cheap = h.price < TOO_CHEAP_PRICE
            is_expensive = h.price > price_threshold
            if is_cheap and not prev_price_cheap:
                _ev({"occurred_at": h.iso, "event_type": "cheap_price_detected",
                     "value_price_sek": h.price,
                     "reason": f"Extremt lågt pris: {h.price:.3f} SEK/kWh"})
            if is_expensive and not prev_price_expensive:
                _ev({"occurred_at": h.iso, "event_type": "expensive_price_detected",
                     "value_price_sek": h.price,
                     "reason": f"Högt pris: {h.price:.3f} SEK/kWh"})
            prev_price_cheap = is_cheap
            prev_price_expensive = is_expensive

            # Peak demand avoided event (fired when peak_tariff_avoided reason)
            if "peak_tariff_avoided" in result.reason:
                projected_kw = house_kw + effective_charge_kw
                reduction = projected_kw - monthly_peak.get(month_key, 0.0)
                _ev({"occurred_at": h.iso, "event_type": "peak_demand_avoided",
                     "value_kw": max(0.0, reduction),
                     "reason": f"Effekttariff: undvek ny topp +{max(0.0, reduction):.1f} kW"})

            # Decision transition events
            if prev_decision != result.decision:
                upper_soc_cap = household_max_soc if mode == "smart_v2x" else SOC_PROTECT
                v2h_floor_ev = household_min_soc if mode == "smart_v2x" else max(min_soc, 35.0)

                dec = result.decision
                prev = prev_decision
                if dec == "emergency_charge":
                    _ev({"occurred_at": h.iso, "event_type": "emergency_charge_started",
                         "value_kw": result.charge_kw, "value_soc_pct": soc_now,
                         "value_price_sek": h.price, "reason": f"SoC kritiskt låg: {soc_now}%"})
                elif prev != "charge" and dec == "charge":
                    _ev({"occurred_at": h.iso, "event_type": "charging_started",
                         "value_kw": result.charge_kw, "value_soc_pct": soc_now,
                         "value_price_sek": h.price,
                         "reason": f"Spotpris {h.price:.3f} SEK/kWh"})
                elif prev in ("charge", "emergency_charge") and dec == "pause":
                    stop = "Schema: topptimme undviken"
                    if h.price > price_threshold:
                        stop = f"Spotpris för högt: {h.price:.3f} SEK/kWh"
                    elif soc > upper_soc_cap:
                        stop = (
                            f"Max-laddning: stannar vid {household_max_soc}%"
                            if mode == "smart_v2x" else f"Batteri fullt: {soc_now}%"
                        )
                    elif result.reason == "fuse_full":
                        stop = "Huvudsäkring full"
                    elif "peak_tariff_avoided" in result.reason:
                        stop = "Effekttariff: undvek ny topp"
                    _ev({"occurred_at": h.iso, "event_type": "charging_stopped",
                         "value_kw": 0.0, "value_soc_pct": soc_now,
                         "value_price_sek": h.price, "reason": stop})
                elif prev != "v2h" and dec == "v2h":
                    _ev({"occurred_at": h.iso, "event_type": "v2h_started",
                         "value_kw": result.charge_kw, "value_soc_pct": soc_now,
                         "value_price_sek": h.price,
                         "value_sek_impact": round(abs(result.charge_kw) * h.price, 2),
                         "reason": f"Topptimme {h.hour_of_day}:00 — V2H aktiverad"})
                elif prev == "v2h" and dec != "v2h":
                    stop = (
                        f"Min-batterinivå: V2H stoppad vid {household_min_soc}%"
                        if soc <= v2h_floor_ev + 1
                        else "Topptimme avslutad"
                    )
                    _ev({"occurred_at": h.iso, "event_type": "v2h_stopped",
                         "value_soc_pct": soc_now, "reason": stop})

                prev_decision = result.decision

        # ── SIM-11: minimum daily charge guarantee ─────────────────────────────
        # Car-home days don't consume drive energy, so no minimum top-up needed.
        if day_kwh_charged < day_min_kwh_needed:
            remaining = day_min_kwh_needed - day_kwh_charged
            hours_to_force = math.ceil(remaining / (charge_max_kw * DC_EFFICIENCY))
            upper_cap = SOC_HEALTH_MAX if mode == "smart_v2x" else SOC_PROTECT
            already_isos = {
                row["logged_at"]
                for row in logs_batch[day_logs_start:]
                if row["decision"] in ("charge", "emergency_charge", "v2h")
            }
            candidates = sorted(
                [
                    h for h in day_hours
                    if is_connected(h.hour_of_day, day_leave, day_return)
                    and h.iso not in already_isos
                    and soc < upper_cap
                ],
                key=lambda h: h.price,
            )[:hours_to_force]

            for h in candidates:
                if day_kwh_charged >= day_min_kwh_needed:
                    break
                if soc >= upper_cap:
                    break
                hkw = avg_house_kw * (h.weight / (sum_weights / 24))
                kw_drawn = min(charge_max_kw, max(0.0, hh.fuse_max_kw - hkw))
                if kw_drawn <= 0:
                    continue
                kwh_stored = kw_drawn * DC_EFFICIENCY
                soc = min(100.0, soc + (kwh_stored / battery_kwh) * 100)
                day_kwh_charged += kwh_stored
                day_charge_cost += kw_drawn * h.price
                day_charge_cost_with_tariff += kw_drawn * h.total_cost
                # Backfill the log entry for this hour
                for i in range(day_logs_start, len(logs_batch)):
                    if (
                        logs_batch[i]["logged_at"] == h.iso
                        and logs_batch[i]["simulation_id"] == simulation_id
                    ):
                        logs_batch[i] = {
                            **logs_batch[i],
                            "decision": "charge",
                            "reason": "minimum_dagsladdning",
                            "charge_kw": round(kw_drawn, 2),
                            "soc_pct": round(soc, 2),
                            "grid_draw_kw": round(
                                kw_drawn + float(logs_batch[i].get("house_consumption_kw", 0)),
                                3,
                            ),
                        }
                        break

        # ── SIM-11b: recompute soc_pct chain after backfill ───────────────────
        # The backfill loop above sets soc_pct to the end-of-backfill SoC value
        # instead of the per-hour value.  Sweep through the day's logs in order
        # and rebuild the correct running SoC so every row reflects the SoC
        # *after* that specific hour's action.
        sweep_soc = day_start_soc
        for i in range(day_logs_start, len(logs_batch)):
            log = logs_batch[i]
            c_kw = float(log.get("charge_kw", 0.0))
            dec = log["decision"]
            if dec in ("charge", "emergency_charge"):
                sweep_soc = min(100.0, sweep_soc + (c_kw * DC_EFFICIENCY / battery_kwh) * 100)
            elif dec == "v2h":
                sweep_soc = max(0.0, sweep_soc - (abs(c_kw) / DC_EFFICIENCY / battery_kwh) * 100)
            else:  # pause
                if not hour_connected_map.get(log["logged_at"], True):
                    sweep_soc = max(0.0, sweep_soc - (daily_kwh_needed / 24.0 / battery_kwh) * 100)
            logs_batch[i]["soc_pct"] = round(sweep_soc, 2)
        soc = sweep_soc

        total_kwh_charged += day_kwh_charged
        total_cost_optimized += day_charge_cost
        total_cost_with_tariff += day_charge_cost_with_tariff

        # ── SIM-12: baseline (dumb — charge every connected hour) ─────────────
        # Apply same daily driving drain as optimised path (0 for car-home days).
        baseline_soc = max(0.0, baseline_soc - (daily_kwh_needed / battery_kwh) * 100)
        baseline_connected = sorted(
            [h for h in day_hours if is_connected(h.hour_of_day, day_leave, day_return)],
            key=lambda h: h.iso,
        )
        for h in baseline_connected:
            hkw = avg_house_kw * (h.weight / (sum_weights / 24))
            kw_drawn_b = 0.0
            if baseline_soc < 100:
                headroom_kwh = ((100 - baseline_soc) / 100) * battery_kwh
                fuse_avail = max(0.0, hh.fuse_max_kw - hkw)
                kw_drawn_b = min(charge_max_kw, fuse_avail, headroom_kwh / DC_EFFICIENCY)
                if kw_drawn_b > 0:
                    kwh_stored_b = kw_drawn_b * DC_EFFICIENCY
                    total_cost_baseline += kw_drawn_b * h.price
                    total_cost_baseline_with_tariff += kw_drawn_b * h.total_cost
                    baseline_soc = min(100.0, baseline_soc + (kwh_stored_b / battery_kwh) * 100)
            baseline_grid_kw = kw_drawn_b + hkw
            if baseline_grid_kw > baseline_monthly_peak.get(month_key, 0.0):
                baseline_monthly_peak[month_key] = baseline_grid_kw

    # ── SIM-13: effekttariff saving (post-loop) ───────────────────────────────
    peak_demand_saving_sek = 0.0
    if mode == "smart_v2x" and has_peak_tariff:
        for month, actual_peak in monthly_peak.items():
            base_peak = baseline_monthly_peak.get(month, actual_peak)
            reduction = max(0.0, base_peak - actual_peak)
            if reduction > 0:
                raw_saving = reduction * peak_tariff_per_kw
                max_reduction_kw = (
                    3.0 if hh.fuse_amps <= 16 else
                    4.0 if hh.fuse_amps <= 20 else
                    5.0 if hh.fuse_amps <= 25 else
                    6.0
                )
                monthly_cap = peak_tariff_per_kw * max_reduction_kw
                peak_demand_saving_sek += min(raw_saving, monthly_cap)

    # ── SIM-14: delete old logs, insert in 500-row chunks ────────────────────
    db.table("optimization_logs").delete().eq("simulation_id", simulation_id).execute()
    logs_inserted = 0
    for i in range(0, len(logs_batch), 500):
        chunk = logs_batch[i:i + 500]
        try:
            db.table("optimization_logs").insert(chunk).execute()
            logs_inserted += len(chunk)
        except Exception as exc:
            print(f"[simulator] log insert error (chunk {i}): {exc}")

    # ── SIM-15: delete old events, insert in 500-row chunks ──────────────────
    if (sim.get("scenario_number") or 1) == 1:
        db.table("simulation_events").delete().eq("simulation_id", simulation_id).execute()
    for i in range(0, len(events_batch), 500):
        chunk = events_batch[i:i + 500]
        try:
            db.table("simulation_events").insert(chunk).execute()
        except Exception as exc:
            print(f"[simulator] event insert error (chunk {i}): {exc}")

    # ── SIM-16: update simulation_runs with totals ────────────────────────────
    price_savings = max(0.0, total_cost_baseline - total_cost_optimized)
    total_saved = price_savings + total_v2h_saving_sek + peak_demand_saving_sek
    savings_incl_tariff = (
        max(0.0, total_cost_baseline_with_tariff - total_cost_with_tariff)
        + total_v2h_saving_sek
        + peak_demand_saving_sek
    )
    avg_price_paid = total_cost_optimized / total_kwh_charged if total_kwh_charged > 0 else 0.0

    # Merge scenario metadata into warnings JSONB so it's queryable from the DB
    _scen_summary = scenario_summary(scenario_map)
    final_warnings = {**(warnings or {}), "scenario_summary": _scen_summary, "scenario_seed": scenario_seed}

    db.table("simulation_runs").update({
        "status": "completed",
        "ended_at": datetime.now(timezone.utc).isoformat(),
        "total_saved_sek": _r2(total_saved),
        "price_savings_sek": _r2(price_savings),
        "total_v2h_kwh": _r2(total_v2h_kwh),
        "total_v2h_saving_sek": _r2(total_v2h_saving_sek),
        "peak_hours_avoided": peak_hours_avoided,
        "peak_demand_saving_sek": _r2(peak_demand_saving_sek),
        "peaks_avoided_count": peaks_avoided_count,
        "avg_price_paid": round(avg_price_paid, 4),
        "total_cost_with_tariff": _r2(total_cost_with_tariff),
        "total_saved_including_tariff": _r2(savings_incl_tariff),
        "total_events": len(events_batch),
        "warnings": final_warnings,
    }).eq("id", simulation_id).execute()

    return {
        "mode": mode,
        "ccs2_port": ccs2_port,
        "days_processed": len(by_day),
        "total_kwh_charged": _r2(total_kwh_charged),
        "total_saved_sek": _r2(total_saved),
        "price_savings_sek": _r2(price_savings),
        "total_v2h_kwh": _r2(total_v2h_kwh),
        "total_v2h_saving_sek": _r2(total_v2h_saving_sek),
        "peak_hours_avoided": peak_hours_avoided,
        "peak_demand_saving_sek": _r2(peak_demand_saving_sek),
        "peaks_avoided_count": peaks_avoided_count,
        "avg_price_paid": round(avg_price_paid, 4),
        "total_cost_with_tariff": _r2(total_cost_with_tariff),
        "total_saved_including_tariff": _r2(savings_incl_tariff),
        "decisions_logged": logs_inserted,
        "events_logged": len(events_batch),
        "scenario_seed": scenario_seed,
        "scenario_summary": _scen_summary,
    }


# ── Private helpers ──────────────────────────────────────────────────────────

def _normalize_mode(value: str | None) -> str:
    """Map legacy level1/2/3 strings to canonical mode names."""
    _map = {"level1": "smart_charge_basic", "level2": "smart_charge", "level3": "smart_v2x"}
    if value in _map:
        return _map[value]
    if value in ("smart_charge_basic", "smart_charge", "smart_v2x"):
        return value
    return "smart_charge"


def _fetch_spot_prices(db, price_area: str, period_from: str, period_to: str) -> list[SpotPrice]:
    """Load spot_prices rows for the given area and date range (inclusive).

    Supabase returns at most 1 000 rows per query by default, which caps a
    simulation at ~42 days (42 × 24 = 1 008).  We paginate in 1 000-row
    chunks until the server returns an empty page.
    """
    from_iso = f"{period_from}T00:00:00+00:00"
    to_iso = f"{period_to}T23:59:59+00:00"

    PAGE = 1000
    all_rows: list[dict] = []
    offset = 0

    while True:
        page = (
            db.table("spot_prices")
            .select("hour, price_sek_kwh, price_area")
            .eq("price_area", price_area)
            .gte("hour", from_iso)
            .lte("hour", to_iso)
            .order("hour")
            .range(offset, offset + PAGE - 1)
            .execute()
            .data or []
        )
        all_rows.extend(page)
        if len(page) < PAGE:
            break
        offset += PAGE

    return [SpotPrice.from_row(r) for r in all_rows]


def _r2(n: float) -> float:
    return round(n, 2)
