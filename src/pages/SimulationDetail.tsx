import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ArrowLeft, Download, ChevronDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  ComposedChart, Line, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Legend, ReferenceLine,
} from "recharts";

interface Props { simulationId: string; onBack: () => void }
const PAGE_SIZE = 50;

const decisionStyles: Record<string, { row: string; pill: string; label: string }> = {
  charge:           { row: "bg-emerald-500/5 hover:bg-emerald-500/10", pill: "bg-emerald-500/15 text-emerald-700", label: "Charge" },
  v2h:              { row: "bg-sky-500/5 hover:bg-sky-500/10",         pill: "bg-sky-500/15 text-sky-700",         label: "V2H" },
  v2g:              { row: "bg-purple-500/5 hover:bg-purple-500/10",   pill: "bg-purple-500/15 text-purple-700",   label: "V2G" },
  pause:            { row: "bg-muted/30 hover:bg-muted/50",            pill: "bg-muted-foreground/10 text-muted-foreground", label: "Pause" },
  emergency_charge: { row: "bg-red-500/5 hover:bg-red-500/10",         pill: "bg-red-500/15 text-red-700",         label: "Emergency" },
};

export default function SimulationDetail({ simulationId, onBack }: Props) {
  const [sim, setSim] = useState<any | null>(null);
  const [household, setHousehold] = useState<any | null>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      const { data: s } = await supabase.from("simulation_runs").select("*").eq("id", simulationId).maybeSingle();
      if (!active) return;
      setSim(s);
      if (s?.household_id) {
        const { data: h } = await supabase.from("household_profiles").select("*").eq("id", s.household_id).maybeSingle();
        if (active) setHousehold(h);
      }
      if (s) {
        const fromIso = `${s.period_from}T00:00:00+00:00`;
        const toIso = `${s.period_to}T23:59:59+00:00`;
        const { data: l } = await supabase.from("optimization_logs").select("*")
          .eq("household_id", s.household_id).gte("logged_at", fromIso).lte("logged_at", toIso)
          .order("logged_at", { ascending: true });
        if (active) setLogs(l ?? []);
      }
      setLoading(false);
    })();
    return () => { active = false; };
  }, [simulationId]);

  if (loading || !sim) {
    return (
      <div className="space-y-4">
        <BackButton onBack={onBack} />
        <Card className="rounded-2xl p-12 text-center text-muted-foreground">Laddar simulering…</Card>
      </div>
    );
  }

  const summary = buildSummary(sim, logs);

  // ---- exports ----
  const fileBase = `zenios-simulation-${simulationId.slice(0, 8)}-${format(new Date(), "yyyy-MM-dd")}`;
  const downloadCsv = () => {
    const cols = ["logged_at","decision","spot_price_sek","soc_pct","charge_kw","house_consumption_kw","grid_draw_kw","v2h_saving_sek","combined_score","reason"];
    const header = cols.join(",");
    const rows = logs.map(l => cols.map(c => csvCell(l[c])).join(","));
    downloadBlob([header, ...rows].join("\n"), `${fileBase}.csv`, "text/csv");
  };
  const downloadJson = () => {
    const payload = { simulation: sim, household, decisions: logs, summary };
    downloadBlob(JSON.stringify(payload, null, 2), `${fileBase}.json`, "application/json");
  };
  const copySummary = async () => {
    const txt = `ZenOS Simulering — ${household?.name ?? "—"}
Period: ${sim.period_from} - ${sim.period_to}
Optimeringsläge: ${sim.optimization_mode}
Total besparing: ${num(sim.total_saved_sek)} SEK
  - Prisoptimering: ${num(sim.price_savings_sek)} SEK
  - V2H: ${num(sim.total_v2h_saving_sek)} SEK
Genomsnittspris betalt: ${(Number(sim.avg_price_paid ?? 0) * 100).toFixed(1)} öre/kWh
Topptimmar undvikta: ${sim.peak_hours_avoided ?? 0} st
Laddade kWh: ${summary.total_charge_kwh.toFixed(1)}
V2H kWh: ${num(sim.total_v2h_kwh)}
Beslut loggade: ${logs.length}`;
    await navigator.clipboard.writeText(txt);
    toast.success("Sammanfattning kopierad!");
  };

  // ---- chart data ----
  const chartData = logs.map(l => ({
    t: format(new Date(l.logged_at), "MM-dd HH:mm"),
    price: Number(l.spot_price_sek ?? 0),
    charge: l.decision === "charge" || l.decision === "emergency_charge" ? Number(l.charge_kw ?? 0) : 0,
    v2h: l.decision === "v2h" ? -Math.abs(Number(l.charge_kw ?? 0)) : 0,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <BackButton onBack={onBack} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="rounded-full gap-2"><Download className="h-4 w-4" /> Exportera data <ChevronDown className="h-3 w-3" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={downloadCsv}>Ladda ner CSV</DropdownMenuItem>
            <DropdownMenuItem onClick={downloadJson}>Ladda ner JSON</DropdownMenuItem>
            <DropdownMenuItem onClick={copySummary}>Kopiera sammanfattning</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Overview */}
      <Card className="rounded-2xl border-border/60 shadow-card p-6 space-y-5">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-2xl font-semibold">{household?.name ?? "—"}</h2>
            <p className="text-sm text-muted-foreground mt-1">
              {sim.period_from} → {sim.period_to} · <span className="capitalize">{sim.optimization_mode}</span>
            </p>
          </div>
          <StatusPill status={sim.status} />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Total besparing" value={`${num(sim.total_saved_sek)} SEK`} highlight />
          <Stat label="Prisoptimering" value={`${num(sim.price_savings_sek)} SEK`} />
          <Stat label="V2H sparat" value={`${num(sim.total_v2h_saving_sek)} SEK`} />
          <Stat label="Topptimmar undvikta" value={`${sim.peak_hours_avoided ?? 0}`} />
          <Stat label="Snittpris betalt" value={`${(Number(sim.avg_price_paid ?? 0)).toFixed(3)} SEK/kWh`} />
          <Stat label="kWh laddat" value={summary.total_charge_kwh.toFixed(1)} />
          <Stat label="V2H kWh" value={num(sim.total_v2h_kwh)} />
          <Stat label="Beslut" value={logs.length.toString()} />
        </div>
      </Card>

      {/* Savings breakdown stacked bar */}
      <SavingsBreakdownBar
        price={Number(sim.price_savings_sek ?? Math.max(0, Number(sim.total_saved_sek ?? 0) - Number(sim.total_v2h_saving_sek ?? 0)))}
        v2h={Number(sim.total_v2h_saving_sek ?? 0)}
      />

      {/* Chart */}
      <Card className="rounded-2xl border-border/60 shadow-card p-6">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4">Spotpris vs laddningsbeslut</h3>
        <div className="w-full h-[320px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="t" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis yAxisId="left" tick={{ fontSize: 10 }} label={{ value: "SEK/kWh", angle: -90, position: "insideLeft", style: { fontSize: 10 } }} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} label={{ value: "kW", angle: 90, position: "insideRight", style: { fontSize: 10 } }} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <ReferenceLine yAxisId="left" y={1.0} stroke="hsl(0, 72%, 51%)" strokeDasharray="4 4" label={{ value: "1.0 SEK/kWh", fontSize: 10, fill: "hsl(0, 72%, 51%)" }} />
              <Bar yAxisId="right" dataKey="charge" name="Charge kW" fill="hsl(172, 66%, 34%)" />
              <Bar yAxisId="right" dataKey="v2h" name="V2H kW" fill="hsl(199, 89%, 48%)" />
              <Line yAxisId="left" type="monotone" dataKey="price" name="Spotpris" stroke="hsl(var(--muted-foreground))" dot={false} strokeWidth={1.5} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Logs */}
      <Card className="rounded-2xl border-border/60 shadow-card overflow-hidden">
        <div className="px-6 py-4 border-b border-border/60 flex items-center justify-between gap-3 flex-wrap">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Optimeringslogg ({logs.length})</h3>
          {logs.length > PAGE_SIZE && (
            <div className="flex items-center gap-2 text-xs">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>Föregående</Button>
              <span className="text-muted-foreground">Sida {page + 1} / {Math.ceil(logs.length / PAGE_SIZE)}</span>
              <Button variant="outline" size="sm" disabled={(page + 1) * PAGE_SIZE >= logs.length} onClick={() => setPage(p => p + 1)}>Nästa</Button>
            </div>
          )}
        </div>
        <div className="overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 bg-background z-10">
              <TableRow className="bg-muted/40">
                {["Tidpunkt","Beslut","Spotpris","SoC%","Hus kW","Nät kW","V2H SEK","Poäng","Anledning"].map(h =>
                  <TableHead key={h} className="text-xs uppercase tracking-wider font-medium">{h}</TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(l => {
                const style = decisionStyles[l.decision] ?? decisionStyles.pause;
                return (
                  <TableRow key={l.id} className={cn(style.row)}>
                    <TableCell className="text-xs font-mono">{format(new Date(l.logged_at), "MM-dd HH:mm")}</TableCell>
                    <TableCell><span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold", style.pill)}>{style.label}</span></TableCell>
                    <TableCell className="text-xs font-mono">{fmt(l.spot_price_sek, 4)}</TableCell>
                    <TableCell className="text-xs">{l.soc_pct != null ? `${Number(l.soc_pct).toFixed(0)}%` : "—"}</TableCell>
                    <TableCell className="text-xs">{fmt(l.house_consumption_kw, 2)}</TableCell>
                    <TableCell className="text-xs">{fmt(l.grid_draw_kw, 2)}</TableCell>
                    <TableCell className="text-xs">{fmt(l.v2h_saving_sek, 2)}</TableCell>
                    <TableCell className="text-xs">{fmt(l.combined_score, 3)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{l.reason ?? "—"}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}

function SavingsBreakdownBar({ price, v2h }: { price: number; v2h: number }) {
  const total = Math.max(0.0001, price + v2h);
  const pricePct = (Math.max(0, price) / total) * 100;
  const v2hPct = (Math.max(0, v2h) / total) * 100;
  return (
    <Card className="rounded-2xl border-border/60 shadow-card p-6">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">Besparingsfördelning</h3>
      <div className="flex h-10 w-full overflow-hidden rounded-full bg-muted">
        {pricePct > 0 && (
          <div className="flex items-center justify-center text-[11px] font-semibold text-white" style={{ width: `${pricePct}%`, background: "hsl(172, 66%, 34%)" }}>
            {pricePct > 12 && `${price.toFixed(2)} SEK`}
          </div>
        )}
        {v2hPct > 0 && (
          <div className="flex items-center justify-center text-[11px] font-semibold text-white" style={{ width: `${v2hPct}%`, background: "hsl(199, 89%, 48%)" }}>
            {v2hPct > 12 && `${v2h.toFixed(2)} SEK`}
          </div>
        )}
      </div>
      <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: "hsl(172, 66%, 34%)" }} /> Prisoptimering · {price.toFixed(2)} SEK ({pricePct.toFixed(0)}%)</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: "hsl(199, 89%, 48%)" }} /> V2H · {v2h.toFixed(2)} SEK ({v2hPct.toFixed(0)}%)</span>
      </div>
    </Card>
  );
}

function buildSummary(sim: any, logs: any[]) {
  const counts = { charge: 0, v2h: 0, pause: 0, emergency_charge: 0 };
  let total_charge_kwh = 0;
  for (const l of logs) {
    counts[l.decision as keyof typeof counts] = (counts[l.decision as keyof typeof counts] ?? 0) + 1;
    if (l.decision === "charge" || l.decision === "emergency_charge") {
      total_charge_kwh += Number(l.charge_kw ?? 0);
    }
  }
  return {
    total_hours: logs.length,
    charge_hours: counts.charge + counts.emergency_charge,
    v2h_hours: counts.v2h,
    pause_hours: counts.pause,
    total_charge_kwh,
    total_saved_sek: Number(sim.total_saved_sek ?? 0),
    savings_breakdown: {
      price_optimization: Number(sim.price_savings_sek ?? 0),
      v2h: Number(sim.total_v2h_saving_sek ?? 0),
    },
  };
}

function BackButton({ onBack }: { onBack: () => void }) {
  return <Button variant="ghost" onClick={onBack} className="gap-2 -ml-3"><ArrowLeft className="h-4 w-4" /> Tillbaka</Button>;
}
function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="rounded-xl border border-border/40 bg-background/60 px-4 py-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn("font-semibold text-sm mt-1", highlight && "text-emerald-600 text-base")}>{value}</div>
    </div>
  );
}
function StatusPill({ status }: { status: string | null }) {
  const tone = status === "completed" ? "bg-emerald-500/15 text-emerald-700"
    : status === "failed" ? "bg-destructive/15 text-destructive"
    : status === "running" ? "bg-amber-500/15 text-amber-700"
    : "bg-muted text-muted-foreground";
  return <span className={cn("inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold capitalize", tone)}>{status ?? "—"}</span>;
}

function num(n: any) { return n == null ? "0" : Number(n).toFixed(2); }
function fmt(n: any, d: number) { return n == null ? "—" : Number(n).toFixed(d); }
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
