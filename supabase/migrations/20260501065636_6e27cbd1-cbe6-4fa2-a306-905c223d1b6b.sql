ALTER TABLE public.household_profiles
  ADD COLUMN IF NOT EXISTS min_soc_pct numeric(4,1) NOT NULL DEFAULT 40,
  ADD COLUMN IF NOT EXISTS max_soc_pct numeric(4,1) NOT NULL DEFAULT 80;