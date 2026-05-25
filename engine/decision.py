"""Hour-by-hour decision logic — port of the rule engine in run-simulation.ts.

Rules are evaluated top-down; first match wins. Order matches DECISION_LOGIC.md
§ "Rule order (smart_v2x mode)" and run-simulation.ts lines ~1286–1406.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from config import (
    ARC_MAX_KW,
    DC_EFFICIENCY,
    DEFAULT_HARD_MAX_PRICE,
    DEFAULT_SOC_EMERGENCY,
    PEAK_HOURS,
    SOC_HEALTH_MAX,
    SOC_PROTECT,
    TOO_CHEAP_PRICE,
    V2H_MARGIN_SEK,
)
from schemas.household import EVModel, HouseholdProfile
from schemas.spot_price import DayHour

Decision = Literal["charge", "pause", "v2h", "emergency_charge"]


@dataclass
class DecisionResult:
    decision: Decision
    reason: str
    charge_kw: float       # positive = charging, negative = discharging (V2H)
    v2h_saving_sek: float  # grid cost avoided via V2H this hour
    grid_draw_kw: float    # net power drawn from grid (house + EV charge – V2H)


def decide_hour(
    h: DayHour,
    soc: float,
    connected: bool,
    locked_charge: bool,
    planned_v2h: bool,
    avg_charge_cost: float,
    hh: HouseholdProfile,
    ev: EVModel,
    mode: str,
    house_kw: float,
    price_threshold: float = DEFAULT_HARD_MAX_PRICE,
    min_soc: float = DEFAULT_SOC_EMERGENCY,
    monthly_peak_kw: float = 0.0,
    peak_tariff_per_kw: float = 55.0,
    has_peak_tariff: bool = True,
    peak_tariff_missing: bool = False,
    month_key: str = "",
    picked_charge: bool = False,
    morning_guarantee_force: bool = False,
    daily_avg_price: float = 0.5,
    daily_max_weight: float = 0.0,
) -> DecisionResult:
    """Return the optimal decision for one simulated hour.

    house_kw must be pre-computed by the simulator:
        avg_house_kw * (h.weight / (sum_weights / 24))
    """
    fuse_available_kw = max(0.0, hh.fuse_max_kw - house_kw)
    charge_max_kw = min(ARC_MAX_KW, ev.max_dc_charge_kw)
    effective_charge_kw = min(charge_max_kw, fuse_available_kw)

    upper_soc_cap = hh.max_soc_pct if mode == "smart_v2x" else SOC_PROTECT
    v2h_soc_floor = hh.min_soc_pct if mode == "smart_v2x" else max(min_soc, 35.0)
    v2h_allowed = mode != "smart_charge_basic" and ev.ccs2_port

    # ── RULE 1: cable_disconnected ────────────────────────────────────────────
    if not connected:
        return DecisionResult("pause", "cable_disconnected", 0.0, 0.0, house_kw)

    # ── RULE 2: fuse_full ─────────────────────────────────────────────────────
    if fuse_available_kw <= 0.1:
        return DecisionResult("pause", "fuse_full", 0.0, 0.0, house_kw)

    # ── RULE 3: emergency_charge — soc below floor regardless of price ────────
    if soc < min_soc:
        return DecisionResult(
            "emergency_charge", "soc_below_min_emergency",
            effective_charge_kw, 0.0, house_kw + effective_charge_kw,
        )

    # ── RULE 4 (legacy modes only): soc above protect ceiling → pause ─────────
    if mode != "smart_v2x" and soc > upper_soc_cap:
        return DecisionResult("pause", "soc_above_protect", 0.0, 0.0, house_kw)

    # ── RULE 5: spot price above hard cap → pause ─────────────────────────────
    if h.price > price_threshold:
        return DecisionResult(
            "pause", f"spot_above_{price_threshold}sek_blocked", 0.0, 0.0, house_kw,
        )

    # ── smart_v2x branch (rules 6–7d) ────────────────────────────────────────
    if mode == "smart_v2x":

        # RULE 6: morning_guarantee_override — must reach target before leave_time
        if morning_guarantee_force and soc < hh.max_soc_pct:
            projected_kw = house_kw + effective_charge_kw
            return DecisionResult(
                "charge",
                f"morning_guarantee_override: soc {soc:.0f}% before leave",
                effective_charge_kw, 0.0, projected_kw,
            )

        # RULE 7a: locked_charge_iso — planned cheap charging hour
        if locked_charge and soc < hh.max_soc_pct:
            projected_kw = house_kw + effective_charge_kw
            peak_cost_delta = (projected_kw - monthly_peak_kw) * peak_tariff_per_kw
            price_benefit = max(0.0, (price_threshold - h.price) * effective_charge_kw)
            if (
                has_peak_tariff
                and projected_kw > monthly_peak_kw
                and peak_cost_delta > price_benefit
            ):
                reason = (
                    "peak_tariff_avoided | Effekttariff: standardvärde använt (bolag ej registrerat)"
                    if peak_tariff_missing else "peak_tariff_avoided"
                )
                return DecisionResult("pause", reason, 0.0, 0.0, house_kw)
            return DecisionResult(
                "charge",
                f"night_charge_planned: {h.total_cost:.2f} SEK/kWh",
                effective_charge_kw, 0.0, projected_kw,
            )

        # RULE 7b: planned_v2h_iso — discharge to cover house load
        if (
            v2h_allowed
            and planned_v2h
            and soc > v2h_soc_floor
            and house_kw > 0.05
        ):
            v2h_max_kw = min(ARC_MAX_KW, ev.max_v2x_discharge_kw)
            # Cap to actual house load — V2H cannot export to grid; fuse not a constraint
            # for discharge direction since we reduce grid draw, not increase it.
            discharge_kw = min(v2h_max_kw, house_kw)
            if discharge_kw > 0.2:
                spread = h.total_cost - avg_charge_cost
                saving = discharge_kw * max(0.0, spread)
                grid_kw = max(0.0, house_kw - discharge_kw)
                return DecisionResult(
                    "v2h",
                    f"v2h_planned: grid {h.total_cost:.2f} vs charged {avg_charge_cost:.2f} spread +{spread:.2f}",
                    -discharge_kw, saving, grid_kw,
                )
            return DecisionResult("pause", "v2h_no_house_load", 0.0, 0.0, house_kw)

        # RULE 7c: soc at ceiling → pause
        if soc >= upper_soc_cap:
            return DecisionResult(
                "pause", f"max_soc_reached: {soc:.0f}% at ceiling", 0.0, 0.0, house_kw,
            )

        # RULE 7d: no other rule matched
        return DecisionResult("pause", "no_action: price similar to charge cost", 0.0, 0.0, house_kw)

    # ── Legacy modes: smart_charge and smart_charge_basic (rules 8–10) ────────

    # RULE 8: too_cheap_to_ignore — always charge at very low spot prices
    if h.price < TOO_CHEAP_PRICE:
        return DecisionResult(
            "charge", "too_cheap_to_ignore",
            effective_charge_kw, 0.0, house_kw + effective_charge_kw,
        )

    # RULE 9 (smart_charge only): V2H during peak hours when price is high
    if (
        v2h_allowed
        and mode == "smart_charge"
        and h.hour_of_day in PEAK_HOURS
        and h.price > 1.0
        and h.price > daily_avg_price * 1.2
        and soc > 40.0
    ):
        v2h_max_kw = min(ARC_MAX_KW, ev.max_v2x_discharge_kw)
        discharge_kw = min(7.0, v2h_max_kw, house_kw)
        saving = discharge_kw * h.price
        grid_kw = max(0.0, house_kw - discharge_kw)
        return DecisionResult("v2h", "peak_price_v2h", -discharge_kw, saving, grid_kw)

    # RULE 10: picked charge set (cheapest-8 or best-combined-score hours)
    if picked_charge:
        reason = "cheapest_8_hours" if mode == "smart_charge_basic" else "best_combined_score"
        return DecisionResult(
            "charge", reason, effective_charge_kw, 0.0, house_kw + effective_charge_kw,
        )

    # Fallback pause
    use_peak_reason = daily_max_weight > 0 and h.weight >= daily_max_weight * 0.8
    reason = "house_peak_consumption" if use_peak_reason else "lower_score"
    return DecisionResult("pause", reason, 0.0, 0.0, house_kw)


def apply_soc_update(
    result: DecisionResult,
    soc: float,
    hh: HouseholdProfile,
    ev: EVModel,
    daily_kwh_needed: float,
    connected: bool = True,
) -> float:
    """Apply the SoC change for one hour and return new SoC.

    Matches the state-update block in run-simulation.ts (after the decision chain).
    DC_EFFICIENCY: charge stores kWh_drawn × 0.95; V2H needs kWh_delivered / 0.95.
    Drive energy is only drained when the car is away (not connected).
    """
    battery_kwh = ev.battery_kwh

    if result.decision in ("charge", "emergency_charge"):
        kwh_stored = result.charge_kw * DC_EFFICIENCY
        soc = min(100.0, soc + (kwh_stored / battery_kwh) * 100)

    elif result.decision == "v2h":
        discharge_kw = abs(result.charge_kw)
        kwh_from_battery = discharge_kw / DC_EFFICIENCY
        soc = max(0.0, soc - (kwh_from_battery / battery_kwh) * 100)

    else:  # pause
        if not connected:
            drive_per_hour = daily_kwh_needed / 24.0
            soc = max(0.0, soc - (drive_per_hour / battery_kwh) * 100)

    return soc
