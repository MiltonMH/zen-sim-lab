import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, ChevronRight, Home } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  ResponsiveContainer, Legend,
} from "recharts";
import SimulationDetail from "./SimulationDetail";

interface SimRun {
  id: string; household_id: string; period_from: string; period_to: string;
  optimization_mode: string; total_saved_sek: number | null; avg_price_paid: number | null;
  scenarios: number | null; status: string | null; started_at: string | null;
  total_v2h_saving_sek: number | null; peak_hours_avoided: number | null; price_savings_sek: number | null;
  scenario_number?: number | null; scenario_params?: Record<string, number> | null;
}
interface Household {
  id: string; name: string; car_model: string | null; price_area: string | null;
  routine_type: string | null; ev_model_id: string | null;
}

type Level = { kind: "overview" } | { kind: "household"; id: string } | { kind: "simulation"; id: string };

export default function Results({ initialView: _initialView = "overview" }: { initialView?: "overview" | "households" | "logs" } = {}) {
  const [level, setLevel] = useState<Level>({ kind: "overview" });
  const [runs, setRuns] = useState<SimRun[]>([]);
  const [households, setHouseholds] = useState<Household[]>([]);
  const [evMap, setEvMap] = useState<Record<string, { v2x_capable: boolean; brand: string; model: string }>>({});
  const [logsCount, setLogsCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [{ data: r }, { data: h }, { data: ev }, { count }] = await Promise.all([
        supabase.from("simulation_runs").select("*").order("started_at", { ascending: false }),
        supabase.from("household_profiles").select("id,name,car_model,price_area,routine_type,ev_model_id"),
        supabase.from("ev_models").select("id,brand,model,v2x_capable"),
        supabase.from("optimization_logs").select("*", { count: "exact", head: true }),
      ]);
      setRuns((r ?? []) as SimRun[]);
      setHouseholds((h ?? []) as Household[]);
      const m: Record<string, any> = {};
      (ev ?? []).forEach((e: any) => { m[e.id] = e; });
      setEvMap(m);
      setLogsCount(count ?? 0);
      setLoading(false);
    })();
  }, []);

  const householdMap = useMemo(() => {
    const m: Record<string, Household> = {};
    households.forEach(h => { m[h.id] = h; });
    return m;
  }, [households]);

  if (level.kind === "simulation") {
    const sim = runs.find(r => r.id === level.id);
    return (
      <div className="space-y-4">
        <Breadcrumbs
          items={[
            { label: "Results", onClick: () => setLevel({ kind: "overview" }) },
            ...(sim ? [{ label: householdMap[sim.household_id]?.name ?? "—", onClick: () => setLevel({ kind: "household", id: sim.household_id }) }] : []),
            { label: sim ? format(new Date(sim.started_at ?? sim.period_from), "yyyy-MM-dd HH:mm") : "Simulering" },
          ]}
        />
        <SimulationDetail simulationId={level.id} onBack={() => setLevel(sim ? { kind: "household", id: sim.household_id } : { kind: "overview" })} />
      </div>
    );
  }

  if (level.kind === "household") {
    return (
      <HouseholdLevel
        household={householdMap[level.id]}
        ev={householdMap[level.id]?.ev_model_id ? evMap[householdMap[level.id].ev_model_id!] : undefined}
        runs={runs.filter(r => r.household_id === level.id)}
        onBack={() => setLevel({ kind: "overview" })}
        onPickSim={(id) => setLevel({ kind: "simulation", id })}
      />
    );
  }

  return (
    <OverviewLevel
      runs={runs}
      households={households}
      householdMap={householdMap}
      logsCount={logsCount}
      loading={loading}
      onPickHousehold={(id) => setLevel({ kind: "household", id })}
      onPickSim={(id) => setLevel({ kind: "simulation", id })}
    />
  );
}

