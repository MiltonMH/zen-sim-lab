-- Helper function for updated_at triggers
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- 1) Rename existing optimization_mode values
UPDATE public.simulation_runs SET optimization_mode = 'smart_charge_basic' WHERE optimization_mode = 'level1';
UPDATE public.simulation_runs SET optimization_mode = 'smart_charge'       WHERE optimization_mode = 'level2';
UPDATE public.simulation_runs SET optimization_mode = 'smart_v2x'          WHERE optimization_mode = 'level3';

-- 2) New columns on simulation_runs
ALTER TABLE public.simulation_runs
  ADD COLUMN IF NOT EXISTS peak_demand_saving_sek numeric(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS peaks_avoided_count    integer       DEFAULT 0;

-- 3) Fuse size on household_profiles
ALTER TABLE public.household_profiles
  ADD COLUMN IF NOT EXISTS fuse_amps integer DEFAULT 20;

-- 4) CCS2 + DC fields on ev_models
ALTER TABLE public.ev_models
  ADD COLUMN IF NOT EXISTS ccs2_port            boolean       DEFAULT true,
  ADD COLUMN IF NOT EXISTS max_dc_charge_kw     numeric(6,1)  DEFAULT 11,
  ADD COLUMN IF NOT EXISTS max_v2x_discharge_kw numeric(6,1)  DEFAULT 11;

-- 5) Grid company settings (peak tariff)
CREATE TABLE IF NOT EXISTS public.grid_company_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grid_company text NOT NULL UNIQUE,
  peak_tariff_sek_per_kw numeric(6,2) NOT NULL DEFAULT 55,
  has_peak_tariff boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.grid_company_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read grid_company_settings"
  ON public.grid_company_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert grid_company_settings"
  ON public.grid_company_settings FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update grid_company_settings"
  ON public.grid_company_settings FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated delete grid_company_settings"
  ON public.grid_company_settings FOR DELETE TO authenticated USING (true);

DROP TRIGGER IF EXISTS update_grid_company_settings_updated_at ON public.grid_company_settings;
CREATE TRIGGER update_grid_company_settings_updated_at
  BEFORE UPDATE ON public.grid_company_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed known Swedish grid operators
INSERT INTO public.grid_company_settings (grid_company, peak_tariff_sek_per_kw) VALUES
  ('Göteborg Energi Nät', 58),
  ('Vattenfall Eldistribution', 63),
  ('E.ON Energidistribution', 55),
  ('Ellevio', 61),
  ('Jämtkraft Elnät', 45),
  ('Kraftringen Nät', 52),
  ('Luleå Energi Elnät', 38),
  ('Skellefteå Kraft Elnät', 41),
  ('Umeå Energi Elnät', 43)
ON CONFLICT (grid_company) DO NOTHING;