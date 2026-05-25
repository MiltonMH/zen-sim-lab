import urllib.request
import json
from datetime import date, timedelta
import time
import os

# Areas to fetch
AREAS = ['SE1', 'SE2', 'SE3', 'SE4']

# Date range
START_DATE = date(2024, 1, 1)
END_DATE = date(2025, 12, 31)

def fetch_prices_for_day(year, month, day, area):
    url = f"https://www.elprisetjustnu.se/api/v1/prices/{year}/{month:02d}-{day:02d}_{area}.json"
    try:
        with urllib.request.urlopen(url, timeout=10) as response:
            return json.loads(response.read())
    except Exception as e:
        print(f"Error: {area} {year}-{month:02d}-{day:02d} - {e}")
        return None

# Main program
print(f"🚀 Fetching prices from {START_DATE} to {END_DATE}")
print(f"📍 Areas: {', '.join(AREAS)}")
print()

all_prices = []
current = START_DATE
total_days = (END_DATE - START_DATE).days
day_count = 0

while current <= END_DATE:
    day_count += 1
    
    # Progress every 30 days
    if day_count % 30 == 0:
        print(f"📅 {day_count}/{total_days} days completed")
    
    for area in AREAS:
        prices = fetch_prices_for_day(current.year, current.month, current.day, area)
        if prices:
            for p in prices:
                all_prices.append({
                    'hour': p['time_start'],
                    'price_sek_kwh': p['SEK_per_kWh'],
                    'price_area': area
                })
    
    # Small delay to not overload the server
    time.sleep(0.1)
    current += timedelta(days=1)

# Save to file
os.makedirs('data', exist_ok=True)

with open('data/all_spot_prices.json', 'w') as f:
    json.dump(all_prices, f, indent=2)

print()
print(f"✅ DONE! {len(all_prices)} rows saved to data/all_spot_prices.json")