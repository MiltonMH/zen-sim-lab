import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip,
  ResponsiveContainer, Cell,
} from "recharts";
import { cn } from "@/lib/utils";

const COLOR_GREEN = "hsl(172, 66%, 34%)";
const COLOR_ORANGE = "hsl(13, 68%, 63%)";
const COLOR_RED = "hsl(0, 72%, 55%)";

type HhStat = {
  household_id: string;
  name: string;
  v2h_hours_per_day: number | null;
};

type Kpis = {
  total_sims: number;
  total_households: number;
  avg_v2h_hours_per_day: number | null;
};

type SimRow = {
  total_saved_sek: number | null;
  period_from: string;
  period_to: string;
};

function fmtSek(n: number | null | undefined, digits = 0) {
  if (n == null || isNaN(Number(n))) return "—";
  return `${Number(n).toLocaleString("sv-SE", { minimumFractionDigits: digits, maximumFractionDigits: digits })} SEK`;
}

function v2hTone(v: number | null | undefined) {
  if (v == null) return "text-muted-foreground";
  if (v > 4) return "text-emerald-600";
  if (v >= 2) return "text-amber-600";
  return "text-red-600";
}

function v2hColor(v: number) {
  if (v > 4) return COLOR_GREEN;
  if (v >= 2) return COLOR_ORANGE;
  return COLOR_RED;
}

function shortName(n: string) {
  return n.length > 14 ? n.slice(0, 13) + "…" : n;
}

function daysBetween(from: string, to: string) {
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  const d = Math.round((b - a) / 86400000) + 1;
  return d > 0 ? d : 1;
}

export default function Overview() {
  const [loading, setLoading] = useState(true);
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [stats, setStats] = useState<HhStat[]>([]);
  const [activeHouseholds, setActiveHouseholds] = useState<number>(0);
  const [avgPerDay, setAvgPerDay] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [k, s, sims, hhCount] = await Promise.all([
        supabase.rpc("ml_kpis"),
        supabase.rpc("ml_household_stats"),
        supabase
          .from("simulation_runs")
          .select("total_saved_sek, period_from, period_to")
          .eq("status", "completed"),
        supabase.from("optimization_logs").select("household_id"),
      ]);

      setKpis((k.data as Kpis) ?? null);
      setStats(((s.data as HhStat[]) ?? []).filter((x) => x.v2h_hours_per_day != null));

      const simRows = (sims.data as SimRow[]) ?? [];
      if (simRows.length) {
        const perDay = simRows
          .map((r) => Number(r.total_saved_sek ?? 0) / daysBetween(r.period_from, r.period_to))
          .filter((n) => Number.isFinite(n));
        setAvgPerDay(perDay.length ? perDay.reduce((a, b) => a + b, 0) / perDay.length : null);
      }

      const ids = new Set<string>();
      ((hhCount.data as { household_id: string | null }[]) ?? []).forEach((r) => {
        if (r.household_id) ids.add(r.household_id);
      });
      setActiveHouseholds(ids.size);

      setLoading(false);
    })();
  }, []);

  const sortedStats = useMemo(
    () =>
      [...stats]
        .sort((a, b) => (b.v2h_hours_per_day ?? 0) - (a.v2h_hours_per_day ?? 0))
        .map((s) => ({
          name: shortName(s.name),
          v2h: Number(s.v2h_hours_per_day ?? 0),
        })),
    [stats]
  );

  const v2hAvg = kpis?.avg_v2h_hours_per_day ?? null;
  const yearly = avgPerDay != null ? avgPerDay * 365 : null;

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Översikt</h1>
        <p className="text-muted-foreground mt-1.5 text-sm">
          V2H-beteende och daglig besparing från ZenOS optimeringsmotor.
        </p>
      </header>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-6 rounded-2xl">
          <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
            Snitt V2H-timmar/dag
          </div>
          {loading ? (
            <Skeleton className="h-9 w-32 mt-3" />
          ) : (
            <div className={cn("text-4xl font-semibold mt-3 tabular-nums", v2hTone(v2hAvg))}>
              {v2hAvg != null ? `${Number(v2hAvg).toLocaleString("sv-SE", { maximumFractionDigits: 1 })} timmar` : "—"}
            </div>
          )}
          <div className="text-xs text-muted-foreground mt-2">per hushåll och dag</div>
        </Card>

        <Card className="p-6 rounded-2xl">
          <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
            Snitt besparing/dag
          </div>
          {loading ? (
            <Skeleton className="h-9 w-32 mt-3" />
          ) : (
            <div className="text-4xl font-semibold mt-3 tabular-nums" style={{ color: COLOR_GREEN }}>
              {avgPerDay != null
                ? `${Number(avgPerDay).toLocaleString("sv-SE", { maximumFractionDigits: 0 })} SEK/dag`
                : "—"}
            </div>
          )}
          <div className="text-xs text-muted-foreground mt-2">
            {yearly != null ? `≈ ${fmtSek(yearly)}/år` : "per hushåll"}
          </div>
        </Card>

        <Card className="p-6 rounded-2xl">
          <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
            Aktiva hushåll
          </div>
          {loading ? (
            <Skeleton className="h-9 w-32 mt-3" />
          ) : (
            <div className="text-4xl font-semibold mt-3 tabular-nums">
              {activeHouseholds.toLocaleString("sv-SE")} hushåll
            </div>
          )}
          <div className="text-xs text-muted-foreground mt-2">bidrar till statistiken</div>
        </Card>
      </section>

      <section>
        <Card className="p-6 rounded-2xl">
          <h2 className="text-lg font-semibold">V2H-timmar per hushåll (snitt per dag)</h2>
          <p className="text-xs text-muted-foreground mt-1 mb-4">
            Grön = över 4 h, orange = 2–4 h, röd = under 2 h
          </p>
          {loading ? (
            <Skeleton className="h-80 w-full" />
          ) : sortedStats.length === 0 ? (
            <div className="h-80 flex items-center justify-center text-sm text-muted-foreground">
              Ingen data ännu
            </div>
          ) : (
            <div className="h-80">
              <ResponsiveContainer>
                <BarChart data={sortedStats} margin={{ top: 8, right: 16, left: 0, bottom: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis
                    dataKey="name"
                    angle={-30}
                    textAnchor="end"
                    height={60}
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  />
                  <YAxis
                    tickFormatter={(v) => `${v}h`}
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  />
                  <RTooltip
                    contentStyle={{
                      background: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 12,
                      fontSize: 12,
                    }}
                    formatter={(v: number) => [`${v.toFixed(1)} h/dag`, "V2H"]}
                  />
                  <Bar dataKey="v2h" radius={[6, 6, 0, 0]}>
                    {sortedStats.map((s, i) => (
                      <Cell key={i} fill={v2hColor(s.v2h)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </section>
    </div>
  );
}
