import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip,
  ResponsiveContainer, Cell, LabelList, PieChart, Pie,
} from "recharts";
import { cn } from "@/lib/utils";
import { Battery, Coins, Users, Trophy, Zap, Clock, ShieldCheck, TrendingUp } from "lucide-react";

const GREEN = "hsl(172, 66%, 34%)";
const GREEN_SOFT = "hsl(172, 66%, 92%)";
const BLUE = "hsl(239, 84%, 67%)";
const BLUE_SOFT = "hsl(239, 84%, 95%)";
const ORANGE = "hsl(13, 68%, 63%)";
const ORANGE_SOFT = "hsl(13, 68%, 94%)";
const RED = "hsl(0, 72%, 55%)";
const RED_SOFT = "hsl(0, 72%, 95%)";

type HhStat = {
  household_id: string;
  name: string;
  v2h_hours_per_day: number | null;
  avg_sek_per_day: number | null;
  morning_guarantee_pct: number | null;
  v2h_coverage_pct: number | null;
};

type Kpis = {
  total_sims: number;
  total_households: number;
  avg_v2h_hours_per_day: number | null;
  v2h_coverage_pct: number | null;
  morning_guarantee_pct: number | null;
};

function nf(n: number | null | undefined, digits = 0) {
  if (n == null || isNaN(Number(n))) return "—";
  return Number(n).toLocaleString("sv-SE", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
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
  icon: Icon,
  label,
  value,
  unit,
  sub,
  color,
  bg,
  loading,
}: {
  icon: any;
  label: string;
  value: string;
  unit?: string;
  sub: string;
  color: string;
  bg: string;
  loading: boolean;
}) {
  return (
    <Card className="p-6 rounded-2xl border-0 relative overflow-hidden" style={{ background: bg }}>
      <div className="absolute -right-6 -top-6 opacity-20">
        <Icon size={120} style={{ color }} strokeWidth={1.5} />
      </div>
      <div className="relative">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider font-semibold" style={{ color }}>
          <Icon size={14} />
          {label}
        </div>
        {loading ? (
          <Skeleton className="h-12 w-40 mt-4" />
        ) : (
          <div className="mt-3 flex items-baseline gap-1.5">
            <div className="text-5xl font-bold tabular-nums tracking-tight" style={{ color }}>
              {value}
            </div>
            {unit && <div className="text-lg font-medium" style={{ color }}>{unit}</div>}
          </div>
        )}
        <div className="text-sm mt-2 text-foreground/70">{sub}</div>
      </div>
    </Card>
  );
}

