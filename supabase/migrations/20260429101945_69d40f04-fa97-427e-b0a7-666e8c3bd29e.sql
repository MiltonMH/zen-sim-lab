
ALTER TABLE public.household_profiles
  ADD COLUMN IF NOT EXISTS household_type text NOT NULL DEFAULT 'training',
  ADD COLUMN IF NOT EXISTS data_quality text NOT NULL DEFAULT 'verified',
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS created_by text NOT NULL DEFAULT 'manual';

CREATE INDEX IF NOT EXISTS idx_household_profiles_type ON public.household_profiles(household_type);
CREATE INDEX IF NOT EXISTS idx_household_profiles_quality ON public.household_profiles(data_quality);
