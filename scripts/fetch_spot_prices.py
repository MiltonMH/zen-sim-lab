"""
Hämtar spotpriser från elprisetjustnu.se
för SE1, SE2, SE4 (SE3 finns redan i Supabase)
Kör: python3 scripts/fetch_spot_prices.py
"""
import requests
import json
import time
from datetime import date, timedelta
from pathlib import Path
import os
from dotenv import load_dotenv

load_dotenv()

AREAS = ['SE1', 'SE2', 'SE4']
START_DATE = date(2024, 1, 1)
END_DATE = date(2025, 12, 31)
API_BASE = "https://www.elprisetjustnu.se/api/v1/prices"

def fetch_day(year, month, day, area):
    url = f"{API_BASE}/{year}/{month:02d}-{day:02d}_{area}.json"
    try:
        r = requests.get(url, timeout=10)
        if r.status_code == 200:
            return r.json()
        return None
    except Exception as e:
        print(f"  Fel: {e}")
        return None

def format_row(entry, area):
    return {
        'hour': entry['time_start'],
        'price_sek_kwh': entry['SEK_per_kWh'],
        'price_area': area
    }

def main():
    all_rows = []
    current = START_DATE
    total_days = (END_DATE - START_DATE).days
    done = 0

    print(f"Hamtar {', '.join(AREAS)} fran {START_DATE} till {END_DATE}")
    
    while current <= END_DATE:
        for area in AREAS:
            data = fetch_day(current.year, current.month, current.day, area)
            if data:
                for entry in data:
                    all_rows.append(format_row(entry, area))
            time.sleep(0.05)
        
        done += 1
        if done % 30 == 0:
            print(f"  {done}/{total_days} dagar ({done/total_days*100:.0f}%) - {current}")
        
        current += timedelta(days=1)

    Path('data').mkdir(exist_ok=True)
    with open('data/spot_prices_se1_se2_se4.json', 'w') as f:
        json.dump(all_rows, f)
    
    print(f"\nKlart! {len(all_rows)} rader sparade till data/spot_prices_se1_se2_se4.json")

if __name__ == '__main__':
    main()
