from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from config import ARC_MAX_KW, DEFAULT_MAX_SOC, DEFAULT_MIN_SOC


@dataclass
class EVModel:
    id: str
    brand: str
    model: str
    battery_kwh: float
    max_dc_charge_kw: float = ARC_MAX_KW
    max_v2x_discharge_kw: float = ARC_MAX_KW
    v2x_capable: bool = False
    ccs2_port: bool = True

    @classmethod
    def from_row(cls, row: dict) -> EVModel:
        return cls(
            id=row["id"],
            brand=row["brand"],
            model=row["model"],
            battery_kwh=float(row["battery_kwh"]),
            max_dc_charge_kw=float(row["max_dc_charge_kw"] or ARC_MAX_KW),
            max_v2x_discharge_kw=float(row["max_v2x_discharge_kw"] or ARC_MAX_KW),
            v2x_capable=bool(row.get("v2x_capable", False)),
            # ccs2_port defaults to True when NULL (matches TS: ev.ccs2_port !== false)
            ccs2_port=row.get("ccs2_port") is not False,
        )


@dataclass
class HouseholdProfile:
    # --- required fields (no sensible universal default) ---
    id: str
    name: str
    battery_kwh: float
    daily_km: int
    price_area: str
    annual_kwh: int

    # --- optional / defaulted fields ---
    fuse_amps: int = 20
    ev_model_id: Optional[str] = None
    grid_company: Optional[str] = None
    min_soc_pct: float = DEFAULT_MIN_SOC
    max_soc_pct: float = DEFAULT_MAX_SOC
    wake_time: int = 6
    leave_time: int = 7
    return_time: int = 17
    sleep_time: int = 23
    routine_type: str = "pendlare"
    house_type: str = "villa"
    area_m2: Optional[int] = None
    build_year: Optional[int] = None
    heating_type: Optional[str] = None
    insulation_quality: Optional[str] = None
    has_solar_panels: bool = False
    solar_kwh_per_year: int = 0

    @property
    def fuse_max_kw(self) -> float:
        """3-phase Swedish residential limit: kW = A × 0.23 × 3."""
        return self.fuse_amps * 0.23 * 3

    @classmethod
    def from_row(cls, row: dict) -> HouseholdProfile:
        def _f(v, default: float) -> float:
            try:
                return float(v) if v is not None else default
            except (TypeError, ValueError):
                return default

        def _i(v, default: int) -> int:
            try:
                return int(v) if v is not None else default
            except (TypeError, ValueError):
                return default

        return cls(
            id=row["id"],
            name=row["name"],
            battery_kwh=_f(row.get("battery_kwh"), 60.0),
            daily_km=_i(row.get("daily_km"), 30),
            price_area=row.get("price_area") or "SE3",
            annual_kwh=_i(row.get("annual_kwh"), 18000),
            fuse_amps=_i(row.get("fuse_amps"), 20),
            ev_model_id=row.get("ev_model_id"),
            grid_company=row.get("grid_company"),
            min_soc_pct=_f(row.get("min_soc_pct"), DEFAULT_MIN_SOC),
            max_soc_pct=_f(row.get("max_soc_pct"), DEFAULT_MAX_SOC),
            wake_time=_i(row.get("wake_time"), 6),
            leave_time=_i(row.get("leave_time"), 7),
            return_time=_i(row.get("return_time"), 17),
            sleep_time=_i(row.get("sleep_time"), 23),
            routine_type=row.get("routine_type") or "pendlare",
            house_type=row.get("house_type") or "villa",
            area_m2=_i(row.get("area_m2"), None) if row.get("area_m2") is not None else None,
            build_year=_i(row.get("build_year"), None) if row.get("build_year") is not None else None,
            heating_type=row.get("heating_type"),
            insulation_quality=row.get("insulation_quality"),
            has_solar_panels=bool(row.get("has_solar_panels", False)),
            solar_kwh_per_year=_i(row.get("solar_kwh_per_year"), 0),
        )
