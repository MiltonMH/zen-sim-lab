import { useEffect, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

interface SimRun {
  id: string; household_id: string; period_from: string; period_to: string;
  optimization_mode: string; total_saved_sek: number | null; avg_price_paid: number | null;
  scenarios: number | null; status: string | null;
}
interface OptLog {
  id: string; household_id: string; logged_at: string; decision: string;
  spot_price_sek: number | null; soc_pct: number | null; reason: string | null;
  charge_kw: number | null; house_consumption_kw: number | null;
  grid_draw_kw: number | null; v2h_saving_sek: number | null; combined_score: number | null;
}

const decisionStyles: Record<string, { row: string; pill: string; label: string }> = {
  charge:            { row: "bg-emerald-500/5 hover:bg-emerald-500/10", pill: "bg-emerald-500/15 text-emerald-700", label: "Charge" },
  v2h:               { row: "bg-sky-500/5 hover:bg-sky-500/10",         pill: "bg-sky-500/15 text-sky-700",         label: "V2H" },
  v2g:               { row: "bg-purple-500/5 hover:bg-purple-500/10",   pill: "bg-purple-500/15 text-purple-700",   label: "V2G" },
  pause:             { row: "bg-muted/30 hover:bg-muted/50",            pill: "bg-muted-foreground/10 text-muted-foreground", label: "Pause" },
  emergency_charge:  { row: "bg-red-500/5 hover:bg-red-500/10",         pill: "bg-red-500/15 text-red-700",         label: "Emergency" },
};

export default function Results() {
  const [runs, setRuns] = useState<SimRun[]>([]);
  const [logs, setLogs] = useState<OptLog[]>([]);
  const [householdMap, setHouseholdMap] = useState<Record<string, string>>({});
  const [loadingR, setLoadingR] = useState(true);
  const [loadingL, setLoadingL] = useState(true);
  const [errR, setErrR] = useState<string | null>(null);
  const [errL, setErrL] = useState<string | null>(null);

  useEffect(() => {
    supabase.from("household_profiles").select("id, name").then(({ data }) => {
      const map: Record<string, string> = {};
      (data ?? []).forEach((h: { id: string; name: string }) => { map[h.id] = h.name; });
      setHouseholdMap(map);
    });
    supabase.from("simulation_runs").select("*").order("started_at", { ascending: false }).limit(100)
      .then(({ data, error }) => {
        if (error) setErrR(error.message); else setRuns((data ?? []) as SimRun[]);
        setLoadingR(false);
      });
    supabase.from("optimization_logs").select("*").order("logged_at", { ascending: false }).limit(500)
      .then(({ data, error }) => {
        if (error) setErrL(error.message); else setLogs((data ?? []) as OptLog[]);
        setLoadingL(false);
      });
  }, []);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Results & Logs</h1>
        <p className="text-muted-foreground mt-1.5 text-sm">Review simulation outputs and per-decision logs.</p>
      </header>

      <Tabs defaultValue="results">
        <TabsList className="rounded-full bg-muted p-1">
          <TabsTrigger value="results" className="rounded-full px-6">Simulation results</TabsTrigger>
          <TabsTrigger value="logs" className="rounded-full px-6">Optimization logs</TabsTrigger>
        </TabsList>

        <TabsContent value="results" className="mt-6">
          <Card className="rounded-2xl border-border/60 shadow-card overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  {["ID","Household","Period","Mode","Total saved (SEK)","Avg price","Status"].map(h => (
                    <TableHead key={h} className="text-xs uppercase tracking-wider font-medium">{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingR ? (
                  <TableRow><TableCell colSpan={7} className="h-32 text-center text-sm text-muted-foreground">Loading...</TableCell></TableRow>
                ) : errR ? (
                  <TableRow><TableCell colSpan={7} className="h-32 text-center text-sm text-destructive">Error: {errR}</TableCell></TableRow>
                ) : runs.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="h-32 text-center text-sm text-muted-foreground">No results yet — run a simulation</TableCell></TableRow>
                ) : runs.map(r => {
                  const saved = r.total_saved_sek != null ? Number(r.total_saved_sek) : null;
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">{r.id.slice(0, 8)}</TableCell>
                      <TableCell className="text-sm">{householdMap[r.household_id] ?? "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{r.period_from} → {r.period_to}</TableCell>
                      <TableCell className="text-sm capitalize">{r.optimization_mode}</TableCell>
                      <TableCell className={cn("text-sm font-semibold", saved != null && saved > 0 && "text-emerald-600")}>
                        {saved != null ? saved.toFixed(2) : "—"}
                      </TableCell>
                      <TableCell className="text-sm">{r.avg_price_paid != null ? Number(r.avg_price_paid).toFixed(4) : "—"}</TableCell>
                      <TableCell><StatusPill status={r.status} /></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="logs" className="mt-6">
          <Card className="rounded-2xl border-border/60 shadow-card overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  {["Timestamp","Household","Decision","Spot price","SoC %","Reason"].map(h => (
                    <TableHead key={h} className="text-xs uppercase tracking-wider font-medium">{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingL ? (
                  <TableRow><TableCell colSpan={6} className="h-32 text-center text-sm text-muted-foreground">Loading...</TableCell></TableRow>
                ) : errL ? (
                  <TableRow><TableCell colSpan={6} className="h-32 text-center text-sm text-destructive">Error: {errL}</TableCell></TableRow>
                ) : logs.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="h-32 text-center text-sm text-muted-foreground">No optimization logs yet</TableCell></TableRow>
                ) : logs.map(l => {
                  const style = decisionStyles[l.decision] ?? decisionStyles.pause;
                  return (
                    <TableRow key={l.id} className={cn(style.row)}>
                      <TableCell className="text-sm">{format(new Date(l.logged_at), "yyyy-MM-dd HH:mm")}</TableCell>
                      <TableCell className="text-sm">{householdMap[l.household_id] ?? "—"}</TableCell>
                      <TableCell>
                        <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold", style.pill)}>
                          {style.label}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm font-mono">{l.spot_price_sek != null ? Number(l.spot_price_sek).toFixed(4) : "—"}</TableCell>
                      <TableCell className="text-sm">{l.soc_pct != null ? `${Number(l.soc_pct).toFixed(0)}%` : "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{l.reason ?? "—"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StatusPill({ status }: { status: string | null }) {
  const tone = status === "completed" ? "bg-emerald-500/15 text-emerald-700"
    : status === "failed" ? "bg-destructive/15 text-destructive"
    : status === "running" ? "bg-amber-500/15 text-amber-700"
    : "bg-muted text-muted-foreground";
  return <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold capitalize", tone)}>{status ?? "—"}</span>;
}
