import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip,
  ResponsiveContainer, Cell, LabelList, PieChart, Pie,
  AreaChart, Area,
} from "recharts";
import {
  Battery, Coins, Users, Trophy, Zap, Clock, ShieldCheck, TrendingUp,
  AlertTriangle, Sun, Activity, Gauge, Sparkles,
} from "lucide-react";

const GREEN = "hsl(172, 66%, 34%)";
const GREEN_SOFT = "hsl(172, 66%, 92%)";
const BLUE = "hsl(239, 84%, 67%)";
const BLUE_SOFT = "hsl(239, 84%, 95%)";
const ORANGE = "hsl(13, 68%, 63%)";
const ORANGE_SOFT = "hsl(13, 68%, 94%)";
const RED = "hsl(0, 72%, 55%)";
const RED_SOFT = "hsl(0, 72%, 95%)";
const PURPLE = "hsl(265, 70%, 60%)";
const PURPLE_SOFT = "hsl(265, 70%, 95%)";

type HhStat = {
  household_id: string;
  name: string;
  v2h_hours_per_day: number | null;
  charge_hours_per_day: number | null;
  avg_sek_per_day: number | null;
  morning_guarantee_pct: number | null;
  v2h_coverage_pct: number | null;
  total_days: number | null;
};

type Kpis = {
  total_sims: number;
  total_households: number;
  avg_v2h_hours_per_day: number | null;
  v2h_coverage_pct: number | null;
  morning_guarantee_pct: number | null;
  avg_v2h_start_min: number | null;
  avg_charge_start_min: number | null;
  avg_cable_out_min: number | null;
};

type Challenges = {
  morning_missed_pct: number | null;
  forgot_charge_pct: number | null;
  missed_v2h_pct: number | null;
  extreme_hours_count: number | null;
  extreme_v2h_pct: number | null;
  flat_days_count: number | null;
};

type SimTotals = {
  total_saved_sek: number;
  total_v2h_saving_sek: number;
  total_v2h_kwh: number;
  peak_demand_saving_sek: number;
  peaks_avoided_count: number;
  sims_completed: number;
  avg_sek_per_day: number | null;
  est_annual_sek: number | null;
  avg_peak_demand_per_sim: number | null;
  perHouseholdDaily: Record<string, number>;
};

type HourDist = {
  hour_of_day: number;
  charging_pct: number | null;
  v2h_pct: number | null;
  away_pct: number | null;
  pause_pct: number | null;
};

