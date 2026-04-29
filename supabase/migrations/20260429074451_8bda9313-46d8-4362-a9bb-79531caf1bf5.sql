ALTER TABLE public.simulation_runs
  ADD COLUMN IF NOT EXISTS scenario_number integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS scenario_params jsonb;