/* ======================== LEVEL 1 ======================== */
function OverviewLevel({
  runs, households, householdMap, logsCount, loading, onPickHousehold, onPickSim,
}: {
  runs: SimRun[]; households: Household[]; householdMap: Record<string, Household>;
  logsCount: number; loading: boolean;
  onPickHousehold: (id: string) => void; onPickSim: (id: string) => void;
}) {
  const totalSaved = sum(runs.map(r => Number(r.total_saved_sek ?? 0)));
  const totalV2h = sum(runs.map(r => Number(r.total_v2h_saving_sek ?? 0)));
  const avgSaved = runs.length ? totalSaved / runs.length : 0;

  const cumulative = useMemo(() => {
    const sorted = [...runs].filter(r => r.started_at)
      .sort((a, b) => +new Date(a.started_at!) - +new Date(b.started_at!));
    let acc = 0;
    return sorted.map(r => {
      acc += Number(r.total_saved_sek ?? 0);
      return { t: format(new Date(r.started_at!), "MM-dd HH:mm"), saved: Number(acc.toFixed(2)) };
    });
  }, [runs]);

  const householdRows = useMemo(() => {
    return households.map(h => {
      const hr = runs.filter(r => r.household_id === h.id);
      const total = sum(hr.map(r => Number(r.total_saved_sek ?? 0)));
      const v2h = sum(hr.map(r => Number(r.total_v2h_saving_sek ?? 0)));
      const best = hr.reduce((m, r) => Math.max(m, Number(r.total_saved_sek ?? 0)), 0);
      const last = hr.reduce<string | null>((m, r) => {
        const t = r.started_at;
        if (!t) return m;
        return !m || t > m ? t : m;
      }, null);
      return { household: h, count: hr.length, total, v2h, best, last };
    }).sort((a, b) => b.total - a.total);
  }, [households, runs]);

  const exportAllJson = async () => {
    const { data: allLogs } = await supabase.from("optimization_logs").select("*").order("logged_at", { ascending: true });
    const payload = { exported_at: new Date().toISOString(), simulations: runs, households, decisions: allLogs ?? [] };
    downloadBlob(JSON.stringify(payload, null, 2), `zenios-all-${format(new Date(), "yyyy-MM-dd")}.json`, "application/json");
    toast.success("Exporterat som JSON");
  };
  const exportAllCsv = () => {
    const cols = ["id","household","period_from","period_to","optimization_mode","status","total_saved_sek","price_savings_sek","total_v2h_saving_sek","peak_hours_avoided","avg_price_paid","started_at"];
    const header = cols.join(",");
    const rows = runs.map(r => [
      r.id, householdMap[r.household_id]?.name ?? "", r.period_from, r.period_to,
      r.optimization_mode, r.status ?? "", r.total_saved_sek ?? "", r.price_savings_sek ?? "",
      r.total_v2h_saving_sek ?? "", r.peak_hours_avoided ?? "", r.avg_price_paid ?? "", r.started_at ?? "",
    ].map(csvCell).join(","));
    downloadBlob([header, ...rows].join("\n"), `zenios-all-${format(new Date(), "yyyy-MM-dd")}.csv`, "text/csv");
    toast.success("Exporterat som CSV");
  };

  return (
    <div className="space-y-8">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Results & Logs</h1>
          <p className="text-muted-foreground mt-1.5 text-sm">Översikt av alla simuleringar och optimeringsbeslut.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportAllJson} className="rounded-full gap-2"><Download className="h-4 w-4" /> Exportera alla (JSON)</Button>
          <Button variant="outline" onClick={exportAllCsv} className="rounded-full gap-2"><Download className="h-4 w-4" /> Exportera alla (CSV)</Button>
        </div>
      </header>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard label="Totala simuleringar" value={runs.length.toString()} />
        <StatCard label="Total besparing" value={`${totalSaved.toFixed(2)} SEK`} tone="emerald" />
        <StatCard label="Genomsnittlig besparing" value={`${avgSaved.toFixed(2)} SEK`} />
        <StatCard label="Totalt V2H" value={`${totalV2h.toFixed(2)} SEK`} tone="sky" />
        <StatCard label="Beslut loggade" value={logsCount.toString()} />
      </div>

      {/* Cumulative chart */}
      <Card className="rounded-2xl border-border/60 shadow-card p-6">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4">Ackumulerad besparing över tid</h3>
        <div className="w-full h-[280px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={cumulative}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="t" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} label={{ value: "SEK", angle: -90, position: "insideLeft", style: { fontSize: 10 } }} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Line type="monotone" dataKey="saved" name="Ackumulerat sparat" stroke="hsl(172, 66%, 34%)" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Households summary table */}
      <Card className="rounded-2xl border-border/60 shadow-card overflow-hidden">
        <div className="px-6 py-4 border-b border-border/60">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Hushåll</h3>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40">
              {["Hushåll","Simuleringar","Total sparat","Bästa simulering","V2H sparat","Senast körd",""].map(h =>
                <TableHead key={h} className="text-xs uppercase tracking-wider font-medium">{h}</TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={7} className="h-24 text-center text-sm text-muted-foreground">Laddar…</TableCell></TableRow>
            ) : householdRows.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="h-24 text-center text-sm text-muted-foreground">Inga hushåll</TableCell></TableRow>
            ) : householdRows.map(row => (
              <TableRow key={row.household.id} onClick={() => onPickHousehold(row.household.id)} className="cursor-pointer hover:bg-muted/40">
                <TableCell className="font-medium">{row.household.name}</TableCell>
                <TableCell>{row.count}</TableCell>
                <TableCell className={cn("font-semibold", row.total > 0 && "text-emerald-600")}>{row.total.toFixed(2)} SEK</TableCell>
                <TableCell>{row.best.toFixed(2)} SEK</TableCell>
                <TableCell className="text-sky-600">{row.v2h.toFixed(2)} SEK</TableCell>
                <TableCell className="text-sm text-muted-foreground">{row.last ? format(new Date(row.last), "yyyy-MM-dd HH:mm") : "—"}</TableCell>
                <TableCell><ChevronRight className="h-4 w-4 text-muted-foreground" /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {/* All simulations */}
      <Card className="rounded-2xl border-border/60 shadow-card overflow-hidden">
        <div className="px-6 py-4 border-b border-border/60">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Alla simuleringar</h3>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40">
              {["Datum","Hushåll","Period","Läge","Sparat (SEK)","V2H (SEK)","Status"].map(h =>
                <TableHead key={h} className="text-xs uppercase tracking-wider font-medium">{h}</TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={7} className="h-24 text-center text-sm text-muted-foreground">Laddar…</TableCell></TableRow>
            ) : runs.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="h-24 text-center text-sm text-muted-foreground">Inga simuleringar än</TableCell></TableRow>
            ) : runs.map(r => {
              const saved = Number(r.total_saved_sek ?? 0);
              const v2h = Number(r.total_v2h_saving_sek ?? 0);
              return (
                <TableRow key={r.id} onClick={() => onPickSim(r.id)} className="cursor-pointer hover:bg-muted/40">
                  <TableCell className="text-sm">{r.started_at ? format(new Date(r.started_at), "yyyy-MM-dd HH:mm") : "—"}</TableCell>
                  <TableCell className="text-sm">{householdMap[r.household_id]?.name ?? "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{r.period_from} → {r.period_to}</TableCell>
                  <TableCell className="text-sm capitalize">{r.optimization_mode}</TableCell>
                  <TableCell className={cn("text-sm font-semibold", saved > 0 && "text-emerald-600")}>{saved.toFixed(2)}</TableCell>
                  <TableCell className="text-sm text-sky-600">{v2h.toFixed(2)}</TableCell>
                  <TableCell><StatusPill status={r.status} /></TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

/* ======================== LEVEL 2 ======================== */
function HouseholdLevel({
  household, ev, runs, onBack, onPickSim,
}: {
  household: Household | undefined; ev?: { v2x_capable: boolean; brand: string; model: string };
  runs: SimRun[]; onBack: () => void; onPickSim: (id: string) => void;
}) {
  if (!household) {
    return (
      <div className="space-y-4">
        <Breadcrumbs items={[{ label: "Results", onClick: onBack }, { label: "Hushåll" }]} />
        <Card className="rounded-2xl p-12 text-center text-muted-foreground">Hushåll hittades inte</Card>
      </div>
    );
  }

  const totalSaved = sum(runs.map(r => Number(r.total_saved_sek ?? 0)));
  const totalV2h = sum(runs.map(r => Number(r.total_v2h_saving_sek ?? 0)));
  const best = runs.reduce((m, r) => Math.max(m, Number(r.total_saved_sek ?? 0)), 0);

  const chartData = useMemo(() =>
    [...runs].filter(r => r.started_at).sort((a, b) => +new Date(a.started_at!) - +new Date(b.started_at!))
      .map(r => ({
        t: format(new Date(r.started_at!), "MM-dd"),
        price: Number(r.price_savings_sek ?? Math.max(0, Number(r.total_saved_sek ?? 0) - Number(r.total_v2h_saving_sek ?? 0))),
        v2h: Number(r.total_v2h_saving_sek ?? 0),
      })), [runs]);

  const exportJson = () => {
    const payload = { exported_at: new Date().toISOString(), household, simulations: runs };
    downloadBlob(JSON.stringify(payload, null, 2), `zenios-${household.name}-${format(new Date(), "yyyy-MM-dd")}.json`, "application/json");
    toast.success("Exporterat som JSON");
  };
  const exportCsv = () => {
    const cols = ["id","period_from","period_to","optimization_mode","status","total_saved_sek","price_savings_sek","total_v2h_saving_sek","peak_hours_avoided","avg_price_paid","started_at"];
    const rows = runs.map(r => cols.map(c => csvCell((r as any)[c])).join(","));
    downloadBlob([cols.join(","), ...rows].join("\n"), `zenios-${household.name}-${format(new Date(), "yyyy-MM-dd")}.csv`, "text/csv");
    toast.success("Exporterat som CSV");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Breadcrumbs items={[{ label: "Results", onClick: onBack }, { label: household.name }]} />
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportJson} className="rounded-full gap-2"><Download className="h-4 w-4" /> Exportera hushåll (JSON)</Button>
          <Button variant="outline" onClick={exportCsv} className="rounded-full gap-2"><Download className="h-4 w-4" /> Exportera hushåll (CSV)</Button>
        </div>
      </div>

      {/* Header card */}
      <Card className="rounded-2xl border-border/60 shadow-card p-6">
        <div className="flex items-start gap-4 flex-wrap">
          <div className="rounded-xl bg-muted p-3"><Home className="h-5 w-5" /></div>
          <div className="flex-1">
            <h2 className="text-2xl font-semibold">{household.name}</h2>
            <div className="flex flex-wrap gap-2 mt-2 text-xs">
              {(ev || household.car_model) && <span className="rounded-full bg-muted px-2.5 py-1">{ev ? `${ev.brand} ${ev.model}` : household.car_model}</span>}
              {ev?.v2x_capable && <span className="rounded-full bg-sky-500/15 text-sky-700 px-2.5 py-1 font-semibold">V2X</span>}
              {household.price_area && <span className="rounded-full bg-muted px-2.5 py-1">{household.price_area}</span>}
              {household.routine_type && <span className="rounded-full bg-muted px-2.5 py-1 capitalize">{household.routine_type}</span>}
            </div>
          </div>
        </div>
      </Card>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Antal simuleringar" value={runs.length.toString()} />
        <StatCard label="Total besparing" value={`${totalSaved.toFixed(2)} SEK`} tone="emerald" />
        <StatCard label="Bästa simulering" value={`${best.toFixed(2)} SEK`} />
        <StatCard label="Total V2H" value={`${totalV2h.toFixed(2)} SEK`} tone="sky" />
      </div>

      {/* Chart */}
      <Card className="rounded-2xl border-border/60 shadow-card p-6">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4">Besparing per simulering</h3>
        <div className="w-full h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="t" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} label={{ value: "SEK", angle: -90, position: "insideLeft", style: { fontSize: 10 } }} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="price" name="Prisoptimering" stackId="a" fill="hsl(172, 66%, 34%)" />
              <Bar dataKey="v2h" name="V2H" stackId="a" fill="hsl(199, 89%, 48%)" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Scenario groups */}
      <ScenarioGroups runs={runs} />

      {/* Simulations table */}
      <Card className="rounded-2xl border-border/60 shadow-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40">
              {["Datum","Period","Läge","Sparat","V2H","Topptimmar undvikta","Status"].map(h =>
                <TableHead key={h} className="text-xs uppercase tracking-wider font-medium">{h}</TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="h-24 text-center text-sm text-muted-foreground">Inga simuleringar för detta hushåll</TableCell></TableRow>
            ) : runs.map(r => {
              const saved = Number(r.total_saved_sek ?? 0);
              return (
                <TableRow key={r.id} onClick={() => onPickSim(r.id)} className="cursor-pointer hover:bg-muted/40">
                  <TableCell className="text-sm">{r.started_at ? format(new Date(r.started_at), "yyyy-MM-dd HH:mm") : "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{r.period_from} → {r.period_to}</TableCell>
                  <TableCell className="text-sm capitalize">{r.optimization_mode}</TableCell>
                  <TableCell className={cn("text-sm font-semibold", saved > 0 && "text-emerald-600")}>{saved.toFixed(2)}</TableCell>
                  <TableCell className="text-sm text-sky-600">{Number(r.total_v2h_saving_sek ?? 0).toFixed(2)}</TableCell>
                  <TableCell className="text-sm">{r.peak_hours_avoided ?? 0}</TableCell>
                  <TableCell><StatusPill status={r.status} /></TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

/* ======================== Shared bits ======================== */
function Breadcrumbs({ items }: { items: { label: string; onClick?: () => void }[] }) {
  return (
    <nav className="flex items-center gap-1.5 text-sm text-muted-foreground">
      {items.map((it, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <ChevronRight className="h-3.5 w-3.5" />}
          {it.onClick ? (
            <button onClick={it.onClick} className="hover:text-foreground transition-colors">{it.label}</button>
          ) : (
            <span className="text-foreground font-medium">{it.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
function StatCard({ label, value, tone }: { label: string; value: string; tone?: "emerald" | "sky" }) {
  return (
    <Card className="rounded-2xl border-border/60 shadow-card p-5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn(
        "font-semibold text-2xl mt-2",
        tone === "emerald" && "text-emerald-600",
        tone === "sky" && "text-sky-600",
      )}>{value}</div>
    </Card>
  );
}
function StatusPill({ status }: { status: string | null }) {
  const tone = status === "completed" ? "bg-emerald-500/15 text-emerald-700"
    : status === "failed" ? "bg-destructive/15 text-destructive"
    : status === "running" ? "bg-amber-500/15 text-amber-700"
    : "bg-muted text-muted-foreground";
  return <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold capitalize", tone)}>{status ?? "—"}</span>;
}

function ScenarioGroups({ runs }: { runs: SimRun[] }) {
  const groups = useMemo(() => {
    const map = new Map<string, SimRun[]>();
    for (const r of runs) {
      if ((r.scenarios ?? 1) <= 1) continue;
      const key = `${r.period_from}__${r.period_to}__${r.optimization_mode}__${r.started_at?.slice(0, 10) ?? ""}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    return Array.from(map.entries())
      .map(([key, items]) => ({ key, items }))
      .filter(g => g.items.length > 1);
  }, [runs]);

  if (groups.length === 0) return null;

  return (
    <Card className="rounded-2xl border-border/60 shadow-card p-6 space-y-4">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Scenariegrupper</h3>
      <div className="space-y-2">
        {groups.map(g => {
          const completed = g.items.filter(i => i.status === "completed");
          const vals = completed.map(i => Number(i.total_saved_sek ?? 0));
          const best = vals.length ? Math.max(...vals) : 0;
          const worst = vals.length ? Math.min(...vals) : 0;
          const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
          const sample = g.items[0];
          return (
            <div key={g.key} className="rounded-xl border border-border/40 bg-background/60 px-4 py-3">
              <div className="text-sm">
                <span className="font-semibold">{completed.length} / {g.items.length} scenarion</span>
                <span className="text-muted-foreground"> · {sample.period_from} → {sample.period_to} · <span className="capitalize">{sample.optimization_mode}</span></span>
              </div>
              <div className="text-xs mt-1 flex flex-wrap gap-x-4 gap-y-1">
                <span className="text-emerald-600">Bäst: {best.toFixed(2)} SEK</span>
                <span className="text-destructive">Sämst: {worst.toFixed(2)} SEK</span>
                <span>Snitt: {avg.toFixed(2)} SEK</span>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/* ======================== utils ======================== */
function sum(xs: number[]) { return xs.reduce((a, b) => a + b, 0); }
function csvCell(v: any) {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
