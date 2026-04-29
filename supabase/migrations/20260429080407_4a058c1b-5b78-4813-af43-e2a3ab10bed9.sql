CREATE TABLE IF NOT EXISTS public.grid_tariff_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name text NOT NULL,
  org_number text,
  api_url text NOT NULL,
  price_area text,
  last_fetched timestamptz,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.grid_tariff_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read grid_tariff_sources"
  ON public.grid_tariff_sources FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert grid_tariff_sources"
  ON public.grid_tariff_sources FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update grid_tariff_sources"
  ON public.grid_tariff_sources FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated delete grid_tariff_sources"
  ON public.grid_tariff_sources FOR DELETE TO authenticated USING (true);

ALTER TABLE public.grid_tariffs
  ADD COLUMN IF NOT EXISTS source_id uuid REFERENCES public.grid_tariff_sources(id),
  ADD COLUMN IF NOT EXISTS tariff_type text DEFAULT 'energy',
  ADD COLUMN IF NOT EXISTS month_from int,
  ADD COLUMN IF NOT EXISTS month_to int,
  ADD COLUMN IF NOT EXISTS season text,
  ADD COLUMN IF NOT EXISTS fixed_fee_sek_month numeric(8,2),
  ADD COLUMN IF NOT EXISTS peak_fee_sek_kw numeric(8,2),
  ADD COLUMN IF NOT EXISTS raw_response jsonb;

CREATE INDEX IF NOT EXISTS idx_grid_tariffs_lookup
  ON public.grid_tariffs (grid_company, hour_of_day, is_weekend, month_from, month_to);