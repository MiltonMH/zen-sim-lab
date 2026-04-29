import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList,
  BreadcrumbPage, BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer, ScatterChart, Scatter, ZAxis, Line, LineChart,
  Cell, ReferenceLine,
} from "recharts";
import { Download, Trophy, TrendingUp, Wallet, Activity } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface SimRow {
  id: string;
  household_id: string | null;
  period_from: string;
  period_to: string;
  optimization_mode: string;
  total_saved_sek: number | null;
  total_v2h_saving_sek: number | null;
  scenarios: number | null;
  scenario_number: number | null;
  avg_price_paid: number | null;
  status: string | null;
  started_at: string | null;
}

interface HouseholdFull {
  id: string;
  name: string;
  house_type: string | null;
  area_m2: number | null;
  price_area: string | null;
  heating_type: string | null;
  routine_type: string | null;
  commuter_type: string | null;
  car_model: string | null;
  battery_kwh: number | null;
  ev_model_id: string | null;
}

interface EvModel {
  id: string;
  brand: string;
  model: string;
  battery_kwh: number;
  v2x_capable: boolean;
}

interface OptLog {
  household_id: string | null;
  logged_at: string;
  decision: string;
  spot_price_sek: number | null;
  charge_kw: number | null;
  v2h_saving_sek: number | null;
}

function fmtSek(n: number | null | undefined, digits = 0) {
  if (n == null) return "—";
  return `${Number(n).toLocaleString("sv-SE", { minimumFractionDigits: digits, maximumFractionDigits: digits })} SEK`;
}
function fmtDate(s: string | null | undefined) {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("sv-SE");
}
function fmtDateTime(s: string | null | undefined) {
  if (!s) return "—";
  return new Date(s).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" });
}
function StatusPill({ status }: { status: string | null | undefined }) {
  const s = (status ?? "").toLowerCase();
  const tone =
    s === "completed" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
    : s === "failed" ? "bg-red-500/15 text-red-700 dark:text-red-400"
    : "bg-muted text-muted-foreground";
  return <span className={cn("px-2 py-0.5 rounded-full text-[11px] font-medium", tone)}>{status ?? "—"}</span>;
}

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","Maj","Jun","Jul","Aug","Sep","Okt","Nov","Dec"];

