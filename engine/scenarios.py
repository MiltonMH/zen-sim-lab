"""Daily scenario generator for ZenOS simulation.

Generates realistic day-to-day variations for a Swedish commuter household
based on SCB statistics and typical Swedish work patterns.

Scenario probabilities (weekdays, base):
  normal      70%  Standard commute — leave 07, return 17
  wfh         10%  Jobbar hemifrån — car stays home, full-day V2H available
  sick         5%  Sjukdag — car home, later wake, earlier sleep
  oversleep    5%  Försover sig — departure +1h
  overtime     5%  Övertid — return +2h
  day_off      5%  Ledig dag — vacation/holiday, leisure trip pattern

Seasonal adjustments (June–August, Swedish summer vacation):
  day_off     26%  (vs base 5%)
  normal      54%

Long-term sick leave:  ~2% chance per simulation year that a contiguous
30–80-day sick episode occurs.  Every weekday during the episode gets
scenario "long_sick" (same behaviour as "sick", labelled separately so
analysis can distinguish short vs. long illness).

Weekends always use scenario "normal" — the household's default schedule
governs weekend car connectivity (typically low commute distance).

Reproducibility: caller passes a seed; build_scenario_map is deterministic
for a given (period, seed) combination.  The seed is stored in
simulation_runs.scenario_params so any run can be reproduced exactly.
"""
from __future__ import annotations

import random
from dataclasses import dataclass
from datetime import date, timedelta

# When a scenario keeps the car home all day, we use leave_time=LEAVE_NEVER
# so is_connected(hour, LEAVE_NEVER, 0) returns True for all hours 0–23.
LEAVE_NEVER = 24


@dataclass(frozen=True)
class ScenarioDef:
    name: str
    label: str          # Swedish description
    wake_delta: int     # offset from household wake_time
    leave_delta: int    # offset from household leave_time (ignored if car_home)
    return_delta: int   # offset from household return_time (ignored if car_home)
    sleep_delta: int    # offset from household sleep_time
    car_home: bool      # True → car never leaves, is_connected=True all day


SCENARIO_DEFS: dict[str, ScenarioDef] = {
    "normal": ScenarioDef(
        "normal", "Normal pendlardag",
        wake_delta=0, leave_delta=0, return_delta=0, sleep_delta=0,
        car_home=False,
    ),
    "wfh": ScenarioDef(
        "wfh", "Jobbar hemifrån",
        wake_delta=1, leave_delta=1, return_delta=-1, sleep_delta=0,
        car_home=True,  # car stays home → V2H available all day
    ),
    "sick": ScenarioDef(
        "sick", "Sjukdag",
        wake_delta=2, leave_delta=0, return_delta=0, sleep_delta=-1,
        car_home=True,  # car stays home
    ),
    "oversleep": ScenarioDef(
        "oversleep", "Försover sig",
        wake_delta=1, leave_delta=1, return_delta=0, sleep_delta=0,
        car_home=False,
    ),
    "overtime": ScenarioDef(
        "overtime", "Övertid",
        wake_delta=0, leave_delta=0, return_delta=2, sleep_delta=0,
        car_home=False,
    ),
    "day_off": ScenarioDef(
        "day_off", "Ledig dag",
        wake_delta=2, leave_delta=3, return_delta=-1, sleep_delta=0,
        car_home=False,
    ),
    "long_sick": ScenarioDef(
        "long_sick", "Långtidssjukskrivning",
        wake_delta=2, leave_delta=0, return_delta=0, sleep_delta=-1,
        car_home=True,
    ),
}

# ── Probability tables ────────────────────────────────────────────────────────

# Base probabilities for weekdays outside summer (sums to 1.0)
_PROBS_BASE: dict[str, float] = {
    "normal":    0.70,
    "wfh":       0.10,
    "sick":      0.05,
    "oversleep": 0.05,
    "overtime":  0.05,
    "day_off":   0.05,
}

# June–August: Swedish summer vacation period (sums to 1.0)
_PROBS_SUMMER: dict[str, float] = {
    "normal":    0.54,
    "wfh":       0.08,
    "sick":      0.03,
    "oversleep": 0.04,
    "overtime":  0.05,
    "day_off":   0.26,
}

_SUMMER_MONTHS = frozenset({6, 7, 8})


def _weekday_probs(month: int) -> dict[str, float]:
    return _PROBS_SUMMER if month in _SUMMER_MONTHS else _PROBS_BASE


def _weighted_choice(rng: random.Random, probs: dict[str, float]) -> str:
    names   = list(probs.keys())
    weights = list(probs.values())
    return rng.choices(names, weights=weights, k=1)[0]


# ── Public API ────────────────────────────────────────────────────────────────

def build_scenario_map(
    period_from: date,
    period_to: date,
    seed: int,
) -> dict[str, str]:
    """Return {YYYY-MM-DD → scenario_name} for every day in [period_from, period_to].

    Weekends use "normal" (household default schedule).
    Long-term sick leave is inserted as a contiguous block before per-day sampling.
    """
    rng = random.Random(seed)

    # Enumerate all days in period
    days: list[date] = []
    cur = period_from
    while cur <= period_to:
        days.append(cur)
        cur += timedelta(days=1)

    # Start with everyone at "normal"
    scenario_map: dict[str, str] = {d.isoformat(): "normal" for d in days}

    # Long-term sick: 2% chance if period is long enough to be meaningful
    if len(days) >= 180 and rng.random() < 0.02:
        duration  = rng.randint(30, 80)          # 30–80 days, mean ~55
        max_start = max(0, len(days) - duration)
        start_idx = rng.randint(0, max_start)
        for i in range(start_idx, min(start_idx + duration, len(days))):
            d = days[i]
            if d.weekday() < 5:                  # weekdays only
                scenario_map[d.isoformat()] = "long_sick"

    # Per-day sampling for weekdays not already assigned to long_sick
    for d in days:
        key = d.isoformat()
        if d.weekday() >= 5:
            # Weekend — keep "normal" (household default applies)
            continue
        if scenario_map[key] == "long_sick":
            # Already placed in the long-sick block
            continue
        scenario_map[key] = _weighted_choice(rng, _weekday_probs(d.month))

    return scenario_map


def effective_times(
    scenario_name: str,
    hh_wake: int,
    hh_leave: int,
    hh_return: int,
    hh_sleep: int,
) -> tuple[int, int, int, int, bool]:
    """Apply scenario deltas and return (wake, leave, return_, sleep, car_home).

    Times are clamped to 0–23.  When car_home=True, leave is set to LEAVE_NEVER
    (24) so that is_connected(hour, 24, 0) evaluates True for every hour 0–23.
    """
    s = SCENARIO_DEFS.get(scenario_name)
    if s is None:
        return hh_wake, hh_leave, hh_return, hh_sleep, False

    wake   = max(0, min(23, hh_wake  + s.wake_delta))
    sleep_ = max(0, min(23, hh_sleep + s.sleep_delta))

    if s.car_home:
        return wake, LEAVE_NEVER, 0, sleep_, True

    leave   = max(0, min(23, hh_leave  + s.leave_delta))
    return_ = max(0, min(23, hh_return + s.return_delta))
    return wake, leave, return_, sleep_, False


def scenario_summary(scenario_map: dict[str, str]) -> dict[str, int]:
    """Return {scenario_name: day_count} distribution across all days."""
    counts: dict[str, int] = {}
    for v in scenario_map.values():
        counts[v] = counts.get(v, 0) + 1
    return dict(sorted(counts.items()))
