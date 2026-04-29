ALTER TABLE public.simulation_runs
ADD COLUMN IF NOT EXISTS warnings jsonb;