export default function HouseholdProfile({
  householdId,
  onBack,
  onBackToResults,
  onOpenSimulation,
}: {
  householdId: string;
  onBack: () => void;
  onBackToResults: () => void;
  onOpenSimulation: (id: string) => void;
}) {
  const [hh, setHh] = useState<HouseholdFull | null>(null);
  const [ev, setEv] = useState<EvModel | null>(null);
  const [sims, setSims] = useState<SimRow[]>([]);
  const [logs, setLogs] = useState<OptLog[]>([]);
  const [loading, setLoading] = useState(true);

  const [sortBy, setSortBy] = useState<"date" | "saved" | "period">("date");
  const [modeFilter, setModeFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      const { data: hhData } = await supabase
        .from("household_profiles")
        .select("id, name, house_type, area_m2, price_area, heating_type, routine_type, commuter_type, car_model, battery_kwh, ev_model_id")
        .eq("id", householdId)
        .maybeSingle();
      if (cancel) return;
      setHh(hhData as HouseholdFull | null);

      let evRow: EvModel | null = null;
      if (hhData?.ev_model_id) {
        const { data: evData } = await supabase
          .from("ev_models")
          .select("id, brand, model, battery_kwh, v2x_capable")
          .eq("id", hhData.ev_model_id)
          .maybeSingle();
        evRow = (evData ?? null) as EvModel | null;
      }
      if (cancel) return;
      setEv(evRow);

      const [{ data: simData }, { data: logData }] = await Promise.all([
        supabase
          .from("simulation_runs")
          .select("id, household_id, period_from, period_to, optimization_mode, total_saved_sek, total_v2h_saving_sek, scenarios, scenario_number, avg_price_paid, status, started_at")
          .eq("household_id", householdId)
          .order("started_at", { ascending: false })
          .limit(500),
        supabase
          .from("optimization_logs")
          .select("household_id, logged_at, decision, spot_price_sek, charge_kw, v2h_saving_sek")
          .eq("household_id", householdId)
          .order("logged_at", { ascending: true })
          .limit(5000),
      ]);
      if (cancel) return;
      setSims((simData ?? []) as SimRow[]);
      setLogs((logData ?? []) as OptLog[]);
      setLoading(false);
    })();
    return () => { cancel = true; };
  }, [householdId]);

  const stats = useMemo(() => {
    const total = sims.reduce((a, s) => a + Number(s.total_saved_sek ?? 0), 0);
    const v2h = sims.reduce((a, s) => a + Number(s.total_v2h_saving_sek ?? 0), 0);
    const avg = sims.length ? total / sims.length : 0;
    let bestVal = 0;
    let bestDate: string | null = null;
    sims.forEach((s) => {
      const v = Number(s.total_saved_sek ?? 0);
      if (v > bestVal) { bestVal = v; bestDate = s.started_at; }
    });
    return { total, v2h, avg, bestVal, bestDate };
  }, [sims]);

  // Chart 1 — average charge profile per hour
  const hourProfile = useMemo(() => {
    const buckets = Array.from({ length: 24 }, (_, h) => ({ hour: h, charge: 0, v2h: 0, n: 0 }));
    logs.forEach((l) => {
      const h = new Date(l.logged_at).getHours();
      const b = buckets[h];
      b.n += 1;
      if (Number(l.charge_kw ?? 0) > 0) b.charge += Number(l.charge_kw);
      // negative charge_kw = discharge; v2h_saving_sek > 0 indicates v2h activity
      if (Number(l.charge_kw ?? 0) < 0) b.v2h += Math.abs(Number(l.charge_kw));
    });
    return buckets.map((b) => ({
      hour: `${String(b.hour).padStart(2, "0")}`,
      charge: b.n ? b.charge / b.n : 0,
      v2h: b.n ? b.v2h / b.n : 0,
    }));
  }, [logs]);

  // Chart 2 — price sensitivity scatter
  const priceScatter = useMemo(() => {
    const points = logs
      .filter((l) => l.spot_price_sek != null)
      .map((l) => ({
        price: Number(l.spot_price_sek),
        decision: l.decision === "charge" || (Number(l.charge_kw ?? 0) > 0) ? 1 : 0,
      }));
    // sample down for performance
    if (points.length > 800) {
      const step = Math.ceil(points.length / 800);
      return points.filter((_, i) => i % step === 0);
    }
    return points;
  }, [logs]);

  // Chart 3 — seasonality / per-month savings
  const monthSavings = useMemo(() => {
    const m = new Map<number, { total: number; n: number }>();
    sims.forEach((s) => {
      if (!s.started_at) return;
      const mo = new Date(s.started_at).getMonth();
      const cur = m.get(mo) ?? { total: 0, n: 0 };
      cur.total += Number(s.total_saved_sek ?? 0);
      cur.n += 1;
      m.set(mo, cur);
    });
    const arr = Array.from(m.entries())
      .map(([mo, v]) => ({ month: MONTH_NAMES[mo], avg: v.n ? v.total / v.n : 0 }))
      .sort((a, b) => MONTH_NAMES.indexOf(a.month) - MONTH_NAMES.indexOf(b.month));
    return arr;
  }, [sims]);

  const maxMonth = Math.max(1, ...monthSavings.map((m) => m.avg));

  // Section 3 — savings over time (line chart)
  const timeSeries = useMemo(() => {
    return [...sims]
      .filter((s) => s.started_at)
      .sort((a, b) => (a.started_at ?? "").localeCompare(b.started_at ?? ""))
      .map((s) => ({
        date: new Date(s.started_at!).toLocaleDateString("sv-SE", { day: "2-digit", month: "2-digit" }),
        price: Number(s.total_saved_sek ?? 0),
        v2h: Number(s.total_v2h_saving_sek ?? 0),
        total: Number(s.total_saved_sek ?? 0) + Number(s.total_v2h_saving_sek ?? 0),
      }));
  }, [sims]);

  // Section 4 — filtered, sorted, paginated table
  const filteredSims = useMemo(() => {
    let out = [...sims];
    if (modeFilter !== "all") out = out.filter((s) => s.optimization_mode === modeFilter);
    out.sort((a, b) => {
      if (sortBy === "saved") return Number(b.total_saved_sek ?? 0) - Number(a.total_saved_sek ?? 0);
      if (sortBy === "period") return (b.period_from ?? "").localeCompare(a.period_from ?? "");
      return (b.started_at ?? "").localeCompare(a.started_at ?? "");
    });
    return out;
  }, [sims, modeFilter, sortBy]);

  const totalPages = Math.max(1, Math.ceil(filteredSims.length / PAGE_SIZE));
  const pageRows = filteredSims.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  useEffect(() => { setPage(1); }, [modeFilter, sortBy]);

  const exportJson = async () => {
    const [{ data: events }] = await Promise.all([
      supabase.from("simulation_events").select("*").in("simulation_id", sims.map((s) => s.id)).limit(10000),
    ]);
    const payload = {
      household: hh,
      ev_model: ev,
      simulations: sims,
      optimization_logs: logs,
      events: events ?? [],
      exported_at: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `household-${hh?.name ?? householdId.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-4 w-64 bg-muted rounded animate-pulse" />
        <div className="h-32 bg-muted/50 rounded-2xl animate-pulse" />
      </div>
    );
  }

  if (!hh) {
    return (
      <div className="space-y-6">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem><BreadcrumbLink onClick={onBackToResults} className="cursor-pointer">Resultat & Loggar</BreadcrumbLink></BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem><BreadcrumbPage>Hushållet kunde inte laddas</BreadcrumbPage></BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <Card className="rounded-2xl p-10 text-center text-sm text-muted-foreground">Hushåll saknas.</Card>
      </div>
    );
  }

  const subInfo = [
    hh.house_type && hh.area_m2 ? `${cap(hh.house_type)} ${hh.area_m2}m²` : hh.house_type ? cap(hh.house_type) : null,
    hh.price_area,
    hh.heating_type ? cap(hh.heating_type) : null,
    ev ? `${ev.brand} ${ev.model}` : hh.car_model,
    hh.routine_type ? cap(hh.routine_type) : hh.commuter_type ? cap(hh.commuter_type) : null,
  ].filter(Boolean);

  return (
    <div className="space-y-6">
      {/* Breadcrumbs */}
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink onClick={onBackToResults} className="cursor-pointer">Resultat & Loggar</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink onClick={onBack} className="cursor-pointer">Per hushåll</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem><BreadcrumbPage>{hh.name}</BreadcrumbPage></BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {/* Header */}
      <header className="space-y-2">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-3xl font-semibold tracking-tight">{hh.name}</h1>
          {ev?.v2x_capable && (
            <Badge className="rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-transparent">V2X</Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">{subInfo.join(" · ")}</p>
      </header>

      {/* 4 stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={<Wallet className="h-4 w-4" />} label="Total sparat" value={fmtSek(stats.total)} accent="emerald" />
        <StatCard icon={<TrendingUp className="h-4 w-4" />} label="Snitt per simulering" value={fmtSek(stats.avg, 2)} />
        <StatCard
          icon={<Trophy className="h-4 w-4" />}
          label="Bästa simulering"
          value={fmtSek(stats.bestVal)}
          sub={stats.bestDate ? fmtDate(stats.bestDate) : undefined}
        />
        <StatCard icon={<Activity className="h-4 w-4" />} label="Total V2H sparat" value={fmtSek(stats.v2h)} accent="sky" />
      </div>

      {/* Section 2 — Beteendemönster */}
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Beteendemönster</h2>
          <p className="text-xs text-muted-foreground">Baserat på {sims.length} simuleringar och {logs.length} beslutspunkter</p>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="rounded-2xl border-border/60 shadow-card p-4">
            <div className="text-sm font-medium mb-1">Genomsnittlig laddprofil</div>
            <div className="text-[11px] text-muted-foreground mb-2">kW per timme på dygnet</div>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={hourProfile}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
                  <XAxis dataKey="hour" tick={{ fontSize: 10 }} interval={2} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <RechartsTooltip
                    contentStyle={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 11 }}
                    formatter={(v: number, name: string) => [`${v.toFixed(2)} kW`, name === "charge" ? "Laddning" : "V2H"]}
                  />
                  <Bar dataKey="charge" fill="hsl(142 71% 45%)" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="v2h" fill="hsl(199 89% 48%)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card className="rounded-2xl border-border/60 shadow-card p-4">
            <div className="text-sm font-medium mb-1">Priskänslighet</div>
            <div className="text-[11px] text-muted-foreground mb-2">1 = laddar, 0 = pausar (per spotpris)</div>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
                  <XAxis type="number" dataKey="price" name="Pris" unit=" kr" tick={{ fontSize: 10 }} />
                  <YAxis type="number" dataKey="decision" name="Beslut" domain={[-0.1, 1.1]} ticks={[0, 1]} tick={{ fontSize: 10 }} />
                  <ZAxis range={[20, 20]} />
                  <RechartsTooltip
                    contentStyle={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 11 }}
                    formatter={(v: number, name: string) => [name === "decision" ? (v ? "Ladda" : "Paus") : `${Number(v).toFixed(2)} kr`, name === "decision" ? "Beslut" : "Pris"]}
                  />
                  <Scatter data={priceScatter} fill="hsl(var(--primary))" fillOpacity={0.5} />
                  {priceScatter.length > 1 && (
                    <ReferenceLine
                      segment={trendSegment(priceScatter)}
                      stroke="hsl(var(--foreground))"
                      strokeDasharray="4 4"
                      strokeOpacity={0.6}
                    />
                  )}
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card className="rounded-2xl border-border/60 shadow-card p-4">
            <div className="text-sm font-medium mb-1">Säsongsbesparing</div>
            <div className="text-[11px] text-muted-foreground mb-2">Snitt per månad</div>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthSavings}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
                  <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <RechartsTooltip
                    contentStyle={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 11 }}
                    formatter={(v: number) => [fmtSek(v, 0), "Snitt"]}
                  />
                  <Bar dataKey="avg" radius={[3, 3, 0, 0]}>
                    {monthSavings.map((m, i) => {
                      const intensity = Math.max(0.25, m.avg / maxMonth);
                      return <Cell key={i} fill={`hsl(142 71% ${Math.round(70 - 35 * intensity)}%)`} />;
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
      </section>

      {/* Section 3 — Besparing över tid */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Besparing över tid</h2>
        <Card className="rounded-2xl border-border/60 shadow-card p-4">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={timeSeries}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <RechartsTooltip
                  contentStyle={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 11 }}
                  formatter={(v: number, name: string) => [fmtSek(v, 0), name === "price" ? "Prisoptimering" : name === "v2h" ? "V2H" : "Totalt"]}
                />
                <Line type="monotone" dataKey="price" stroke="hsl(142 71% 45%)" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="v2h" stroke="hsl(199 89% 48%)" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="total" stroke="hsl(var(--muted-foreground))" strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="flex items-center gap-4 text-[11px] text-muted-foreground mt-3">
            <Legend color="hsl(142 71% 45%)" label="Prisoptimering" />
            <Legend color="hsl(199 89% 48%)" label="V2H" />
            <Legend color="hsl(var(--muted-foreground))" label="Totalt" dashed />
          </div>
        </Card>
      </section>

      {/* Section 4 — Alla simuleringar */}
      <section className="space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h2 className="text-lg font-semibold tracking-tight">Alla simuleringar</h2>
          <Button variant="outline" size="sm" className="rounded-full gap-2" onClick={exportJson}>
            <Download className="h-3.5 w-3.5" /> Exportera hushållsdata (JSON)
          </Button>
        </div>

        <Card className="rounded-2xl border-border/60 shadow-card p-4">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xs text-muted-foreground">Sortera</span>
            <Select value={sortBy} onValueChange={(v) => setSortBy(v as any)}>
              <SelectTrigger className="w-[160px] rounded-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="date">Datum</SelectItem>
                <SelectItem value="saved">Sparat</SelectItem>
                <SelectItem value="period">Period</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground ml-2">Läge</span>
            <Select value={modeFilter} onValueChange={setModeFilter}>
              <SelectTrigger className="w-[160px] rounded-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alla lägen</SelectItem>
                <SelectItem value="level1">Nivå 1</SelectItem>
                <SelectItem value="level2">Nivå 2</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </Card>

        <Card className="rounded-2xl border-border/60 shadow-card overflow-hidden">
          {pageRows.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">Inga simuleringar matchar filtren.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="text-left px-5 py-2.5 font-medium">Datum</th>
                  <th className="text-left px-5 py-2.5 font-medium">Period</th>
                  <th className="text-left px-5 py-2.5 font-medium">Läge</th>
                  <th className="text-right px-5 py-2.5 font-medium">Scenario</th>
                  <th className="text-right px-5 py-2.5 font-medium">Sparat</th>
                  <th className="text-right px-5 py-2.5 font-medium">V2H</th>
                  <th className="text-right px-5 py-2.5 font-medium">Avg pris</th>
                  <th className="text-left px-5 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((s) => (
                  <tr
                    key={s.id}
                    className="border-t border-border/60 hover:bg-muted/30 cursor-pointer"
                    onClick={() => onOpenSimulation(s.id)}
                  >
                    <td className="px-5 py-2.5 text-muted-foreground tabular-nums">{fmtDateTime(s.started_at)}</td>
                    <td className="px-5 py-2.5 tabular-nums">{fmtDate(s.period_from)} – {fmtDate(s.period_to)}</td>
                    <td className="px-5 py-2.5"><Badge variant="secondary" className="rounded-full">{s.optimization_mode}</Badge></td>
                    <td className="px-5 py-2.5 text-right tabular-nums">{s.scenario_number ?? 1}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-emerald-600 dark:text-emerald-400 font-medium">{fmtSek(Number(s.total_saved_sek ?? 0), 2)}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-sky-600 dark:text-sky-400">{fmtSek(Number(s.total_v2h_saving_sek ?? 0), 2)}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums">{s.avg_price_paid != null ? `${Number(s.avg_price_paid).toFixed(2)} kr` : "—"}</td>
                    <td className="px-5 py-2.5"><StatusPill status={s.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        {totalPages > 1 && (
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Sida {page} av {totalPages} · {filteredSims.length} simuleringar</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="rounded-full" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Föregående</Button>
              <Button variant="outline" size="sm" className="rounded-full" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Nästa</Button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function cap(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }

function StatCard({
  icon, label, value, sub, accent,
}: {
  icon: React.ReactNode; label: string; value: string; sub?: string; accent?: "emerald" | "sky";
}) {
  const accentClass =
    accent === "emerald" ? "text-emerald-600 dark:text-emerald-400"
    : accent === "sky" ? "text-sky-600 dark:text-sky-400"
    : "text-foreground";
  return (
    <Card className="rounded-2xl border-border/60 shadow-card p-5">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
        {icon}{label}
      </div>
      <div className={cn("mt-2 text-2xl font-semibold tabular-nums", accentClass)}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-1">{sub}</div>}
    </Card>
  );
}

function Legend({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-block w-4 h-0.5"
        style={{
          background: dashed ? `repeating-linear-gradient(to right, ${color} 0 4px, transparent 4px 8px)` : color,
        }}
      />
      {label}
    </span>
  );
}

// Simple linear regression for trend line in scatter
function trendSegment(points: { price: number; decision: number }[]) {
  if (points.length < 2) return undefined as any;
  const n = points.length;
  const sumX = points.reduce((a, p) => a + p.price, 0);
  const sumY = points.reduce((a, p) => a + p.decision, 0);
  const sumXY = points.reduce((a, p) => a + p.price * p.decision, 0);
  const sumXX = points.reduce((a, p) => a + p.price * p.price, 0);
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return undefined as any;
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  const xs = points.map((p) => p.price);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  return [
    { x: minX, y: Math.max(0, Math.min(1, slope * minX + intercept)) },
    { x: maxX, y: Math.max(0, Math.min(1, slope * maxX + intercept)) },
  ];
}
