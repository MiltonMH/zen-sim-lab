import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface Counts {
  spot_prices: number;
  grid_tariffs: number;
  household_profiles: number;
  simulation_runs: number;
  charging_events: number;
}

export function useCounts() {
  const [counts, setCounts] = useState<Counts>({
    spot_prices: 0,
    grid_tariffs: 0,
    household_profiles: 0,
    simulation_runs: 0,
    charging_events: 0,
  });
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const tables = ["spot_prices", "grid_tariffs", "household_profiles", "simulation_runs", "charging_events"] as const;
    const results = await Promise.all(
      tables.map((t) => supabase.from(t).select("*", { count: "exact", head: true }))
    );
    const next: Counts = { ...counts };
    tables.forEach((t, i) => { (next as any)[t] = results[i].count ?? 0; });
    setCounts(next);
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { counts, loading, refresh };
}
