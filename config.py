# Engine constants — ported from run-simulation.ts and DATA_CONTRACT.md
# Keep in sync with the TypeScript source; these are the single source of truth
# for the Python reimplementation.

ARC_MAX_KW: float = 11.0          # Arc hardware max (DC, both directions)
TARGET_CHARGE_HOURS: int = 8       # hours/day to charge in basic/smart modes
KM_PER_PCT: int = 5                # ~5 km per % battery (rough)
PEAK_HOURS: frozenset[int] = frozenset({17, 18, 19, 20})  # V2H window for legacy modes

DEFAULT_HARD_MAX_PRICE: float = 2.0   # SEK/kWh hard price cap
TOO_CHEAP_PRICE: float = 0.20         # SEK/kWh — always charge below this
DEFAULT_SOC_EMERGENCY: float = 20.0   # % SoC floor before emergency charge triggers

SOC_PROTECT: float = 95.0     # never charge above this in legacy modes
SOC_HEALTH_MAX: float = 90.0  # hard battery-health ceiling (used in emergency backfill)
DEFAULT_MAX_SOC: float = 80.0 # smart_v2x default charge ceiling (per-household override)
DEFAULT_MIN_SOC: float = 40.0 # smart_v2x default V2H floor (per-household override)

KM_PER_KWH_BASELINE: float = 6.0  # ~6 km per kWh (baseline drive efficiency)
ENERGY_TAX_SEK: float = 0.549     # Sweden 2025 energy tax SEK/kWh
VAT_MULTIPLIER: float = 1.25      # 25% moms
DEFAULT_GRID_TARIFF: float = 0.30 # fallback SEK/kWh when no tariff configured
DEFAULT_PEAK_TARIFF: float = 55.0 # SEK/kW/month fallback peak demand fee
DC_EFFICIENCY: float = 0.95       # DC charge/discharge efficiency, both directions

# Minimum required spread above avg charge cost for V2H to activate
V2H_MARGIN_SEK: float = 0.10

# Default pendlare-style consumption weights for hours 0–23.
# sum ≈ 24 (normalised so avg weight = 1.0 over a day).
# Used when household has no consumption_profiles rows in the database.
DEFAULT_WEIGHTS: list[float] = [
    0.3, 0.3, 0.3, 0.3, 0.3, 0.3,        # 0–5   night / sleeping
    1.0, 2.0, 1.2, 1.0, 1.0, 1.0,        # 6–11  morning peak then daytime away
    1.0, 1.0, 1.0, 1.0, 1.2,             # 12–16 daytime away / light use
    2.2, 2.4, 2.2, 2.0, 1.5, 1.0, 0.6,  # 17–23 evening peak
]

assert len(DEFAULT_WEIGHTS) == 24, "DEFAULT_WEIGHTS must have exactly 24 entries"
