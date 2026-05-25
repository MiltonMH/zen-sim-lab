from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime


@dataclass
class SpotPrice:
    """One row from the spot_prices table."""
    hour: datetime       # start of hour, UTC
    price_area: str      # SE1 / SE2 / SE3 / SE4
    price_sek_kwh: float

    @classmethod
    def from_row(cls, row: dict) -> SpotPrice:
        hour = row["hour"]
        if isinstance(hour, str):
            hour = datetime.fromisoformat(hour)
        return cls(
            hour=hour,
            price_area=row["price_area"],
            price_sek_kwh=float(row["price_sek_kwh"]),
        )


@dataclass
class DayHour:
    """Per-hour DTO used inside the engine for one simulated hour.

    Built by the simulator from a SpotPrice row + consumption weight.
    total_cost and combined_score are pre-computed so decision.py and
    planner.py never need to repeat the arithmetic.
    """
    iso: str            # original ISO timestamp string (UTC) — used as dict key
    hour_of_day: int    # 0–23 in Europe/Stockholm timezone
    price: float        # spot price SEK/kWh
    weight: float       # consumption weight 0–~2.4 (from consumption_profiles or DEFAULT_WEIGHTS)
    grid_tariff: float  # SEK/kWh grid energy tariff for this hour
    # (spot + grid_tariff + ENERGY_TAX_SEK) * VAT_MULTIPLIER
    total_cost: float
    # price_score * 0.7 + cons_score * 0.3  (used by smart_charge mode ranking)
    combined_score: float
