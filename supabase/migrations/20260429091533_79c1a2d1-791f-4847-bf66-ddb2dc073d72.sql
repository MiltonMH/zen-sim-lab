ALTER TABLE public.optimization_logs ADD COLUMN IF NOT EXISTS simulation_id uuid;
CREATE INDEX IF NOT EXISTS idx_optimization_logs_simulation_id ON public.optimization_logs(simulation_id);
CREATE INDEX IF NOT EXISTS idx_optimization_logs_household_logged ON public.optimization_logs(household_id, logged_at);