from db import get_client
from config import *

def test_connection():
    try:
        supabase = get_client()
        print("✅ Ansluten till Supabase!")
        
        # Testa att läsa från spot_prices
        result = supabase.table('spot_prices').select('*').limit(1).execute()
        print(f"✅ Kan läsa från spot_prices: {len(result.data)} rader")
        
        # Testa grid_tariffs
        result = supabase.table('grid_tariffs').select('*').limit(1).execute()
        print(f"✅ Kan läsa från grid_tariffs: {len(result.data)} rader")
        
        print("✅ Allt fungerar!")
        
    except Exception as e:
        print(f"❌ Fel: {e}")

if __name__ == "__main__":
    test_connection()