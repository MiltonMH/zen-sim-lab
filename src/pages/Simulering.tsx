import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Play, Boxes, ArrowUpRight, Clock } from "lucide-react";
import SimulationRunner from "@/pages/SimulationRunner";
import { supabase } from "@/integrations/supabase/client";

type Mode = "single" | "bulk";

interface RecentRun {
  id: string;
  household_id: string | null;
  household_name: string;
  period_from: string;
  period_to: string;
  total_saved_sek: number | null;
  status: string | null;
  started_at: string | null;
}

function fmtSek(n: number | null | undefined) {
  if (n == null) return "—";
  return `${Number(n).toLocaleString("sv-SE", { maximumFractionDigits: 0 })} SEK`;
}

function fmtDate(s: string | null | undefined) {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("sv-SE");
}

function RecentRunsPanel() {
  const [runs, setRuns] = useState<RecentRun[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data: sims } = await supabase
      .from("simulation_runs")
      .select("id, household_id, period_from, period_to, total_saved_sek, status, started_at")
      .order("started_at", { ascending: false })
      .limit(5);
    const ids = Array.from(new Set((sims ?? []).map((s: any) => s.household_id).filter(Boolean)));
    let nameMap = new Map<string, string>();
    if (ids.length) {
      const { data: hh } = await supabase.from("household_profiles").select("id,name").in("id", ids);
      (hh ?? []).forEach((h: any) => nameMap.set(h.id, h.name));
    }
    setRuns(
      (sims ?? []).map((s: any) => ({
        ...s,
        household_name: s.household_id ? nameMap.get(s.household_id) ?? "Okänt" : "—",
      }))
    );
    setLoading(false);
  };

  useEffect(() => {
    load();
    // Realtime: refresh whenever a simulation finishes
    const ch = supabase
      .channel("simulering-recent-runs")
      .on("postgres_changes", { event: "*", schema: "public", table: "simulation_runs" }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, []);

  const open = (id: string) => {
    window.dispatchEvent(
      new CustomEvent("zen:navigate", { detail: { view: "resultat", params: { view: "overview", simulation: id } } })
    );
  };

  return (
    <Card className="rounded-2xl border-border/60 shadow-card overflow-hidden sticky top-6">
      <div className="px-4 py-3 border-b border-border/60 flex items-center gap-2">
        <Clock className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Senaste körningar</h3>
      </div>
      {loading ? (
        <div className="p-5 text-sm text-muted-foreground">Laddar…</div>
      ) : runs.length === 0 ? (
        <div className="p-5 text-sm text-muted-foreground text-center">Inga körningar ännu.</div>
      ) : (
        <div className="divide-y divide-border/60">
          {runs.map((r) => (
            <button
              key={r.id}
              onClick={() => open(r.id)}
              className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-muted/40 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{r.household_name}</div>
                <div className="text-[11px] text-muted-foreground">
                  {fmtDate(r.period_from)} – {fmtDate(r.period_to)}
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm font-medium tabular-nums text-emerald-600 dark:text-emerald-400">
                  {fmtSek(Number(r.total_saved_sek ?? 0))}
                </div>
                <div className="text-[10px] text-muted-foreground capitalize">{r.status ?? "—"}</div>
              </div>
              <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}

export default function Simulering({
  initialMode = "single",
  preselectedHouseholdId,
}: { initialMode?: Mode; preselectedHouseholdId?: string } = {}) {
  const [mode, setMode] = useState<Mode>(initialMode);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Simulering</h1>
        <p className="text-muted-foreground mt-1.5 text-sm">
          Kör enskilda simuleringar eller bulk-körningar mot dina hushåll.
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6 items-start">
        <div className="space-y-6">
          <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
            <TabsList className="rounded-full bg-muted p-1">
              <TabsTrigger value="single" className="rounded-full px-5 gap-2">
                <Play className="h-3.5 w-3.5" /> Enkel simulering
              </TabsTrigger>
              <TabsTrigger value="bulk" className="rounded-full px-5 gap-2">
                <Boxes className="h-3.5 w-3.5" /> Bulk-körning
              </TabsTrigger>
            </TabsList>

            {/* Render the existing SimulationRunner with the matching mode.
                Keying on `mode` remounts it so the inner state (and its built-in pill toggle) stays in sync. */}
            <TabsContent value="single" className="mt-6">
              <SimulationRunner
                key="single"
                initialMode="single"
                preselectedHouseholdId={preselectedHouseholdId}
                embedded
              />
            </TabsContent>
            <TabsContent value="bulk" className="mt-6">
              <SimulationRunner key="bulk" initialMode="bulk" embedded />
            </TabsContent>
          </Tabs>
        </div>

        <RecentRunsPanel />
      </div>
    </div>
  );
}
