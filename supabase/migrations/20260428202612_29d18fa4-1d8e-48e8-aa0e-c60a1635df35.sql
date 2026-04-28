DO $$
DECLARE
  t text;
  p text;
  tables text[] := ARRAY[
    'spot_prices',
    'grid_tariffs',
    'household_profiles',
    'virtual_chargers',
    'charging_events',
    'optimization_logs',
    'simulation_runs'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    -- Drop all existing policies on the table
    FOR p IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p, t);
    END LOOP;

    -- Ensure RLS stays enabled
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    -- Recreate authenticated-only policies
    EXECUTE format(
      'CREATE POLICY "Authenticated read %1$s" ON public.%1$I FOR SELECT TO authenticated USING (true)',
      t
    );
    EXECUTE format(
      'CREATE POLICY "Authenticated insert %1$s" ON public.%1$I FOR INSERT TO authenticated WITH CHECK (true)',
      t
    );
    EXECUTE format(
      'CREATE POLICY "Authenticated update %1$s" ON public.%1$I FOR UPDATE TO authenticated USING (true) WITH CHECK (true)',
      t
    );
    EXECUTE format(
      'CREATE POLICY "Authenticated delete %1$s" ON public.%1$I FOR DELETE TO authenticated USING (true)',
      t
    );
  END LOOP;
END $$;