export default function Overview() {
  const [loading, setLoading] = useState(true);
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [stats, setStats] = useState<HhStat[]>([]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [k, s] = await Promise.all([
        supabase.rpc("ml_kpis"),
        supabase.rpc("ml_household_stats"),
      ]);
      setKpis((k.data as Kpis) ?? null);
      setStats(((s.data as HhStat[]) ?? []).filter((x) => x.v2h_hours_per_day != null));
      setLoading(false);
    })();
  }, []);

  const ranking = useMemo(
    () =>
      [...stats]
        .sort((a, b) => (b.v2h_hours_per_day ?? 0) - (a.v2h_hours_per_day ?? 0))
        .map((s) => ({
          name: shortName(s.name),
          v2h: Number(s.v2h_hours_per_day ?? 0),
          sek: Number(s.avg_sek_per_day ?? 0),
        })),
    [stats]
  );

  const avgPerDay = useMemo(() => {
    if (!stats.length) return null;
    const arr = stats.map((s) => Number(s.avg_sek_per_day ?? 0)).filter(Number.isFinite);
    return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
  }, [stats]);

  const totalDaily = useMemo(
    () => stats.reduce((sum, s) => sum + Number(s.avg_sek_per_day ?? 0), 0),
    [stats]
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
  const top = ranking[0];

  return (
    <div className="space-y-8">
      <header className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-4xl font-bold tracking-tight">Översikt</h1>
          <p className="text-muted-foreground mt-2 text-base">
            Hur ZenOS optimerar V2H och sparar pengar — i siffror.
          </p>
        </div>
        {!loading && kpis && (
          <div className="flex gap-3 text-xs">
            <span className="px-3 py-1.5 rounded-full bg-card border border-border/60 font-medium">
              {nf(kpis.total_sims)} simuleringar
            </span>
            <span className="px-3 py-1.5 rounded-full bg-card border border-border/60 font-medium">
              {nf(kpis.total_households)} hushåll
            </span>
          </div>
        )}
      </header>

      {/* KPI-cards */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <KpiCard
          loading={loading}
          icon={Battery}
          label="V2H-timmar / dag"
          value={nf(v2hAvg, 1)}
          unit="h"
          sub={
            v2hAvg != null && v2hAvg > 4
              ? "Stark V2H-användning"
              : v2hAvg != null && v2hAvg >= 2
              ? "Måttlig V2H-användning"
              : "Låg V2H-användning"
          }
          color={v2hAvg != null && v2hAvg > 4 ? GREEN : v2hAvg != null && v2hAvg >= 2 ? ORANGE : RED}
          bg={v2hAvg != null && v2hAvg > 4 ? GREEN_SOFT : v2hAvg != null && v2hAvg >= 2 ? ORANGE_SOFT : RED_SOFT}
        />
        <KpiCard
          loading={loading}
          icon={Coins}
          label="Snitt besparing / dag"
          value={nf(avgPerDay)}
          unit="SEK"
          sub={avgPerDay != null ? `≈ ${nf(avgPerDay * 365)} SEK / år per hushåll` : "per hushåll"}
          color={GREEN}
          bg={GREEN_SOFT}
        />
        <KpiCard
          loading={loading}
          icon={Users}
          label="Aktiva hushåll"
          value={nf(kpis?.total_households)}
          sub={totalDaily > 0 ? `Tillsammans ${nf(totalDaily)} SEK / dag` : "i datasetet"}
          color={BLUE}
          bg={BLUE_SOFT}
        />
      </section>

      {/* Insights row */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <Card className="p-5 rounded-2xl border-border/60">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground font-semibold">
            <Trophy size={14} style={{ color: GREEN }} />
            Toppresterare
          </div>
          {loading ? (
            <Skeleton className="h-8 w-48 mt-3" />
          ) : top ? (
            <>
              <div className="text-xl font-semibold mt-2">{top.name}</div>
              <div className="text-sm text-muted-foreground mt-1">
                {nf(top.v2h, 1)} h V2H/dag · {nf(top.sek)} SEK/dag
              </div>
            </>
          ) : (
            <div className="text-sm text-muted-foreground mt-2">Ingen data</div>
          )}
        </Card>

        <Card className="p-5 rounded-2xl border-border/60">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground font-semibold">
            <ShieldCheck size={14} style={{ color: GREEN }} />
            Morgongaranti
          </div>
          {loading ? (
            <Skeleton className="h-8 w-32 mt-3" />
          ) : (
            <>
              <div className="text-3xl font-bold mt-2 tabular-nums" style={{ color: GREEN }}>
                {nf(kpis?.morning_guarantee_pct, 1)}%
              </div>
              <div className="text-sm text-muted-foreground mt-1">
                av morgnar — bilen var fulladdad
              </div>
            </>
          )}
        </Card>

        <Card className="p-5 rounded-2xl border-border/60">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground font-semibold">
            <TrendingUp size={14} style={{ color: BLUE }} />
            V2H-täckning
          </div>
          {loading ? (
            <Skeleton className="h-8 w-32 mt-3" />
          ) : (
            <>
              <div className="text-3xl font-bold mt-2 tabular-nums" style={{ color: BLUE }}>
                {nf(kpis?.v2h_coverage_pct, 1)}%
              </div>
              <div className="text-sm text-muted-foreground mt-1">
                av dagar med minst 1 V2H-timme
              </div>
            </>
          )}
        </Card>
      </section>

      {/* Charts */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card className="p-6 rounded-2xl border-border/60 lg:col-span-2">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Zap size={18} style={{ color: GREEN }} />
              Ranking — V2H-timmar per hushåll
            </h2>
            <div className="flex gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm" style={{ background: GREEN }} />&gt;4h
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm" style={{ background: ORANGE }} />2–4h
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm" style={{ background: RED }} />&lt;2h
              </span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mb-5">
            Sorterat högst till lägst. Etiketter visar timmar per dag.
          </p>
          {loading ? (
            <Skeleton className="h-[420px] w-full" />
          ) : ranking.length === 0 ? (
            <div className="h-[420px] flex items-center justify-center text-sm text-muted-foreground">
              Ingen data ännu — kör en simulering först
            </div>
          ) : (
            <div className="h-[420px]">
              <ResponsiveContainer>
                <BarChart
                  data={ranking}
                  layout="vertical"
                  margin={{ top: 4, right: 48, left: 8, bottom: 4 }}
                >
                  <CartesianGrid horizontal={false} strokeDasharray="3 3" opacity={0.3} />
                  <XAxis
                    type="number"
                    tickFormatter={(v) => `${v}h`}
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                    domain={[0, "dataMax + 1"]}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={170}
                    tick={{ fontSize: 12, fill: "hsl(var(--foreground))" }}
                  />
                  <RTooltip
                    cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }}
                    contentStyle={{
                      background: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 12,
                      fontSize: 12,
                    }}
                    formatter={(v: number, _n, p: any) => [
                      `${v.toFixed(1)} h/dag · ${nf(p.payload.sek)} SEK/dag`,
                      "V2H",
                    ]}
                  />
                  <Bar dataKey="v2h" radius={[0, 8, 8, 0]} barSize={22}>
                    {ranking.map((s, i) => (
                      <Cell key={i} fill={v2hBucket(s.v2h).color} />
                    ))}
                    <LabelList
                      dataKey="v2h"
                      position="right"
                      formatter={(v: number) => `${v.toFixed(1)}h`}
                      style={{ fontSize: 11, fontWeight: 600, fill: "hsl(var(--foreground))" }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card className="p-6 rounded-2xl border-border/60">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Clock size={18} style={{ color: BLUE }} />
            Hushållens prestanda
          </h2>
          <p className="text-xs text-muted-foreground mt-1 mb-5">
            Fördelning per V2H-bucket
          </p>
          {loading ? (
            <Skeleton className="h-[260px] w-full" />
          ) : distribution.length === 0 ? (
            <div className="h-[260px] flex items-center justify-center text-sm text-muted-foreground">
              Ingen data
            </div>
          ) : (
            <>
              <div className="h-[220px]">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie
                      data={distribution}
                      dataKey="value"
                      innerRadius={55}
                      outerRadius={85}
                      paddingAngle={3}
                      stroke="none"
                    />
                    <RTooltip
                      contentStyle={{
                        background: "hsl(var(--popover))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: 12,
                        fontSize: 12,
                      }}
                      formatter={(v: number, n: string) => [`${v} hushåll`, n]}
                    />
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
    </div>
  );
}
