from __future__ import annotations

from dataclasses import dataclass
from typing import Optional
from zoneinfo import ZoneInfo

from config import DEFAULT_GRID_TARIFF, DEFAULT_PEAK_TARIFF

_STOCKHOLM = ZoneInfo("Europe/Stockholm")


@dataclass
class GridTariff:
    """One row from the grid_tariffs table (energy tariff component)."""
    grid_company: str
    hour_of_day: int     # 0–23
    is_weekend: bool
    tariff_sek_kwh: float
    month_from: Optional[int] = None  # 1–12, None means all months
    month_to: Optional[int] = None

    @classmethod
    def from_row(cls, row: dict) -> GridTariff:
        return cls(
            grid_company=row["grid_company"],
            hour_of_day=int(row["hour_of_day"]),
            is_weekend=bool(row.get("is_weekend", False)),
            tariff_sek_kwh=float(row["tariff_sek_kwh"]),
            month_from=int(row["month_from"]) if row.get("month_from") is not None else None,
            month_to=int(row["month_to"]) if row.get("month_to") is not None else None,
        )


@dataclass
class GridCompanySettings:
    """One row from the grid_company_settings table."""
    grid_company: str
    has_peak_tariff: bool = True
    peak_tariff_sek_per_kw: float = DEFAULT_PEAK_TARIFF

    @classmethod
    def from_row(cls, row: dict) -> GridCompanySettings:
        return cls(
            grid_company=row["grid_company"],
            has_peak_tariff=row.get("has_peak_tariff") is not False,
            peak_tariff_sek_per_kw=float(row.get("peak_tariff_sek_per_kw") or DEFAULT_PEAK_TARIFF),
        )


def lookup_tariff(tariffs: list[GridTariff], iso: str, hour_of_day: int) -> float:
    """Return the grid energy tariff SEK/kWh for a given hour.

    Exact port of the TypeScript lookupTariff() function:
      1. Match by (hour_of_day, is_weekend, month range)
      2. Fall back: ignore is_weekend flag
      3. Fall back: match hour only
      4. Final fall back: DEFAULT_GRID_TARIFF

    Args:
        tariffs: All GridTariff rows for the relevant grid_company.
        iso:     ISO timestamp string of the hour (UTC).
        hour_of_day: Hour in Europe/Stockholm (0–23), pre-computed by caller.
    """
    if not tariffs:
        return DEFAULT_GRID_TARIFF

    from datetime import datetime
    dt = datetime.fromisoformat(iso).astimezone(_STOCKHOLM)
    month = dt.month
    is_weekend = dt.weekday() >= 5  # Saturday=5, Sunday=6

    # Month-specific rows take precedence over month-agnostic rows within each pass
    tariffs = sorted(tariffs, key=lambda t: 0 if t.month_from is not None else 1)

    def in_month(t: GridTariff) -> bool:
        if t.month_from is None or t.month_to is None:
            return True
        if t.month_from <= t.month_to:
            return t.month_from <= month <= t.month_to
        # Wraps year boundary (e.g. Oct=10 → Mar=3)
        return month >= t.month_from or month <= t.month_to

    # Pass 1: exact match (hour + weekend + month)
    for t in tariffs:
        if t.hour_of_day == hour_of_day and t.is_weekend == is_weekend and in_month(t):
            return t.tariff_sek_kwh

    # Pass 2: ignore weekend flag
    for t in tariffs:
        if t.hour_of_day == hour_of_day and in_month(t):
            return t.tariff_sek_kwh

    # Pass 3: hour only
    for t in tariffs:
        if t.hour_of_day == hour_of_day:
            return t.tariff_sek_kwh

    return DEFAULT_GRID_TARIFF
