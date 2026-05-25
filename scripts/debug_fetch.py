"""
Debuggad version av spotpris-hämtaren.

Tre fixes jämfört med originalscriptet:
  1. requests.Session()   → återanvänder TCP/TLS-anslutning
  2. Retry med backoff    → försöker 3 gånger vid fel innan den ger upp
  3. Progress per dag     → du ser att scriptet faktiskt kör

Kör: python scripts/debug_fetch.py
"""

import csv
import time
from datetime import date, timedelta
from pathlib import Path

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

AREAS      = ["SE4"]
START_DATE = date(2024, 1, 1)
END_DATE   = date(2024, 12, 31)
OUT_FILE   = Path("debug_prices.csv")

# ── Fix 1: Session + retry-adapter ──────────────────────────────────────────
# Utan Session öppnas en ny TCP+TLS-anslutning för varje anrop.
# Efter ~100 anrop börjar OS:et throttla nya sockets (TIME_WAIT).
# Retry-adaptern försöker automatiskt 3 gånger vid connection-fel.

session = requests.Session()
retry = Retry(
    total=3,
    backoff_factor=1.0,        # väntar 1s, 2s, 4s mellan försök
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
            return []   # dag ej publicerad — inget fel
        print(f"  ⚠  HTTP {r.status_code}  {url}")
        return None
    except requests.exceptions.Timeout:
        print(f"  ⚠  Timeout (15s)  {url}")
        return None
    except requests.exceptions.ConnectionError as e:
        print(f"  ⚠  Anslutningsfel: {e}  {url}")
        return None
    except ValueError:
        print(f"  ⚠  JSON-parse-fel (tom eller HTML-svar?)  {url}")
        return None


def main() -> None:
    total_days = (END_DATE - START_DATE).days + 1
    fetched = 0
    errors  = 0
    day_idx = 0

    print(f"Hämtar {', '.join(AREAS)}  {START_DATE} → {END_DATE}  ({total_days} dagar)")
    print(f"Sparar till: {OUT_FILE.resolve()}")
    print("-" * 50)

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
                            "hour":          p["time_start"],
                            "price_sek_kwh": p["SEK_per_kWh"],
                            "price_area":    area,
                        })
                        fetched  += 1
                        day_rows += 1

            # ── Fix 3: progress per dag ──────────────────────────────────────
            # Utan detta ser scriptet "fastnat" — viktigt för att veta att det kör.
            status = f"{day_rows} rader" if day_rows else "0 rader (404?)"
            print(f"  [{day_idx:3}/{total_days}]  {current}  {status}  (totalt {fetched})")

            time.sleep(0.2)
            current += timedelta(days=1)

    print("-" * 50)
    print(f"Klart!  {fetched} rader  |  {errors} felande anrop")
    print(f"Fil: {OUT_FILE.resolve()}  ({OUT_FILE.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
