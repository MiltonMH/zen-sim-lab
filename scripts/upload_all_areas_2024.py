"""Upload all areas CSV to Supabase."""
import csv
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from db import get_client

def upload_all_areas():
    supabase = get_client()
    csv_path = 'data/all_areas_2024.csv'
    
    # Read CSV file
    data = {area: [] for area in ['SE1', 'SE2', 'SE3', 'SE4']}
    
    with open(csv_path, 'r') as f:
        reader = csv.DictReader(f)
        for row in reader:
            area = row['price_area']
            data[area].append({
                'hour': row['hour'],
                'price_sek_kwh': float(row['price_sek_kwh']),
                'price_area': area
            })
    
    print(f"📁 Loaded data:")
    for area in data:
        print(f"   {area}: {len(data[area])} rows")
    
    # Upload each area
    for area in data:
        print(f"\n📤 Uploading {area}...")
        
        # Delete existing data for this area in 2024
        supabase.table('spot_prices').delete()\
            .eq('price_area', area)\
            .gte('hour', '2024-01-01')\
            .lt('hour', '2025-01-01')\
            .execute()
        
        print(f"   🗑️ Deleted old {area} 2024 data")
        
        # Upload in batches
        batch_size = 500
        total = 0
        for i in range(0, len(data[area]), batch_size):
            batch = data[area][i:i+batch_size]
            supabase.table('spot_prices').insert(batch).execute()
            total += len(batch)
            print(f"   ✅ Batch {i//batch_size + 1}: {len(batch)} rows")
        
        print(f"   🎉 {area}: {total} rows uploaded")
    
    print(f"\n{'='*50}")
    print(f"✅ ALL DONE!")
    print(f"   SE1: {len(data['SE1'])} rows")
    print(f"   SE2: {len(data['SE2'])} rows")
    print(f"   SE3: {len(data['SE3'])} rows")
    print(f"   SE4: {len(data['SE4'])} rows")
    print(f"   TOTAL: {sum(len(d) for d in data.values())} rows")
    print(f"{'='*50}")

if __name__ == "__main__":
    upload_all_areas()