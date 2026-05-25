"""
Hämtar historiska spotpriser för SE1–SE4 från elprisetjustnu.se och
sparar som CSV redo för Supabase-import.

Täcker: 2024-01-01 → 2025-12-31 (~70 080 rader)

Kör:
    pip install requests
    python scripts/fetch_spot_prices_csv.py
"""

import csv
import time
import sys
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import requests

# ── Konfiguration ────────────────────────────────────────────────────────────

AREAS       = ["SE1", "SE2", "SE3", "SE4"]
START_DATE  = date(2024, 1, 1)
END_DATE    = date(2025, 12, 31)
API_BASE    = "https://www.elprisetjustnu.se/api/v1/prices"
DELAY_S     = 0.20   # sekunder mellan API-anrop
OUT_FILE    = Path(__file__).parent.parent / "spot_prices_all_areas_20240101_to_20251231.csv"

CSV_COLUMNS = ["hour", "price_sek_kwh", "price_area", "source", "created_at"]

# ── API ──────────────────────────────────────────────────────────────────────

def fetch_day(d: date, area: str) -> list[dict] | None:
    url = f"{API_BASE}/{d.year}/{d.month:02d}-{d.day:02d}_{area}.json"
    try:
        r = requests.get(url, timeout=15)
        if r.status_code == 200:
            return r.json()
        if r.status_code == 404:
            return []          # dag ej publicerad än
        print(f"  ⚠  HTTP {r.status_code} — {url}", flush=True)
        return None
    except requests.exceptions.Timeout:
        print(f"  ⚠  Timeout — {url}", flush=True)
        return None
    except requests.exceptions.RequestException as exc:
        print(f"  ⚠  {exc} — {url}", flush=True)
        return None


# ── Huvudfunktion ────────────────────────────────────────────────────────────

def main() -> None:
    total_days  = (END_DATE - START_DATE).days + 1
    created_at  = datetime.now(timezone.utc).isoformat()
    fetched     = 0
    errors      = 0
    area_counts: dict[str, int] = defaultdict(int)
    area_min:    dict[str, float] = {}
    area_max:    dict[str, float] = {}

    print("=" * 62)
    print("ZenOS — Spot price fetcher")
    print(f"Område:  {', '.join(AREAS)}")
    print(f"Period:  {START_DATE} → {END_DATE}  ({total_days} dagar)")
    print(f"Utfil:   {OUT_FILE}")
    print(f"Fördröj: {DELAY_S} s/anrop  (~{total_days * len(AREAS) * DELAY_S / 60:.0f} min totalt)")
    print("=" * 62, flush=True)

    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)

    with OUT_FILE.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=CSV_COLUMNS)
        writer.writeheader()

        current   = START_DATE
        day_index = 0

        while current <= END_DATE:
            day_index += 1
            day_fetched = 0

            for area in AREAS:
                rows = fetch_day(current, area)
                if rows is None:
                    errors += 1
                    time.sleep(DELAY_S)
                    continue

                for entry in rows:
                    price = float(entry["SEK_per_kWh"])
                    writer.writerow({
                        "hour":          entry["time_start"],
                        "price_sek_kwh": round(price, 6),
                        "price_area":    area,
                        "source":        "elprisetjustnu",
                        "created_at":    created_at,
                    })
                    fetched += 1
                    day_fetched += 1
                    area_counts[area] += 1

                    # Löpande min/max per område
                    if area not in area_min or price < area_min[area]:
                        area_min[area] = price
                    if area not in area_max or price > area_max[area]:
                        area_max[area] = price

                time.sleep(DELAY_S)

            # Progress — skriv varje dag så man ser det rulla
            pct  = day_index / total_days * 100
            bar  = "#" * (day_index * 30 // total_days)
            line = f"\r  [{bar:<30}] {pct:5.1f}%  {current}  {fetched:>7} rader"
            sys.stdout.write(line)
            sys.stdout.flush()

            current += timedelta(days=1)

    print()   # newline efter progress-raden
    print()

    # ── Sammanfattning ────────────────────────────────────────────────────────
    print("=" * 62)
    print(f"Klart!  {fetched:,} rader sparade  ({errors} felande anrop)")
    print()
    print(f"{'Område':<8} {'Rader':>8}  {'Min SEK/kWh':>13}  {'Max SEK/kWh':>13}")
    print("-" * 48)
    for area in AREAS:
        lo = f"{area_min.get(area, 0):.4f}" if area in area_min else "–"
        hi = f"{area_max.get(area, 0):.4f}" if area in area_max else "–"
        print(f"{area:<8} {area_counts[area]:>8}  {lo:>13}  {hi:>13}")
    print("=" * 62)
    print(f"\nFil: {OUT_FILE}")
    print(f"Storlek: {OUT_FILE.stat().st_size / 1024 / 1024:.1f} MB")


if __name__ == "__main__":
    main()
