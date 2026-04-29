
ALTER TABLE public.household_profiles
  ADD COLUMN heating_type text,
  ADD COLUMN adults integer DEFAULT 2,
  ADD COLUMN children integer DEFAULT 0,
  ADD COLUMN children_ages text,
  ADD COLUMN home_during_day boolean DEFAULT false,
  ADD COLUMN routine_type text DEFAULT 'pendlare',
  ADD COLUMN wake_time integer DEFAULT 6,
  ADD COLUMN leave_time integer DEFAULT 7,
  ADD COLUMN return_time integer DEFAULT 17,
  ADD COLUMN sleep_time integer DEFAULT 23,
  ADD COLUMN build_year integer,
  ADD COLUMN insulation_quality text,
  ADD COLUMN has_solar_panels boolean DEFAULT false,
  ADD COLUMN solar_kwh_per_year integer,
  ADD COLUMN annual_kwh integer;

CREATE TABLE public.consumption_profiles (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  household_id uuid NOT NULL REFERENCES public.household_profiles(id) ON DELETE CASCADE,
  hour integer NOT NULL CHECK (hour >= 0 AND hour <= 23),
  weight numeric NOT NULL DEFAULT 1.0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (household_id, hour)
);

CREATE INDEX idx_consumption_profiles_household ON public.consumption_profiles(household_id);

ALTER TABLE public.consumption_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read consumption_profiles" ON public.consumption_profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert consumption_profiles" ON public.consumption_profiles FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update consumption_profiles" ON public.consumption_profiles FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated delete consumption_profiles" ON public.consumption_profiles FOR DELETE TO authenticated USING (true);
