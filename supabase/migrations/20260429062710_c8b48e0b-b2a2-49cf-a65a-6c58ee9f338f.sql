
CREATE TABLE public.ev_models (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  brand text NOT NULL,
  model text NOT NULL,
  battery_kwh numeric NOT NULL,
  range_km integer,
  max_charge_kw numeric,
  max_discharge_kw numeric,
  v2x_capable boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.ev_models ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read ev_models" ON public.ev_models FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert ev_models" ON public.ev_models FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update ev_models" ON public.ev_models FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated delete ev_models" ON public.ev_models FOR DELETE TO authenticated USING (true);

ALTER TABLE public.household_profiles
  ADD COLUMN ev_model_id uuid REFERENCES public.ev_models(id) ON DELETE SET NULL;
