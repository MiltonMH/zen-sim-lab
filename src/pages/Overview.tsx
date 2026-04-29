import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  TrendingUp, Zap, Play, Building2, CheckCircle2, AlertTriangle,
  ArrowUpRight, Trophy,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCounts } from "@/hooks/useCounts";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer, Cell,
} from "recharts";
import { cn } from "@/lib/utils";

interface SimRow {
  id: string;
  household_id: string | null;
  period_from: string;
  period_to: string;
  total_saved_sek: number | null;
  total_v2h_saving_sek: number | null;
  avg_price_paid: number | null;
  status: string | null;
  started_at: string | null;
  ended_at: string | null;
}

interface HouseholdRow {
  id: string;
  name: string;
  household_type?: string | null;
}

interface RankRow {
  household_id: string;
  name: string;
  runs: number;
  total_saved: number;
  v2h_saved: number;
  best_run: number;
  last_run: string | null;
}

function navigate(view: string, params: Record<string, string> = {}) {
  window.dispatchEvent(new CustomEvent("zen:navigate", { detail: { view, params } }));
}

function fmtSek(n: number | null | undefined, digits = 2) {
  if (n == null) return "—";
  return `${n.toLocaleString("sv-SE", { minimumFractionDigits: digits, maximumFractionDigits: digits })} SEK`;
}

function fmtDate(s: string | null | undefined) {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("sv-SE");
}

function fmtDateTime(s: string | null | undefined) {
  if (!s) return "—";
  return new Date(s).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" });
}

