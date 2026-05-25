"""
ZenOS Decision Engine - Med elprisetjustnu.se API (gratis, ingen nyckel)
"""

from datetime import datetime
import sys
import os
import requests

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from db import get_client
from config import (
    DEFAULT_SOC_EMERGENCY,
    DEFAULT_GRID_TARIFF,
    DEFAULT_MAX_SOC,
    DEFAULT_MIN_SOC,
    ENERGY_TAX_SEK,
    VAT_MULTIPLIER,
)

# Total-cost thresholds (spot + tariff + skatt + moms).
# Lägre än CHEAP_TOTAL → ladda; högre än V2H_TOTAL → ur-ladda (V2H).
CHEAP_TOTAL_PRICE: float = 0.80   # SEK/kWh
V2H_TOTAL_PRICE: float = 2.50     # SEK/kWh

class ZenOSDecisionEngine:
    def __init__(self, household_id: str):
        self.household_id = household_id
        self.supabase = get_client()
        
        # Hämta hushållets profil
        result = self.supabase.table('household_profiles').select('*').eq('id', household_id).execute()
        if not result.data:
            raise ValueError(f"Hushåll {household_id} finns inte")
        self.profile = result.data[0]
        
        # Hämta prisområde från hushållet (default SE3)
        self.price_area = self.profile.get('price_area', 'SE3')
        
        print(f"✅ ZenOS initierad för: {self.profile['name']}")
        print(f"   Prisområde: {self.price_area}")
    
    def get_current_spot_price(self) -> float | None:
        """Hämta aktuellt spotpris från elprisetjustnu.se (SEK/kWh).

        Returnerar None om API:et inte kan nås — decide() tolkar det som 'idle'
        så att vi aldrig laddar ur bilen vid okänt pris.
        """
        now = datetime.now()
        url = (
            f"https://www.elprisetjustnu.se/api/v1/prices/"
            f"{now.year}/{now.month:02d}-{now.day:02d}_{self.price_area}.json"
        )

        try:
            response = requests.get(url, timeout=10)
            response.raise_for_status()
            prices = response.json()

            current_hour = now.hour
            for price_data in prices:
                hour = int(price_data['time_start'].split('T')[1].split(':')[0])
                if hour == current_hour:
                    price_sek = price_data['SEK_per_kWh']
                    print(f"📡 Spotpris: {price_sek:.3f} SEK/kWh")
                    return price_sek

            # Aktuell timme ej funnen — ta senast tillgängliga
            price_sek = prices[-1]['SEK_per_kWh']
            print(f"📡 Spotpris (senast tillgängliga): {price_sek:.3f} SEK/kWh")
            return price_sek

        except requests.exceptions.RequestException as e:
            print(f"⚠️ API-anrop misslyckades: {e}")
            return None
    
    def get_current_tariff(self) -> float:
        """Hämta aktuell nättariff från Supabase"""
        now = datetime.now()
        result = self.supabase.table('grid_tariffs').select('tariff_sek_kwh')\
            .eq('grid_company', self.profile['grid_company'])\
            .eq('hour_of_day', now.hour)\
            .eq('is_weekend', now.weekday() >= 5)\
            .execute()
        
        tariff = result.data[0]['tariff_sek_kwh'] if result.data else DEFAULT_GRID_TARIFF
        print(f"📡 Nättariff: {tariff:.3f} SEK/kWh")
        return tariff
    
    def get_current_soc(self) -> float:
        """Hämta aktuell batterinivå"""
        result = self.supabase.table('virtual_chargers').select('current_soc').eq('household_id', self.household_id).execute()
        return result.data[0]['current_soc'] if result.data else 50.0
    
    def decide(self) -> dict:
        """Fatta beslut baserat på spotpris + nättariff."""
        spot_price = self.get_current_spot_price()
        soc = self.get_current_soc()

        # Okänt pris → gör ingenting (säkert fallback)
        if spot_price is None:
            return {'decision': 'idle', 'reason': 'Spotpris okänt – väntar'}

        grid_tariff = self.get_current_tariff()
        total_price = (spot_price + grid_tariff + ENERGY_TAX_SEK) * VAT_MULTIPLIER

        max_soc = self.profile.get('max_soc_pct', DEFAULT_MAX_SOC)
        min_soc = self.profile.get('min_soc_pct', DEFAULT_MIN_SOC)

        print(f"📊 Totalpris: {total_price:.3f} SEK/kWh, SOC: {soc:.1f}%")
        print(f"   (Spot: {spot_price:.3f} + Tariff: {grid_tariff:.3f} + Skatt: {ENERGY_TAX_SEK:.3f}) × moms {VAT_MULTIPLIER}")

        # Nödladdning — alltid, oavsett pris
        if soc < DEFAULT_SOC_EMERGENCY:
            return {'decision': 'charge', 'reason': f'Nödladdning! SOC {soc:.0f}% under {DEFAULT_SOC_EMERGENCY:.0f}%'}

        # Ladda vid lågt totalpris
        if total_price < CHEAP_TOTAL_PRICE and soc < max_soc:
            return {'decision': 'charge', 'reason': f'Billigt pris: {total_price:.2f} SEK/kWh'}

        # V2H vid högt totalpris
        if total_price > V2H_TOTAL_PRICE and soc > min_soc:
            return {'decision': 'v2h', 'reason': f'Dyrt pris: {total_price:.2f} SEK/kWh – använder bilbatteriet'}

        return {'decision': 'idle', 'reason': f'Pris {total_price:.2f} SEK/kWh, SOC {soc:.0f}% – väntar'}


# ---------- TEST ----------
if __name__ == "__main__":
    print("=" * 50)
    print("ZenOS Decision Engine - Test med elprisetjustnu.se")
    print("=" * 50)
    
    supabase = get_client()
    result = supabase.table('household_profiles').select('id', 'name').limit(1).execute()
    
    if not result.data:
        print("❌ Inga hushåll hittades i databasen!")
        print("   Skapa först ett hushåll i household_profiles-tabellen.")
    else:
        household_id = result.data[0]['id']
        household_name = result.data[0]['name']
        
        engine = ZenOSDecisionEngine(household_id)
        decision = engine.decide()
        
        print(f"\n🏠 Hushåll: {household_name}")
        print(f"🎯 BESLUT: {decision['decision'].upper()}")
        print(f"📝 {decision['reason']}")