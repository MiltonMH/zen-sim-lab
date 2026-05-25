"""
Fetch ALL price areas (SE1, SE2, SE3, SE4) for 2024.
Uses Session + retry logic that Claude fixed.
"""

import csv
import time
from datetime import date, timedelta
from pathlib import Path

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

AREAS = ["SE1", "SE2", "SE3", "SE4"]
START_DATE = date(2024, 1, 1)
END_DATE = date(2024, 12, 31)
OUT_FILE = Path("data/all_areas_2024.csv")

# Create data directory if it doesn't exist
OUT_FILE.parent.mkdir(exist_ok=True)

# Session with retry logic
session = requests.Session()
retry = Retry(
    total=3,
    backoff_factor=1.0,
    status_forcelist=[500, 502, 503, 504],
    allowed_methods=["GET"],
)
adapter = HTTPAdapter(max_retries=retry)
session.mount("https://", adapter)
session.headers["User-Agent"] = "ZenOS-fetcher/1.0"


def fetch_day(d: date, area: str) -> list[dict] | None:
    url = f"https://www.elprisetjustnu.se/api/v1/prices/{d.year}/{d.month:02d}-{d.day:02d}_{area}.json"
    try:
        r = session.get(url, timeout=15)
        if r.status_code == 200:
            return r.json()
        if r.status_code == 404:
            return []
        print(f"  ⚠  HTTP {r.status_code}  {area} {d}")
        return None
    except Exception as e:
        print(f"  ⚠  Error {area} {d}: {e}")
        return None


def main() -> None:
    total_days = (END_DATE - START_DATE).days + 1
    total_requests = total_days * len(AREAS)
    fetched = 0
    errors = 0
    day_idx = 0

    print(f"📊 Fetching {len(AREAS)} areas: {', '.join(AREAS)}")
    print(f"📅 {START_DATE} → {END_DATE} ({total_days} days)")
    print(f"🌐 Total API requests: {total_requests}")
    print(f"💾 Saving to: {OUT_FILE.resolve()}")
    print("-" * 60)

    with OUT_FILE.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=["hour", "price_sek_kwh", "price_area"])
        writer.writeheader()

        current = START_DATE
        while current <= END_DATE:
            day_idx += 1
            day_rows = 0

            for area in AREAS:
                rows = fetch_day(current, area)
                if rows is None:
                    errors += 1
                else:
                    for p in rows:
                        writer.writerow({
                            "hour": p["time_start"],
                            "price_sek_kwh": p["SEK_per_kWh"],
                            "price_area": area,
                        })
                        fetched += 1
                        day_rows += 1

            # Progress every 10 days
            if day_idx % 10 == 0:
                print(f"  [{day_idx:3}/{total_days}]  {current}  {day_rows} rows today  (total {fetched})")

            time.sleep(0.2)
            current += timedelta(days=1)

    print("-" * 60)
    print(f"✅ DONE!")
    print(f"   Total rows: {fetched}")
    print(f"   Expected: {total_days * 24 * len(AREAS)} rows")
    print(f"   Errors: {errors}")
    print(f"   File: {OUT_FILE.resolve()} ({OUT_FILE.stat().st_size / 1024:.0f} KB)")
    print("-" * 60)


if __name__ == "__main__":
    main()