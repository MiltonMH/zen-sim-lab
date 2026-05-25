"""Run backtest on historical data for a full year."""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from db import get_client
from engine.simulator import run_simulation
import uuid
from datetime import datetime

def run_backtest(household_id: str, year: int, mode: str = "smart_v2x"):
    """Run simulation for a full year and return results."""
    
    db = get_client()
    
    # Create simulation run
    sim_id = str(uuid.uuid4())
    period_from = f"{year}-01-01"
    period_to = f"{year}-12-31"
    
    print(f"🚀 Starting backtest for {year}")
    print(f"   Mode: {mode}")
    print(f"   Period: {period_from} to {period_to}")
    
    # Insert simulation run
    db.table("simulation_runs").insert({
        "id": sim_id,
        "household_id": household_id,
        "period_from": period_from,
        "period_to": period_to,
        "optimization_mode": mode,
        "status": "pending",
        "scenario_number": 1,
        "created_at": datetime.now().isoformat()
    }).execute()
    
    # Run simulation
    result = run_simulation(sim_id)
    
    print(f"\n✅ Backtest complete for {year}!")
    print(f"   Total saved: {result['total_saved_sek']:.2f} SEK")
    print(f"   V2H savings: {result['total_v2h_saving_sek']:.2f} SEK")
    print(f"   Price savings: {result['price_savings_sek']:.2f} SEK")
    print(f"   Peak demand saved: {result['peak_demand_saving_sek']:.2f} SEK")
    print(f"   Days processed: {result['days_processed']}")
    
    return result

if __name__ == "__main__":
    # Use Familjen Nilsson - Lund
    household_id = "13358d98-7c7c-49dc-b90e-d720bdb127dc"
    
    print(f"🏠 Using household: Familjen Nilsson - Lund")
    print()
    
    # Run backtest for 2024
    result_2024 = run_backtest(household_id, 2024, "smart_v2x")
    print()
    
    # Run backtest for 2025
    result_2025 = run_backtest(household_id, 2025, "smart_v2x")
    print()
    
    # Summary
    print("="*50)
    print("📊 TOTAL SAVINGS SUMMARY")
    print("="*50)
    print(f"2024: {result_2024['total_saved_sek']:.2f} SEK")
    print(f"2025: {result_2025['total_saved_sek']:.2f} SEK")
    print(f"TOTAL: {result_2024['total_saved_sek'] + result_2025['total_saved_sek']:.2f} SEK")
    print("="*50)
