"""Daily lookahead planner — port of the smart_v2x planning block in run-simulation.ts.

Reference: run-simulation.ts § "DAILY PLAN (smart_v2x lookahead)" (~lines 1160–1235).
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

from config import (
    ARC_MAX_KW,
    DC_EFFICIENCY,
    TARGET_CHARGE_HOURS,
    V2H_MARGIN_SEK,
)
from schemas.household import EVModel, HouseholdProfile
from schemas.spot_price import DayHour


@dataclass
class DayPlan:
    """Output of plan_day() — pre-computed sets consumed by decide_hour()."""
    locked_charge_isos: frozenset[str] = field(default_factory=frozenset)
    planned_v2h_isos: frozenset[str] = field(default_factory=frozenset)
    avg_charge_cost: float = 0.0
    v2h_threshold: float = 0.0
    picked_charge_indices: frozenset[int] = field(default_factory=frozenset)


# ── Shared predicates ────────────────────────────────────────────────────────

def is_connected(hod: int, leave_time: int, return_time: int) -> bool:
    """True when the car is plugged in during hour-of-day hod.

    Mirrors isConnectedHour() in run-simulation.ts.
    """
    if return_time == leave_time:
        return True
    if return_time < leave_time:
        return return_time <= hod < leave_time
    return hod >= return_time or hod < leave_time


def is_sleeping(hod: int, sleep_time: int, wake_time: int) -> bool:
    """True during the household sleeping window (wraps midnight).

    Mirrors isInSleepingZone() in run-simulation.ts.
    """
    if sleep_time == wake_time:
        return False
    if sleep_time > wake_time:
        return hod >= sleep_time or hod < wake_time
    return sleep_time <= hod < wake_time


# ── Main planning function ───────────────────────────────────────────────────

def plan_day(
    day_hours: list[DayHour],
    hh: HouseholdProfile,
    ev: EVModel,
    soc: float,
    mode: str,
    daily_kwh_needed: float,
    leave_time: int | None = None,
    return_time: int | None = None,
    wake_time: int | None = None,
    sleep_time: int | None = None,
) -> DayPlan:
    """Analyse the full 24-hour price curve and return a DayPlan.

    For smart_v2x: locks cheapest sleeping/pre-leave hours for charging and
    marks expensive evening/morning hours for V2H.

    For smart_charge_basic / smart_charge: picks TARGET_CHARGE_HOURS connected
    hours by spot price or combined score respectively.

    leave_time / return_time / wake_time / sleep_time override the household
    profile values — used by the scenario system for per-day schedule variations.
    """
    plan = DayPlan()
    if not day_hours:
        return plan

    # Effective schedule: per-day overrides take precedence over household defaults
    _leave  = leave_time  if leave_time  is not None else hh.leave_time
    _return = return_time if return_time is not None else hh.return_time
    _wake   = wake_time   if wake_time   is not None else hh.wake_time
    _sleep  = sleep_time  if sleep_time  is not None else hh.sleep_time

    if mode == "smart_v2x":
        # kWh to charge: enough to cover daily drive AND reach target SoC
        current_soc_kwh = (soc / 100) * ev.battery_kwh
        target_soc_kwh = (hh.max_soc_pct / 100) * ev.battery_kwh
        kwh_to_charge = max(daily_kwh_needed, target_soc_kwh - current_soc_kwh)
        eff_charge_kw = max(0.5, min(ARC_MAX_KW, ev.max_dc_charge_kw) * DC_EFFICIENCY)
        charge_hours_needed = math.ceil(kwh_to_charge / eff_charge_kw)

        # Cheapest sleeping+connected hours first
        cheap = sorted(day_hours, key=lambda h: h.total_cost)
        sleeping_cheap = [
            h for h in cheap
            if is_sleeping(h.hour_of_day, _sleep, _wake)
            and is_connected(h.hour_of_day, _leave, _return)
        ][:charge_hours_needed]

        # Fall back to cheapest pre-leave connected non-sleeping hours
        if len(sleeping_cheap) < charge_hours_needed:
            already = {h.iso for h in sleeping_cheap}
            extra = [
                h for h in cheap
                if not is_sleeping(h.hour_of_day, _sleep, _wake)
                and is_connected(h.hour_of_day, _leave, _return)
                and h.hour_of_day < _leave
                and h.iso not in already
            ][:charge_hours_needed - len(sleeping_cheap)]
            sleeping_cheap.extend(extra)

        locked = sleeping_cheap
        plan.locked_charge_isos = frozenset(h.iso for h in locked)

        avg_day_cost = sum(h.total_cost for h in day_hours) / len(day_hours)
        plan.avg_charge_cost = (
            sum(h.total_cost for h in locked) / len(locked)
            if locked else avg_day_cost
        )
        plan.v2h_threshold = plan.avg_charge_cost + V2H_MARGIN_SEK

        # Plan V2H: connected, not sleeping, not locked, in evening/morning window
        # or total_cost exceeds the threshold
        v2h_isos: set[str] = set()
        for h in day_hours:
            hod = h.hour_of_day
            if not is_connected(hod, _leave, _return):
                continue
            if is_sleeping(hod, _sleep, _wake):
                continue
            if h.iso in plan.locked_charge_isos:
                continue
            # Evening window: _return → _sleep
            if _sleep > _return:
                in_evening = _return <= hod < _sleep
            else:
                in_evening = hod >= _return or hod < _sleep
            # Morning window: _wake → _leave (only when leave > wake)
            in_morning = (_wake <= hod < _leave) if _leave > _wake else False

            if (
                h.total_cost > plan.v2h_threshold
                or in_evening
                or (in_morning and h.total_cost > plan.v2h_threshold * 0.95)
            ):
                v2h_isos.add(h.iso)
        plan.planned_v2h_isos = frozenset(v2h_isos)

    elif mode == "smart_charge_basic":
        # 8 cheapest connected hours by spot price
        connected = [
            (i, h) for i, h in enumerate(day_hours)
            if is_connected(h.hour_of_day, _leave, _return)
        ]
        cheapest = sorted(connected, key=lambda x: x[1].price)[:TARGET_CHARGE_HOURS]
        plan.picked_charge_indices = frozenset(i for i, _ in cheapest)

    else:  # smart_charge — combined score (price 70% + consumption 30%)
        connected = [
            (i, h) for i, h in enumerate(day_hours)
            if is_connected(h.hour_of_day, _leave, _return)
        ]
        ranked = sorted(connected, key=lambda x: x[1].combined_score, reverse=True)
        top = ranked[:TARGET_CHARGE_HOURS]
        plan.picked_charge_indices = frozenset(i for i, _ in top)

    return plan
