import urllib.request
import json
from datetime import datetime, timedelta
import time
import os

AREAS = ['SE4']
START_DATE = datetime(2024, 1, 1)
END_DATE = datetime(2024, 12, 31)

all_prices = []
current = START_DATE
total_days = (END_DATE - START_DATE).days + 1
day_count = 0
failed_days = []

print(f"Fetching SE4 from {START_DATE.date()} to {END_DATE.date()} ({total_days} days)")

while current <= END_DATE:
    day_count += 1
    
    if day_count % 30 == 0:
        print(f"Progress: {day_count}/{total_days} days ({day_count/total_days*100:.0f}%) - Current: {current.date()}")
    
    for area in AREAS:
        url = f"https://www.elprisetjustnu.se/api/v1/prices/{current.year}/{current.month:02d}-{current.day:02d}_{area}.json"
        
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=30) as response:
                data = json.loads(response.read())
                for p in data:
                    all_prices.append({
                        'hour': p['time_start'],
                        'price_sek_kwh': p['SEK_per_kWh'],
                        'price_area': area
                    })
                print(f"  ✅ {current.date()}: {len(data)} hours")
        except Exception as e:
            print(f"  ❌ {current.date()}: {e}")
            failed_days.append(current.date())
    
    time.sleep(0.3)
    current += timedelta(days=1)

os.makedirs('data', exist_ok=True)
filename = f'data/spot_prices_SE4_2024_complete.json'
with open(filename, 'w') as f:
    json.dump(all_prices, f)

print(f"\n{'='*50}")
print(f"✅ DONE!")
print(f"   Total rows: {len(all_prices)}")
print(f"   Days with data: {len(set(p['hour'][:10] for p in all_prices))}")
print(f"   Failed days: {len(failed_days)}")
if failed_days:
    print(f"   First 10 failed: {failed_days[:10]}")
print(f"{'='*50}")