export default function Overview() {
  const { counts, loading: countsLoading } = useCounts();
  const [sims, setSims] = useState<SimRow[]>([]);
  const [households, setHouseholds] = useState<HouseholdRow[]>([]);
  const [tariffSourceCount, setTariffSourceCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [{ data: simData }, { data: hhData }, { count: tariffCount }] = await Promise.all([
        supabase
          .from("simulation_runs")
          .select("id, household_id, period_from, period_to, total_saved_sek, total_v2h_saving_sek, avg_price_paid, status, started_at, ended_at")
          .order("started_at", { ascending: false })
          .limit(500),
        supabase.from("household_profiles").select("id, name, household_type"),
        supabase.from("grid_tariff_sources").select("*", { count: "exact", head: true }),
      ]);
      setSims((simData ?? []) as SimRow[]);
      setHouseholds((hhData ?? []) as HouseholdRow[]);
      setTariffSourceCount(tariffCount ?? 0);
      setLoading(false);
    })();
  }, []);

  const householdMap = useMemo(() => {
    const m = new Map<string, string>();
    households.forEach((h) => m.set(h.id, h.name));
    return m;
  }, [households]);

  // Aggregate stats
  const totals = useMemo(() => {
    let savings = 0, v2h = 0;
    sims.forEach((s) => {
      savings += Number(s.total_saved_sek ?? 0);
      v2h += Number(s.total_v2h_saving_sek ?? 0);
    });
    return { savings, v2h };
  }, [sims]);

  // Household ranking
  const ranking = useMemo<RankRow[]>(() => {
    const byHh = new Map<string, RankRow>();
    sims.forEach((s) => {
      if (!s.household_id) return;
      const name = householdMap.get(s.household_id) ?? "Okänt hushåll";
      const cur = byHh.get(s.household_id) ?? {
        household_id: s.household_id, name, runs: 0, total_saved: 0,
        v2h_saved: 0, best_run: 0, last_run: null,
      };
      cur.runs += 1;
      const saved = Number(s.total_saved_sek ?? 0);
      cur.total_saved += saved;
      cur.v2h_saved += Number(s.total_v2h_saving_sek ?? 0);
      if (saved > cur.best_run) cur.best_run = saved;
      if (!cur.last_run || (s.started_at && s.started_at > cur.last_run)) cur.last_run = s.started_at;
      byHh.set(s.household_id, cur);
    });
    return Array.from(byHh.values()).sort((a, b) => b.total_saved - a.total_saved);
  }, [sims, householdMap]);

  const chartData = useMemo(
    () => ranking.slice(0, 10).map((r) => ({
      name: r.name.length > 18 ? r.name.slice(0, 17) + "…" : r.name,
      pris: Number((r.total_saved - r.v2h_saved).toFixed(2)),
      v2h: Number(r.v2h_saved.toFixed(2)),
    })),
    [ranking]
  );

  const recent = sims.slice(0, 10);
  const lastSimAt = sims[0]?.started_at ?? null;

  const statCards = [
    {
      label: "Total besparing",
      sub: "Alla simuleringar",
      value: fmtSek(totals.savings, 0),
      icon: TrendingUp,
      tone: "text-emerald-600 dark:text-emerald-400",
      ring: "ring-emerald-500/15 bg-emerald-500/5",
    },
    {
      label: "Totalt V2H sparat",
      sub: "Vehicle-to-home",
      value: fmtSek(totals.v2h, 0),
      icon: Zap,
      tone: "text-sky-600 dark:text-sky-400",
      ring: "ring-sky-500/15 bg-sky-500/5",
    },
    {
      label: "Simuleringar körda",
      sub: "Totalt antal",
      value: counts.simulation_runs.toLocaleString("sv-SE"),
      icon: Play,
      tone: "text-foreground",
      ring: "ring-border bg-muted/30",
    },
    {
      label: "Hushåll",
      sub: (() => {
        const seed = households.filter(h => (h.household_type ?? "training") === "seed").length;
        const training = households.filter(h => (h.household_type ?? "training") === "training").length;
        const real = households.filter(h => h.household_type === "real").length;
        const parts: string[] = [];
        if (seed) parts.push(`${seed} referens`);
        if (training) parts.push(`${training} träning`);
        if (real) parts.push(`${real} kund`);
        return parts.length ? parts.join(" + ") : "Profiler i lab";
      })(),
      value: counts.household_profiles.toLocaleString("sv-SE"),
      icon: Building2,
      tone: "text-foreground",
      ring: "ring-border bg-muted/30",
    },
  ];

  const statusItems = [
    {
      label: "Prisdata",
      value: counts.spot_prices > 0 ? "2024 – 2025" : "Saknas",
      ok: counts.spot_prices > 0,
    },
    {
      label: "Hushåll",
      value: `${counts.household_profiles} st`,
      ok: counts.household_profiles > 0,
    },
    {
      label: "Elnätstariffer",
      value: `${tariffSourceCount} bolag`,
      ok: tariffSourceCount >= 5,
    },
    {
      label: "Senaste simulering",
      value: lastSimAt ? fmtDateTime(lastSimAt) : "Ingen",
      ok: !!lastSimAt,
    },
  ];

  const busy = loading || countsLoading;

  return (
    <div className="space-y-8">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Översikt</h1>
          <p className="text-muted-foreground mt-1.5 text-sm">Kommandocentral för ZenOS Lab.</p>
        </div>
        <Badge variant="secondary" className="rounded-full">
          {sims.length} simuleringar laddade
        </Badge>
      </header>

      {/* Row 1: Stat cards */}
      <div className="grid grid-cols-4 gap-4">
        {statCards.map((s) => {
          const Icon = s.icon;
          return (
            <Card key={s.label} className={cn(
              "rounded-2xl border-border/60 shadow-card p-5 ring-1",
              s.ring,
            )}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium">{s.label}</div>
                  <div className="text-[11px] text-muted-foreground/70 mt-0.5">{s.sub}</div>
                </div>
                <Icon className={cn("h-4 w-4", s.tone)} />
              </div>
              <div className={cn("mt-4 text-3xl font-semibold tabular-nums", s.tone)}>
                {busy ? <span className="text-muted-foreground/40">—</span> : s.value}
              </div>
            </Card>
          );
        })}
      </div>

      {/* Row 2: Household ranking */}
      <Card className="rounded-2xl border-border/60 shadow-card overflow-hidden">
        <div className="px-5 py-4 border-b border-border/60 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-amber-500" />
            <h2 className="text-base font-semibold">Hushållsranking</h2>
          </div>
          <span className="text-xs text-muted-foreground">{ranking.length} hushåll med simuleringar</span>
        </div>
        {busy ? (
          <div className="p-8 text-sm text-muted-foreground">Laddar…</div>
        ) : ranking.length === 0 ? (
          <div className="p-8 text-sm text-muted-foreground text-center">Inga simuleringar körda ännu.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left px-5 py-2.5 font-medium w-12">#</th>
                <th className="text-left px-5 py-2.5 font-medium">Hushåll</th>
                <th className="text-right px-5 py-2.5 font-medium">Sim</th>
                <th className="text-right px-5 py-2.5 font-medium">Total sparat</th>
                <th className="text-right px-5 py-2.5 font-medium">V2H sparat</th>
                <th className="text-right px-5 py-2.5 font-medium">Bästa körning</th>
                <th className="text-left px-5 py-2.5 font-medium">Senast körd</th>
              </tr>
            </thead>
            <tbody>
              {ranking.map((r, i) => (
                <tr
                  key={r.household_id}
                  className="border-t border-border/60 hover:bg-muted/30 cursor-pointer transition-colors"
                  onClick={() => navigate("resultat", { view: "households", household: r.household_id })}
                >
                  <td className="px-5 py-3 text-muted-foreground tabular-nums">{i + 1}</td>
                  <td className="px-5 py-3 font-medium">{r.name}</td>
                  <td className="px-5 py-3 text-right tabular-nums">{r.runs}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-emerald-600 dark:text-emerald-400 font-medium">
                    {fmtSek(r.total_saved)}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums text-sky-600 dark:text-sky-400">
                    {fmtSek(r.v2h_saved)}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums">{fmtSek(r.best_run)}</td>
                  <td className="px-5 py-3 text-muted-foreground">{fmtDateTime(r.last_run)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* Row 3: Charts */}
      <div className="grid grid-cols-2 gap-4">
        <Card className="rounded-2xl border-border/60 shadow-card p-5">
          <h3 className="text-base font-semibold mb-1">Besparing per hushåll</h3>
          <p className="text-xs text-muted-foreground mb-4">Pris­optimering vs V2H</p>
          {chartData.length === 0 ? (
            <div className="h-72 flex items-center justify-center text-sm text-muted-foreground">
              Ingen data ännu
            </div>
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                  <RechartsTooltip
                    contentStyle={{
                      background: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 12,
                      fontSize: 12,
                    }}
                    formatter={(v: number) => `${v.toFixed(2)} SEK`}
                  />
                  <Bar dataKey="pris" stackId="a" fill="hsl(142 71% 45%)" name="Prisoptimering" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="v2h" stackId="a" fill="hsl(199 89% 48%)" name="V2H" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card className="rounded-2xl border-border/60 shadow-card p-5">
          <h3 className="text-base font-semibold mb-1">Senaste 10 simuleringar</h3>
          <p className="text-xs text-muted-foreground mb-4">Klicka för detaljer</p>
          {recent.length === 0 ? (
            <div className="h-72 flex items-center justify-center text-sm text-muted-foreground">
              Ingen simulering körd ännu
            </div>
          ) : (
            <div className="divide-y divide-border/60 -mx-2">
              {recent.map((s) => (
                <button
                  key={s.id}
                  onClick={() => navigate("resultat", { view: "overview", simulation: s.id })}
                  className="w-full flex items-center gap-3 px-2 py-2.5 hover:bg-muted/40 rounded-lg text-left transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">
                      {s.household_id ? householdMap.get(s.household_id) ?? "Okänt" : "—"}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {fmtDate(s.period_from)} – {fmtDate(s.period_to)}
                    </div>
                  </div>
                  <div className="text-right tabular-nums">
                    <div className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                      {fmtSek(Number(s.total_saved_sek ?? 0), 0)}
                    </div>
                    <div className="text-[11px] text-muted-foreground capitalize">{s.status ?? "—"}</div>
                  </div>
                  <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                </button>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Row 4: System status */}
      <Card className="rounded-2xl border-border/60 shadow-card p-4">
        <div className="grid grid-cols-4 gap-2">
          {statusItems.map((it) => (
            <div key={it.label} className="flex items-center gap-3 px-3 py-2">
              {it.ok ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
              )}
              <div className="min-w-0">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">{it.label}</div>
                <div className="text-sm font-medium truncate">{it.value}</div>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
