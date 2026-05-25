"""Test simulation for full year 2024 directly."""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from db import get_client
from engine.simulator import run_simulation
import uuid
from datetime import datetime

# Use Familjen Nilsson - Lund
household_id = "13358d98-7c7c-49dc-b90e-d720bdb127dc"

db = get_client()

# Create simulation run for full 2024
sim_id = str(uuid.uuid4())

print(f"🚀 Creating simulation for 2024-01-01 to 2024-12-31")
print(f"   Simulation ID: {sim_id}")

db.table("simulation_runs").insert({
    "id": sim_id,
    "household_id": household_id,
    "period_from": "2024-01-01",
    "period_to": "2024-12-31",
    "optimization_mode": "smart_v2x",
    "status": "pending",
    "scenario_number": 1,
    "created_at": datetime.now().isoformat()
}).execute()

print(f"✅ Simulation created, running...")
print()

# Run simulation
result = run_simulation(sim_id)

print()
print("="*50)
print("📊 RESULTS FOR FULL YEAR 2024")
print("="*50)
print(f"Days processed: {result['days_processed']}")
print(f"Total saved: {result['total_saved_sek']:.2f} SEK")
print(f"V2H savings: {result['total_v2h_saving_sek']:.2f} SEK")
print(f"Price savings: {result['price_savings_sek']:.2f} SEK")
print(f"Peak demand saved: {result['peak_demand_saving_sek']:.2f} SEK")
print(f"Total V2H kWh: {result['total_v2h_kwh']:.2f} kWh")
print("="*50)
