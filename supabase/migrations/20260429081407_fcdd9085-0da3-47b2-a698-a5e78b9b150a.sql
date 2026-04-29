CREATE TABLE IF NOT EXISTS public.simulation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  simulation_id uuid REFERENCES public.simulation_runs(id) ON DELETE CASCADE,
  household_id uuid REFERENCES public.household_profiles(id) ON DELETE CASCADE,
  occurred_at timestamptz NOT NULL,
  event_type text NOT NULL,
  value_kw numeric(8,3),
  value_soc_pct numeric(5,2),
  value_price_sek numeric(8,5),
  value_sek_impact numeric(8,2),
  reason text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_simulation_events_sim_time
  ON public.simulation_events (simulation_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_simulation_events_hh_time
  ON public.simulation_events (household_id, occurred_at);

ALTER TABLE public.simulation_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read simulation_events"
  ON public.simulation_events FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert simulation_events"
  ON public.simulation_events FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update simulation_events"
  ON public.simulation_events FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated delete simulation_events"
  ON public.simulation_events FOR DELETE TO authenticated USING (true);

ALTER TABLE public.simulation_runs
  ADD COLUMN IF NOT EXISTS total_events integer NOT NULL DEFAULT 0;