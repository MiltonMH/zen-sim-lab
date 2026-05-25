"""
Upload data/all_areas_2025.csv to Supabase spot_prices table.

NOTE: from ~Oct 2025, elprisetjustnu.se switched to 15-minute resolution
(96 entries/day instead of 24).  This script detects that and aggregates
to hourly (mean price) before upload so the simulation engine — which
expects exactly 24 rows per day per area — works correctly.

Steps:
  1. Read CSV, aggregate any sub-hourly rows to hourly mean
  2. Delete existing 2025 rows per area  (safe re-run)
  3. Insert in batches of 500

Run after fetch_all_areas_2025.py:
    python scripts/upload_all_areas_2025.py
"""

import csv
import sys
import os
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from db import get_client

CSV_FILE    = Path("data/all_areas_2025.csv")
AREAS       = ["SE1", "SE2", "SE3", "SE4"]
BATCH_SIZE  = 500
DELETE_FROM = "2025-01-01T00:00:00+00:00"
DELETE_TO   = "2025-12-31T23:59:59+00:00"


def _hour_key(iso: str) -> str:
    """Truncate ISO timestamp to the hour, keep timezone offset.

    '2025-10-07T00:15:00+02:00' → '2025-10-07T00:00:00+02:00'
    """
    dt = datetime.fromisoformat(iso)
    return dt.replace(minute=0, second=0, microsecond=0).isoformat()


def aggregate_to_hourly(raw: list[dict]) -> list[dict]:
    """Average sub-hourly rows into one row per (area, hour).

    For already-hourly data this is a no-op (groups of 1, mean = value).
    """
    # bucket: (area, hour_key) → list of prices
    buckets: dict[tuple[str, str], list[float]] = defaultdict(list)
    for r in raw:
        key = (r["price_area"], _hour_key(r["hour"]))
        buckets[key].append(float(r["price_sek_kwh"]))

    result = []
    for (area, hour_key), prices in buckets.items():
        result.append({
            "hour":          hour_key,
            "price_sek_kwh": round(sum(prices) / len(prices), 6),
            "price_area":    area,
        })

    result.sort(key=lambda r: (r["price_area"], r["hour"]))
    return result


def main() -> None:
    if not CSV_FILE.exists():
        sys.exit(f"❌ File not found: {CSV_FILE.resolve()}\n   Run fetch_all_areas_2025.py first.")

    db         = get_client()
    created_at = datetime.now(timezone.utc).isoformat()

    # ── 1. Read + aggregate ───────────────────────────────────────────────────
    print(f"📂 Reading {CSV_FILE.resolve()}")
    raw: list[dict] = []
    with CSV_FILE.open(encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            raw.append(r)
    print(f"   {len(raw):,} raw rows")

    rows = aggregate_to_hourly(raw)
    print(f"   {len(rows):,} rows after hourly aggregation  (expected ~{365 * 24 * 4:,})")

    sub_hourly_count = len(raw) - len(rows)
    if sub_hourly_count > 0:
        print(f"   ⚠  {sub_hourly_count:,} sub-hourly entries averaged into their parent hour")

    for area in AREAS:
        area_rows = [r for r in rows if r["price_area"] == area]
        print(f"   {area}: {len(area_rows)} hourly rows")

    # ── 2. Delete existing 2025 data ─────────────────────────────────────────
    print("\n🗑  Deleting existing 2025 data in Supabase...")
    for area in AREAS:
        (
            db.table("spot_prices")
            .delete()
            .eq("price_area", area)
            .gte("hour", DELETE_FROM)
            .lte("hour", DELETE_TO)
            .execute()
        )
        print(f"   {area}: deleted")

    # ── 3. Upload in batches ──────────────────────────────────────────────────
    upload_rows = [
        {**r, "source": "elprisetjustnu", "created_at": created_at}
        for r in rows
    ]
    n_batches = (len(upload_rows) + BATCH_SIZE - 1) // BATCH_SIZE
    inserted  = 0
    errors    = 0

    print(f"\n📤 Uploading {len(upload_rows):,} rows in {n_batches} batches of {BATCH_SIZE}...")
    for i in range(0, len(upload_rows), BATCH_SIZE):
        batch     = upload_rows[i : i + BATCH_SIZE]
        batch_num = i // BATCH_SIZE + 1
        try:
            db.table("spot_prices").insert(batch).execute()
            inserted += len(batch)
            if batch_num % 10 == 0 or batch_num == n_batches:
                print(f"   Batch {batch_num:3}/{n_batches}  (total inserted {inserted:,})")
        except Exception as exc:
            errors += 1
            print(f"   ❌ Batch {batch_num} failed: {exc}")

    # ── Summary ───────────────────────────────────────────────────────────────
    print("\n" + "=" * 60)
    print(f"✅ Upload complete")
    print(f"   Inserted: {inserted:,} rows")
    print(f"   Errors:   {errors} batches")
    print()
    for area in AREAS:
        count = (
            db.table("spot_prices")
            .select("hour", count="exact")
            .eq("price_area", area)
            .gte("hour", DELETE_FROM)
            .lte("hour", DELETE_TO)
            .execute()
        )
        print(f"   {area} in Supabase: {count.count} rows  (expected ~8 760)")
    print("=" * 60)


if __name__ == "__main__":
    main()
