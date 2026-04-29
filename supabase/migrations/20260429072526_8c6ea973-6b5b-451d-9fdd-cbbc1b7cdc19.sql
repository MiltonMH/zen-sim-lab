
ALTER TABLE public.optimization_logs
  ADD COLUMN IF NOT EXISTS charge_kw numeric,
  ADD COLUMN IF NOT EXISTS house_consumption_kw numeric,
  ADD COLUMN IF NOT EXISTS grid_draw_kw numeric,
  ADD COLUMN IF NOT EXISTS v2h_saving_sek numeric,
  ADD COLUMN IF NOT EXISTS combined_score numeric;

ALTER TABLE public.simulation_runs
  ADD COLUMN IF NOT EXISTS total_v2h_kwh numeric,
  ADD COLUMN IF NOT EXISTS total_v2h_saving_sek numeric,
  ADD COLUMN IF NOT EXISTS peak_hours_avoided integer,
  ADD COLUMN IF NOT EXISTS price_savings_sek numeric;