function nf(n: number | null | undefined, digits = 0) {
  if (n == null || isNaN(Number(n))) return "—";
  return Number(n).toLocaleString("sv-SE", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function minToTime(m: number | null | undefined) {
  if (m == null) return "—";
  const h = Math.floor(m / 60);
  const min = Math.round(m % 60);
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function v2hBucket(v: number) {
  if (v > 4) return { color: GREEN, soft: GREEN_SOFT, label: "Stark" };
  if (v >= 2) return { color: ORANGE, soft: ORANGE_SOFT, label: "OK" };
  return { color: RED, soft: RED_SOFT, label: "Svag" };
}

function shortName(n: string) {
  return n.replace(" - ", " · ").replace(" (Tjänste Bil)", "");
}

function KpiCard({
  icon: Icon, label, value, unit, sub, color, bg, loading,
}: {
  icon: any; label: string; value: string; unit?: string; sub: string;
  color: string; bg: string; loading: boolean;
}) {
  return (
    <Card className="p-5 sm:p-6 rounded-2xl border-0 relative overflow-hidden" style={{ background: bg }}>
      <div className="absolute -right-6 -top-6 opacity-20">
        <Icon size={120} style={{ color }} strokeWidth={1.5} />
      </div>
      <div className="relative">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider font-semibold" style={{ color }}>
          <Icon size={14} />
          {label}
        </div>
        {loading ? (
          <Skeleton className="h-12 w-40 mt-4" />
        ) : (
          <div className="mt-3 flex items-baseline gap-1.5 flex-wrap">
            <div className="text-4xl sm:text-5xl font-bold tabular-nums tracking-tight" style={{ color }}>
              {value}
            </div>
            {unit && <div className="text-base sm:text-lg font-medium" style={{ color }}>{unit}</div>}
          </div>
        )}
        <div className="text-sm mt-2 text-foreground/70">{sub}</div>
      </div>
    </Card>
  );
}

function MiniStat({
  icon: Icon, label, value, sub, color,
}: { icon: any; label: string; value: string; sub?: string; color: string }) {
  return (
    <div className="flex items-start gap-3 p-4 rounded-xl bg-card border border-border/60">
      <div className="rounded-lg p-2" style={{ background: `${color}1a`, color }}>
        <Icon size={18} />
      </div>
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
        <div className="text-xl font-semibold tabular-nums leading-tight mt-0.5" style={{ color }}>{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

export default function Overview() {
  const [loading, setLoading] = useState(true);
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [stats, setStats] = useState<HhStat[]>([]);
  const [challenges, setChallenges] = useState<Challenges | null>(null);
  const [totals, setTotals] = useState<SimTotals | null>(null);
  const [hourly, setHourly] = useState<HourDist[]>([]);
  const [bestHour, setBestHour] = useState<{ hour_of_day: number; v2h_pct: number } | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [k, s, c, t, h, b] = await Promise.all([
        supabase.rpc("ml_kpis"),
        supabase.rpc("ml_household_stats"),
        supabase.rpc("ml_challenges"),
        supabase
          .from("simulation_runs")
          .select("household_id,total_saved_sek,total_v2h_saving_sek,total_v2h_kwh,peak_demand_saving_sek,peaks_avoided_count,period_from,period_to")
          .eq("status", "completed"),
        supabase.rpc("ml_hourly_distribution"),
        supabase.rpc("ml_best_v2h_hour"),
      ]);
      setKpis((k.data as Kpis) ?? null);
      setStats(((s.data as HhStat[]) ?? []).filter((x) => x.v2h_hours_per_day != null));
      setChallenges((c.data as Challenges) ?? null);
      const rows = (t.data as any[]) ?? [];
      const dayMs = 86400000;
      const perSimDaily: number[] = [];
      const monthlyTotals: number[] = [];
      const hhAccum: Record<string, { sum: number; n: number }> = {};
      for (const r of rows) {
        const saved = Number(r.total_saved_sek ?? 0);
        if (!(saved > 0) || !r.period_from || !r.period_to) continue;
        const days = Math.max(1, Math.round((+new Date(r.period_to) - +new Date(r.period_from)) / dayMs) + 1);
        // Only count monthly-length sims for daily/annual averages — yearly sims often have partial data
        const isMonthly = days >= 26 && days <= 35;
        const perDay = saved / days;
        if (isMonthly) {
          perSimDaily.push(perDay);
          monthlyTotals.push(saved);
          if (r.household_id) {
            const h = (hhAccum[r.household_id] ??= { sum: 0, n: 0 });
            h.sum += perDay; h.n += 1;
          }
        }
      }
      const avgDay = perSimDaily.length ? perSimDaily.reduce((a,b)=>a+b,0)/perSimDaily.length : null;
      const avgMonthly = monthlyTotals.length ? monthlyTotals.reduce((a,b)=>a+b,0)/monthlyTotals.length : null;
      const perHouseholdDaily: Record<string, number> = {};
      for (const [id, v] of Object.entries(hhAccum)) perHouseholdDaily[id] = v.sum / v.n;
      const peakSum = rows.reduce((a, r) => a + Number(r.peak_demand_saving_sek ?? 0), 0);
      setTotals({
        total_saved_sek: rows.reduce((a, r) => a + Number(r.total_saved_sek ?? 0), 0),
        total_v2h_saving_sek: rows.reduce((a, r) => a + Number(r.total_v2h_saving_sek ?? 0), 0),
        total_v2h_kwh: rows.reduce((a, r) => a + Number(r.total_v2h_kwh ?? 0), 0),
        peak_demand_saving_sek: peakSum,
        peaks_avoided_count: rows.reduce((a, r) => a + Number(r.peaks_avoided_count ?? 0), 0),
        sims_completed: rows.length,
        avg_sek_per_day: avgDay,
        est_annual_sek: avgMonthly != null ? avgMonthly * 12 : null,
        avg_peak_demand_per_sim: rows.length ? peakSum / rows.length : null,
        perHouseholdDaily,
      });
      setHourly((h.data as HourDist[]) ?? []);
      const br = (b.data as any[]) ?? [];
      setBestHour(br[0] ?? null);
      setLoading(false);
    })();
  }, []);

  const ranking = useMemo(() => {
    const map = totals?.perHouseholdDaily ?? {};
    return [...stats]
      .sort((a, b) => (b.v2h_hours_per_day ?? 0) - (a.v2h_hours_per_day ?? 0))
      .map((s) => ({
        name: shortName(s.name),
        v2h: Number(s.v2h_hours_per_day ?? 0),
        sek: Number(map[s.household_id] ?? 0),
      }));
  }, [stats, totals]);

  const sekRanking = useMemo(() => {
    const map = totals?.perHouseholdDaily ?? {};
    return [...stats]
      .map((s) => ({ name: shortName(s.name), sek: Number(map[s.household_id] ?? 0) }))
      .filter((x) => x.sek > 0)
      .sort((a, b) => b.sek - a.sek);
  }, [stats, totals]);

  const avgPerDay = totals?.avg_sek_per_day ?? null;
  const estAnnual = totals?.est_annual_sek ?? null;

  const totalDaily = useMemo(
    () => Object.values(totals?.perHouseholdDaily ?? {}).reduce((a, b) => a + b, 0),
    [totals]
  );

  const distribution = useMemo(() => {
    const b = { green: 0, orange: 0, red: 0 };
    stats.forEach((s) => {
      const v = Number(s.v2h_hours_per_day ?? 0);
      if (v > 4) b.green++;
      else if (v >= 2) b.orange++;
      else b.red++;
    });
    return [
      { name: "Stark (>4h)", value: b.green, fill: GREEN },
      { name: "OK (2–4h)", value: b.orange, fill: ORANGE },
      { name: "Svag (<2h)", value: b.red, fill: RED },
    ].filter((x) => x.value > 0);
  }, [stats]);

  const v2hAvg = kpis?.avg_v2h_hours_per_day ?? null;
  const top = useMemo(() => {
    const map = totals?.perHouseholdDaily ?? {};
    let best: { name: string; v2h: number; sek: number } | null = null;
    for (const s of stats) {
      const sek = Number(map[s.household_id] ?? 0);
      if (sek <= 0) continue;
      if (!best || sek > best.sek) {
        best = { name: shortName(s.name), v2h: Number(s.v2h_hours_per_day ?? 0), sek };
      }
    }
    return best;
  }, [stats, totals]);

  return (
    <div className="space-y-6 sm:space-y-8">
      <header className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">Översikt</h1>
          <p className="text-muted-foreground mt-2 text-sm sm:text-base">
            Allt ZenOS gjort — i siffror, för alla hushåll och simuleringar.
          </p>
        </div>
        {!loading && kpis && (
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="px-3 py-1.5 rounded-full bg-card border border-border/60 font-medium">
              {nf(kpis.total_sims)} loggade dagar
            </span>
            <span className="px-3 py-1.5 rounded-full bg-card border border-border/60 font-medium">
              {nf(totals?.sims_completed)} simuleringar
            </span>
            <span className="px-3 py-1.5 rounded-full bg-card border border-border/60 font-medium">
              {nf(kpis.total_households)} hushåll
            </span>
          </div>
        )}
      </header>

      {/* Top KPI cards */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-5">
        <KpiCard
          loading={loading} icon={Battery} label="V2H-timmar / dag"
          value={nf(v2hAvg, 1)} unit="h"
          sub={v2hAvg != null && v2hAvg > 4 ? "Stark V2H-användning" : v2hAvg != null && v2hAvg >= 2 ? "Måttlig V2H-användning" : "Låg V2H-användning"}
          color={v2hAvg != null && v2hAvg > 4 ? GREEN : v2hAvg != null && v2hAvg >= 2 ? ORANGE : RED}
          bg={v2hAvg != null && v2hAvg > 4 ? GREEN_SOFT : v2hAvg != null && v2hAvg >= 2 ? ORANGE_SOFT : RED_SOFT}
        />
        <KpiCard
          loading={loading} icon={Coins} label="Snitt besparing / dag"
          value={nf(avgPerDay)} unit="SEK"
          sub={estAnnual != null ? `≈ ${nf(estAnnual)} SEK / år per simulering` : "per simulering"}
          color={GREEN} bg={GREEN_SOFT}
        />
        <KpiCard
          loading={loading} icon={Users} label="Aktiva hushåll"
          value={nf(kpis?.total_households)}
          sub={totalDaily > 0 ? `Tillsammans ${nf(totalDaily)} SEK / dag` : "i datasetet"}
          color={BLUE} bg={BLUE_SOFT}
        />
      </section>

      {/* Total impact summary */}
      <section>
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <Sparkles size={18} style={{ color: PURPLE }} />
          Total påverkan över alla simuleringar
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {loading || !totals ? (
            Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20" />)
          ) : (
            <>
              <MiniStat icon={Coins} label="Totalt sparat" value={`${nf(totals.total_saved_sek)} SEK`} color={GREEN} sub="alla simuleringar" />
              <MiniStat icon={Battery} label="V2H-besparing" value={`${nf(totals.total_v2h_saving_sek)} SEK`} color={BLUE} sub={`${nf(totals.total_v2h_kwh)} kWh ut`} />
              <MiniStat icon={Gauge} label="Effekttariff (snitt/sim)" value={`${nf(totals.avg_peak_demand_per_sim)} SEK`} color={PURPLE} sub={`${nf(totals.peaks_avoided_count)} toppar undvikna totalt`} />
              <MiniStat icon={Activity} label="Loggade dagar" value={nf(kpis?.total_sims)} color={ORANGE} sub="datapunkter" />
              <MiniStat icon={ShieldCheck} label="Morgongaranti" value={`${nf(kpis?.morning_guarantee_pct, 1)}%`} color={GREEN} sub="bilen full vid avresa" />
            </>
          )}
        </div>
      </section>

      {/* Insight cards */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-5">
        <Card className="p-5 rounded-2xl border-border/60">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground font-semibold">
            <Trophy size={14} style={{ color: GREEN }} />
            Toppresterare
          </div>
          {loading ? <Skeleton className="h-8 w-48 mt-3" /> : top ? (
            <>
              <div className="text-xl font-semibold mt-2">{top.name}</div>
              <div className="text-sm text-muted-foreground mt-1">
                {nf(top.v2h, 1)} h V2H/dag · {nf(top.sek)} SEK/dag
              </div>
            </>
          ) : <div className="text-sm text-muted-foreground mt-2">Ingen data</div>}
        </Card>

        <Card className="p-5 rounded-2xl border-border/60">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground font-semibold">
            <Clock size={14} style={{ color: BLUE }} />
            Bästa V2H-timme
          </div>
          {loading ? <Skeleton className="h-8 w-32 mt-3" /> : bestHour ? (
            <>
              <div className="text-3xl font-bold mt-2 tabular-nums" style={{ color: BLUE }}>
                {String(bestHour.hour_of_day).padStart(2, "0")}:00
              </div>
              <div className="text-sm text-muted-foreground mt-1">
                {nf(bestHour.v2h_pct, 1)}% av timmarna används till V2H
              </div>
            </>
          ) : <div className="text-sm text-muted-foreground mt-2">—</div>}
        </Card>

        <Card className="p-5 rounded-2xl border-border/60">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground font-semibold">
            <TrendingUp size={14} style={{ color: GREEN }} />
            V2H-täckning
          </div>
          {loading ? <Skeleton className="h-8 w-32 mt-3" /> : (
            <>
              <div className="text-3xl font-bold mt-2 tabular-nums" style={{ color: GREEN }}>
                {nf(kpis?.v2h_coverage_pct, 1)}%
              </div>
              <div className="text-sm text-muted-foreground mt-1">av dagar med minst 1 V2H-timme</div>
            </>
          )}
        </Card>
      </section>

      {/* Charts: ranking + distribution */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-5">
        <Card className="p-5 sm:p-6 rounded-2xl border-border/60 lg:col-span-2">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Zap size={18} style={{ color: GREEN }} />
              Ranking — V2H-timmar per hushåll
            </h2>
            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: GREEN }} />&gt;4h</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: ORANGE }} />2–4h</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: RED }} />&lt;2h</span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mb-5">Sorterat högst till lägst.</p>
          {loading ? <Skeleton className="h-[420px] w-full" /> : ranking.length === 0 ? (
            <div className="h-[420px] flex items-center justify-center text-sm text-muted-foreground">Ingen data</div>
          ) : (
            <div className="h-[420px]">
              <ResponsiveContainer>
                <BarChart data={ranking} layout="vertical" margin={{ top: 4, right: 48, left: 8, bottom: 4 }}>
                  <CartesianGrid horizontal={false} strokeDasharray="3 3" opacity={0.3} />
                  <XAxis type="number" tickFormatter={(v) => `${v}h`} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} domain={[0, "dataMax + 1"]} />
                  <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 11, fill: "hsl(var(--foreground))" }} />
                  <RTooltip
                    cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }}
                    contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 12, fontSize: 12 }}
                    formatter={(v: number, _n, p: any) => [`${v.toFixed(1)} h/dag · ${nf(p.payload.sek)} SEK/dag`, "V2H"]}
                  />
                  <Bar dataKey="v2h" radius={[0, 8, 8, 0]} barSize={20}>
                    {ranking.map((s, i) => <Cell key={i} fill={v2hBucket(s.v2h).color} />)}
                    <LabelList dataKey="v2h" position="right" formatter={(v: number) => `${v.toFixed(1)}h`} style={{ fontSize: 11, fontWeight: 600, fill: "hsl(var(--foreground))" }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card className="p-5 sm:p-6 rounded-2xl border-border/60">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Clock size={18} style={{ color: BLUE }} />
            Hushållens prestanda
          </h2>
          <p className="text-xs text-muted-foreground mt-1 mb-5">Fördelning per V2H-bucket</p>
          {loading ? <Skeleton className="h-[260px] w-full" /> : distribution.length === 0 ? (
            <div className="h-[260px] flex items-center justify-center text-sm text-muted-foreground">Ingen data</div>
          ) : (
            <>
              <div className="h-[220px]">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={distribution} dataKey="value" innerRadius={55} outerRadius={85} paddingAngle={3} stroke="none" />
                    <RTooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 12, fontSize: 12 }} formatter={(v: number, n: string) => [`${v} hushåll`, n]} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-2 mt-2">
                {distribution.map((d) => (
                  <div key={d.name} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-sm" style={{ background: d.fill }} />
                      <span className="text-foreground/80">{d.name}</span>
                    </div>
                    <span className="font-semibold tabular-nums">{d.value}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>
      </section>

      {/* Hourly distribution */}
      <section>
        <Card className="p-5 sm:p-6 rounded-2xl border-border/60">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Activity size={18} style={{ color: BLUE }} />
            Beslutsfördelning per timme
          </h2>
          <p className="text-xs text-muted-foreground mt-1 mb-5">När laddar, V2H:ar och pausar systemet?</p>
          {loading ? <Skeleton className="h-[280px] w-full" /> : hourly.length === 0 ? (
            <div className="h-[280px] flex items-center justify-center text-sm text-muted-foreground">Ingen data</div>
          ) : (
            <div className="h-[280px]">
              <ResponsiveContainer>
                <AreaChart data={hourly} margin={{ top: 4, right: 12, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="hour_of_day" tickFormatter={(v) => `${v}h`} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                  <RTooltip
                    contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 12, fontSize: 12 }}
                    formatter={(v: number, n: string) => [`${nf(v, 1)}%`, n]}
                    labelFormatter={(l) => `Kl ${l}:00`}
                  />
                  <Area type="monotone" stackId="1" dataKey="charging_pct" name="Laddar" stroke={GREEN} fill={GREEN} fillOpacity={0.7} />
                  <Area type="monotone" stackId="1" dataKey="v2h_pct" name="V2H" stroke={BLUE} fill={BLUE} fillOpacity={0.7} />
                  <Area type="monotone" stackId="1" dataKey="away_pct" name="Borta" stroke="hsl(0 0% 60%)" fill="hsl(0 0% 60%)" fillOpacity={0.5} />
                  <Area type="monotone" stackId="1" dataKey="pause_pct" name="Paus" stroke={ORANGE} fill={ORANGE} fillOpacity={0.4} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </section>

      {/* Sek ranking + Challenges */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-5">
        <Card className="p-5 sm:p-6 rounded-2xl border-border/60 lg:col-span-2">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Coins size={18} style={{ color: GREEN }} />
            Besparing per hushåll (SEK/dag)
          </h2>
          <p className="text-xs text-muted-foreground mt-1 mb-5">Tjänstebilar och pendlare ligger högst.</p>
          {loading ? <Skeleton className="h-[340px] w-full" /> : (
            <div className="h-[340px]">
              <ResponsiveContainer>
                <BarChart data={sekRanking} layout="vertical" margin={{ top: 4, right: 56, left: 8, bottom: 4 }}>
                  <CartesianGrid horizontal={false} strokeDasharray="3 3" opacity={0.3} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 11, fill: "hsl(var(--foreground))" }} />
                  <RTooltip
                    cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }}
                    contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 12, fontSize: 12 }}
                    formatter={(v: number) => [`${nf(v)} SEK/dag`, "Besparing"]}
                  />
                  <Bar dataKey="sek" radius={[0, 8, 8, 0]} barSize={20} fill={GREEN}>
                    <LabelList dataKey="sek" position="right" formatter={(v: number) => `${nf(v)}`} style={{ fontSize: 11, fontWeight: 600, fill: "hsl(var(--foreground))" }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card className="p-5 sm:p-6 rounded-2xl border-border/60">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <AlertTriangle size={18} style={{ color: ORANGE }} />
            Utmaningar
          </h2>
          <p className="text-xs text-muted-foreground mt-1 mb-4">Var systemet kan förbättras.</p>
          {loading || !challenges ? <Skeleton className="h-[280px] w-full" /> : (
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 rounded-xl" style={{ background: ORANGE_SOFT }}>
                <div>
                  <div className="text-xs uppercase tracking-wider font-semibold" style={{ color: ORANGE }}>Missad V2H-potential</div>
                  <div className="text-xs text-foreground/70 mt-0.5">Dyra kvällar utan V2H</div>
                </div>
                <div className="text-2xl font-bold tabular-nums" style={{ color: ORANGE }}>{nf(challenges.missed_v2h_pct, 1)}%</div>
              </div>
              <div className="flex items-center justify-between p-3 rounded-xl" style={{ background: RED_SOFT }}>
                <div>
                  <div className="text-xs uppercase tracking-wider font-semibold" style={{ color: RED }}>Morgon ej full</div>
                  <div className="text-xs text-foreground/70 mt-0.5">SoC under mål vid avresa</div>
                </div>
                <div className="text-2xl font-bold tabular-nums" style={{ color: RED }}>{nf(challenges.morning_missed_pct, 1)}%</div>
              </div>
              <div className="flex items-center justify-between p-3 rounded-xl" style={{ background: PURPLE_SOFT }}>
                <div>
                  <div className="text-xs uppercase tracking-wider font-semibold" style={{ color: PURPLE }}>Extrema pristoppar</div>
                  <div className="text-xs text-foreground/70 mt-0.5">Timmar &gt; 2 SEK/kWh</div>
                </div>
                <div className="text-2xl font-bold tabular-nums" style={{ color: PURPLE }}>{nf(challenges.extreme_hours_count)}</div>
              </div>
              <div className="flex items-center justify-between p-3 rounded-xl" style={{ background: GREEN_SOFT }}>
                <div>
                  <div className="text-xs uppercase tracking-wider font-semibold" style={{ color: GREEN }}>Platta dagar</div>
                  <div className="text-xs text-foreground/70 mt-0.5">Liten prisspridning (&lt;0.08)</div>
                </div>
                <div className="text-2xl font-bold tabular-nums" style={{ color: GREEN }}>{nf(challenges.flat_days_count)}</div>
              </div>
            </div>
          )}
        </Card>
      </section>

      {/* Behaviour times */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <MiniStat icon={Sun} label="Snitt: V2H startar" value={minToTime(kpis?.avg_v2h_start_min)} color={BLUE} sub="när bilen börjar mata ut" />
        <MiniStat icon={Battery} label="Snitt: laddning startar" value={minToTime(kpis?.avg_charge_start_min)} color={GREEN} sub="när bilen börjar ladda" />
        <MiniStat icon={Clock} label="Snitt: bilen lämnar" value={minToTime(kpis?.avg_cable_out_min)} color={ORANGE} sub="kabel kopplas ur" />
      </section>
    </div>
  );
}
