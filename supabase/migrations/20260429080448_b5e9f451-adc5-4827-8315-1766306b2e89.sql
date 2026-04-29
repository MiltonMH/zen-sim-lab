ALTER TABLE public.optimization_logs
  ADD COLUMN IF NOT EXISTS grid_tariff_sek numeric,
  ADD COLUMN IF NOT EXISTS energy_tax_sek numeric,
  ADD COLUMN IF NOT EXISTS total_cost_per_kwh numeric;

ALTER TABLE public.simulation_runs
  ADD COLUMN IF NOT EXISTS total_cost_with_tariff numeric,
  ADD COLUMN IF NOT EXISTS total_saved_including_tariff numeric;