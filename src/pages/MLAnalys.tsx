import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip,
  ResponsiveContainer, Cell, ReferenceLine,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

const COLORS = {
  charging: "hsl(172, 66%, 34%)",
  v2h: "hsl(239, 84%, 67%)",
  away: "hsl(220, 9%, 60%)",
  pause: "hsl(220, 9%, 88%)",
  orange: "hsl(13, 68%, 63%)",
  red: "hsl(0, 72%, 51%)",
};

function minToHHMM(m: number | null | undefined): string {
  if (m == null || isNaN(Number(m))) return "—";
  const v = Math.round(Number(m));
  const h = Math.floor(v / 60), mm = v % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}
function hourToHHMM(h: number | null | undefined) {
  if (h == null) return "—";
  return `${String(h).padStart(2, "0")}:00`;
}
function fmtSek(n: number | null | undefined, digits = 2) {
  if (n == null) return "—";
  return `${Number(n).toLocaleString("sv-SE", { minimumFractionDigits: digits, maximumFractionDigits: digits })} SEK`;
}
function pct(n: number | null | undefined) {
  if (n == null) return "—";
  return `${Number(n).toLocaleString("sv-SE", { maximumFractionDigits: 1 })}%`;
}

type HourRow = { hour_of_day: number; charging_pct: number; v2h_pct: number; away_pct: number; pause_pct: number; total: number };
type HouseholdStats = {
  household_id: string; name: string; total_days: number;
  v2h_hours_per_day: number; charge_hours_per_day: number;
  morning_guarantee_pct: number | null; v2h_coverage_pct: number | null;
  cable_in_min: number | null; cable_out_min: number | null;
  charge_start_min: number | null; avg_sek_per_day: number | null;
};
type Kpis = {
  total_sims: number; total_households: number;
  avg_v2h_hours_per_day: number | null;
  avg_cable_in_min: number | null; avg_cable_out_min: number | null;
  avg_charge_start_min: number | null;
  avg_v2h_start_min: number | null;
  v2h_coverage_pct: number | null; morning_guarantee_pct: number | null;
};
type Challenges = {
  morning_missed_pct: number | null; forgot_charge_pct: number | null;
  missed_v2h_pct: number | null; extreme_hours_count: number;
  extreme_v2h_pct: number | null; flat_days_count: number;
};
type HeatmapRow = { weekday: number; hour_of_day: number; v2h_pct: number; total: number };
type BestHour = { hour_of_day: number; v2h_pct: number };
const WEEKDAYS = ["Söndag", "Måndag", "Tisdag", "Onsdag", "Torsdag", "Fredag", "Lördag"];

function toneClass(value: number | null | undefined, good: number, warn: number, reverse = false) {
  if (value == null) return "text-muted-foreground";
  const v = Number(value);
  const ok = reverse ? v < warn : v > good;
  const mid = reverse ? v < good : v >= warn;
  if (ok) return "text-emerald-600";
  if (mid) return "text-amber-600";
  return "text-red-600";
}

function KpiCard({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <Card className="p-4 rounded-2xl">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("text-2xl font-semibold mt-1 tabular-nums", tone)}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-1">{sub}</div>}
    </Card>
  );
}

function ChallengeCard({ title, value, desc, tone }: { title: string; value: string; desc: string; tone?: string }) {
  return (
    <Card className="p-5 rounded-2xl">
      <div className="text-sm font-medium">{title}</div>
      <div className={cn("text-3xl font-semibold mt-2 tabular-nums", tone)}>{value}</div>
      <div className="text-xs text-muted-foreground mt-2">{desc}</div>
    </Card>
  );
}

function HourBar({ data, leaveHour, returnHour }: { data: HourRow[]; leaveHour?: number; returnHour?: number }) {
  const v2hStart = data.find((d) => d.v2h_pct >= 50)?.hour_of_day;
  const chargeStart = data.find((d) => d.charging_pct >= 50)?.hour_of_day;
  return (
    <div className="h-[340px] w-full">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 20, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
          <XAxis dataKey="hour_of_day" tickFormatter={(h) => `${String(h).padStart(2, "0")}`} />
          <YAxis tickFormatter={(v) => `${v}%`} domain={[0, 100]} />
          <RTooltip
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as HourRow;
              return (
                <div className="rounded-lg border bg-background px-3 py-2 text-xs shadow-lg">
                  <div className="font-medium">{hourToHHMM(label as number)}</div>
                  <div>V2H: {pct(d.v2h_pct)} | Laddar: {pct(d.charging_pct)}</div>
                  <div>Borta: {pct(d.away_pct)} | Väntar: {pct(d.pause_pct)}</div>
                </div>
              );
            }}
          />
          <Bar dataKey="charging_pct" stackId="a" fill={COLORS.charging} name="Laddar" />
          <Bar dataKey="v2h_pct" stackId="a" fill={COLORS.v2h} name="V2H" />
          <Bar dataKey="away_pct" stackId="a" fill={COLORS.away} name="Borta" />
          <Bar dataKey="pause_pct" stackId="a" fill={COLORS.pause} name="Väntar" />
          {leaveHour != null && (
            <ReferenceLine x={leaveHour} stroke={COLORS.away} strokeDasharray="4 4"
              label={{ value: `Kunden åker (${hourToHHMM(leaveHour)})`, position: "top", fontSize: 10 }} />
          )}
          {returnHour != null && (
            <ReferenceLine x={returnHour} stroke={COLORS.away} strokeDasharray="4 4"
              label={{ value: `Kunden hem (${hourToHHMM(returnHour)})`, position: "top", fontSize: 10 }} />
          )}
          {v2hStart != null && (
            <ReferenceLine x={v2hStart} stroke={COLORS.v2h} strokeDasharray="4 4"
              label={{ value: `V2H startar (${hourToHHMM(v2hStart)})`, position: "insideTop", fontSize: 10 }} />
          )}
          {chargeStart != null && (
            <ReferenceLine x={chargeStart} stroke={COLORS.charging} strokeDasharray="4 4"
              label={{ value: `Laddning (${hourToHHMM(chargeStart)})`, position: "insideTop", fontSize: 10 }} />
          )}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function MLAnalys() {
  const [loading, setLoading] = useState(true);
  const [empty, setEmpty] = useState(false);
  const [hourly, setHourly] = useState<HourRow[]>([]);
  const [stats, setStats] = useState<HouseholdStats[]>([]);
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [challenges, setChallenges] = useState<Challenges | null>(null);
  const [avgLeave, setAvgLeave] = useState<number | undefined>();
  const [avgReturn, setAvgReturn] = useState<number | undefined>();
  const [openHh, setOpenHh] = useState<HouseholdStats | null>(null);
  const [hhHourly, setHhHourly] = useState<HourRow[]>([]);
  const [heatmap, setHeatmap] = useState<HeatmapRow[]>([]);
  const [bestHour, setBestHour] = useState<BestHour | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const safe = async <T,>(p: Promise<{ data: T | null; error: any }>, label: string) => {
        try {
          const { data, error } = await p;
          if (error) console.error(`[MLAnalys] ${label} error:`, error);
          return data;
        } catch (e) {
          console.error(`[MLAnalys] ${label} threw:`, e);
          return null;
        }
      };
      const [h, s, k, c, hp, hm, bh] = await Promise.all([
        safe(supabase.rpc("ml_hourly_distribution", { _household: null }) as any, "ml_hourly_distribution"),
        safe(supabase.rpc("ml_household_stats") as any, "ml_household_stats"),
        safe(supabase.rpc("ml_kpis") as any, "ml_kpis"),
        safe(supabase.rpc("ml_challenges") as any, "ml_challenges"),
        safe(supabase.from("household_profiles").select("leave_time, return_time") as any, "household_profiles"),
        safe(supabase.rpc("ml_v2h_heatmap") as any, "ml_v2h_heatmap"),
        safe(supabase.rpc("ml_best_v2h_hour") as any, "ml_best_v2h_hour"),
      ]);
      const hours = (Array.isArray(h) ? h : []) as any[];
      const filled: HourRow[] = Array.from({ length: 24 }, (_, i) => {
        const r = hours.find((x) => Number(x.hour_of_day) === i);
        return {
          hour_of_day: i,
          charging_pct: Number(r?.charging_pct ?? 0),
          v2h_pct: Number(r?.v2h_pct ?? 0),
          away_pct: Number(r?.away_pct ?? 0),
          pause_pct: Number(r?.pause_pct ?? 0),
          total: Number(r?.total ?? 0),
        };
      });
      console.log('[MLAnalys] hourly rows:', hours.length, 'filled total sum:', filled.reduce((a, r) => a + r.total, 0));
      console.log('[MLAnalys] kpis:', k, 'stats rows:', Array.isArray(s) ? s.length : 0);
      setHourly(filled);
      setStats((Array.isArray(s) ? s : []) as HouseholdStats[]);
      setKpis((k as Kpis) ?? {
        total_sims: 0, total_households: 0,
        avg_v2h_hours_per_day: null, avg_cable_in_min: null, avg_cable_out_min: null,
        avg_charge_start_min: null, avg_v2h_start_min: null,
        v2h_coverage_pct: null, morning_guarantee_pct: null,
      });
      setChallenges((c as Challenges) ?? null);
      const hpArr = (Array.isArray(hp) ? hp : []) as any[];
      if (hpArr.length) {
        setAvgLeave(Math.round(hpArr.reduce((a, x) => a + (x.leave_time ?? 0), 0) / hpArr.length));
        setAvgReturn(Math.round(hpArr.reduce((a, x) => a + (x.return_time ?? 0), 0) / hpArr.length));
      }
      setHeatmap((Array.isArray(hm) ? hm : []) as HeatmapRow[]);
      const bestArr = Array.isArray(bh) ? bh : [];
      setBestHour(bestArr.length ? (bestArr[0] as BestHour) : null);
      const hasData = filled.some((r) => r.total > 0);
      setEmpty(!hasData);
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (!openHh) return;
    (async () => {
      const { data } = await supabase.rpc("ml_hourly_distribution", { _household: openHh.household_id });
      const hrs = (data ?? []) as HourRow[];
      setHhHourly(Array.from({ length: 24 }, (_, i) => {
        const r = hrs.find((x) => x.hour_of_day === i);
        return r ?? { hour_of_day: i, charging_pct: 0, v2h_pct: 0, away_pct: 0, pause_pct: 0, total: 0 };
      }));
    })();
  }, [openHh]);

  const chargeWindow = useMemo(() => {
    const idxs = hourly.map((h, i) => ({ i, p: h.charging_pct })).filter((x) => x.p >= 30);
    if (!idxs.length) return null;
    return [idxs[0].i, idxs[idxs.length - 1].i] as [number, number];
  }, [hourly]);
  const v2hWindow = useMemo(() => {
    const idxs = hourly.map((h, i) => ({ i, p: h.v2h_pct })).filter((x) => x.p >= 30);
    if (!idxs.length) return null;
    return [idxs[0].i, idxs[idxs.length - 1].i] as [number, number];
  }, [hourly]);
  const awayWindow = useMemo(() => {
    const idxs = hourly.map((h, i) => ({ i, p: h.away_pct })).filter((x) => x.p >= 30);
    if (!idxs.length) return null;
    return [idxs[0].i, idxs[idxs.length - 1].i] as [number, number];
  }, [hourly]);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-7 gap-3">
          {Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
        </div>
        <Skeleton className="h-[340px] rounded-2xl" />
      </div>
    );
  }

  if (empty) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-center">
        <h1 className="text-2xl font-semibold mb-2">ML Beteendeanalys</h1>
        <p className="text-muted-foreground">Kör simuleringar för att se hur ZenOS tänker</p>
      </div>
    );
  }

  const maxV2hHours = Math.max(...stats.map((s) => s.v2h_hours_per_day || 0), 1);

  return (
    <div className="space-y-10">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">ML Beteendeanalys</h1>
        <p className="text-muted-foreground mt-1">Hur ZenOS tänker — lärt från {kpis?.total_sims ?? 0} simuleringar och {kpis?.total_households ?? 0} hushåll</p>
      </header>

      {/* SECTION 1 — KPIs */}
      <section className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        <KpiCard
          label="V2H timmar/dag"
          value={kpis?.avg_v2h_hours_per_day != null ? `${kpis.avg_v2h_hours_per_day} h` : "—"}
          tone={toneClass(kpis?.avg_v2h_hours_per_day, 8, 4)}
        />
        <KpiCard label="Kabel inkopplad" value={minToHHMM(kpis?.avg_cable_in_min)} />
        <KpiCard label="Kabel urkopplad" value={minToHHMM(kpis?.avg_cable_out_min)} />
        <KpiCard label="V2H startar" value={minToHHMM(kpis?.avg_v2h_start_min)} />
        <KpiCard label="Laddning startar" value={minToHHMM(kpis?.avg_charge_start_min)} />
        <KpiCard
          label="V2H täckningsgrad"
          value={pct(kpis?.v2h_coverage_pct)}
          tone={toneClass(kpis?.v2h_coverage_pct, 80, 50)}
          sub="Mål: > 80%"
        />
        <KpiCard
          label="Morgongaranti"
          value={pct(kpis?.morning_guarantee_pct)}
          tone={toneClass(kpis?.morning_guarantee_pct, 95, 85)}
          sub="Bilen hade fullt batteri vid avfärd"
        />
      </section>

      {/* SECTION 2 — Average day */}
      <section>
        <div className="mb-3">
          <h2 className="text-xl font-semibold">Hur ZenOS tänker — genomsnittlig dag</h2>
          <p className="text-sm text-muted-foreground">Baserat på {kpis?.total_sims ?? 0} simuleringar, {kpis?.total_households ?? 0} hushåll</p>
        </div>
        <Card className="p-5 rounded-2xl">
          <HourBar data={hourly} leaveHour={avgLeave} returnHour={avgReturn} />
          <div className="flex flex-wrap gap-4 text-xs mt-4">
            <span className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm" style={{ background: COLORS.charging }} /> Laddar</span>
            <span className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm" style={{ background: COLORS.v2h }} /> V2H</span>
            <span className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm" style={{ background: COLORS.away }} /> Bilen borta</span>
            <span className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm" style={{ background: COLORS.pause }} /> Väntar</span>
          </div>
          <div className="mt-4 text-sm text-muted-foreground space-y-1">
            {chargeWindow && <div>ZenOS laddar i snitt kl {hourToHHMM(chargeWindow[0])} — {hourToHHMM(chargeWindow[1])}</div>}
            {v2hWindow && <div>V2H aktivt kl {hourToHHMM(v2hWindow[0])} — {hourToHHMM(v2hWindow[1])}</div>}
            {awayWindow && <div>Bilen borta kl {hourToHHMM(awayWindow[0])} — {hourToHHMM(awayWindow[1])}</div>}
          </div>
        </Card>
      </section>

      {/* SECTION 3 — Per household */}
      <section>
        <div className="mb-3">
          <h2 className="text-xl font-semibold">V2H-mönster per hushåll</h2>
        </div>
        <Card className="p-5 rounded-2xl space-y-6">
          <div style={{ height: Math.max(stats.length * 36 + 40, 200) }}>
            <ResponsiveContainer>
              <BarChart data={stats} layout="vertical" margin={{ left: 100, right: 30 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis type="number" tickFormatter={(v) => `${v}h`} />
                <YAxis type="category" dataKey="name" width={180} />
                <RTooltip formatter={(v: number) => [`${v} h`, "V2H/dag"]} />
                <Bar dataKey="v2h_hours_per_day" radius={[0, 6, 6, 0]}
                  onClick={(d: any) => setOpenHh(d as HouseholdStats)}
                  style={{ cursor: "pointer" }}>
                  {stats.map((s, i) => {
                    const v = s.v2h_hours_per_day || 0;
                    const fill = v > 5 ? COLORS.charging : v >= 3 ? COLORS.orange : COLORS.red;
                    return <Cell key={i} fill={fill} />;
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b">
                  <th className="py-2 pr-3">Hushåll</th>
                  <th className="py-2 pr-3">V2H h/dag</th>
                  <th className="py-2 pr-3">Morgongaranti</th>
                  <th className="py-2 pr-3">Kabel in</th>
                  <th className="py-2 pr-3">Kabel ut</th>
                  <th className="py-2 pr-3">Laddning start</th>
                  <th className="py-2 pr-3">V2H täckn.</th>
                  <th className="py-2 pr-3">Snitt SEK/dag</th>
                </tr>
              </thead>
              <tbody>
                {stats.map((s) => (
                  <tr key={s.household_id} className="border-b hover:bg-muted/40 cursor-pointer" onClick={() => setOpenHh(s)}>
                    <td className="py-2 pr-3 font-medium">{s.name}</td>
                    <td className="py-2 pr-3 tabular-nums">{s.v2h_hours_per_day?.toFixed(1) ?? "—"}</td>
                    <td className={cn("py-2 pr-3 tabular-nums", toneClass(s.morning_guarantee_pct, 95, 85))}>{pct(s.morning_guarantee_pct)}</td>
                    <td className="py-2 pr-3 tabular-nums">{minToHHMM(s.cable_in_min)}</td>
                    <td className="py-2 pr-3 tabular-nums">{minToHHMM(s.cable_out_min)}</td>
                    <td className="py-2 pr-3 tabular-nums">{minToHHMM(s.charge_start_min)}</td>
                    <td className={cn("py-2 pr-3 tabular-nums", toneClass(s.v2h_coverage_pct, 80, 50))}>{pct(s.v2h_coverage_pct)}</td>
                    <td className="py-2 pr-3 tabular-nums">{fmtSek(s.avg_sek_per_day)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </section>

      {/* SECTION 4 — Challenges */}
      <section>
        <div className="mb-3">
          <h2 className="text-xl font-semibold">Avvikelser och utmaningar</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-3">
          <ChallengeCard
            title="Morgongaranti missad"
            value={pct(challenges?.morning_missed_pct)}
            desc="av morgnar — bilen åkte med för lite batteri"
            tone={toneClass(challenges?.morning_missed_pct, 2, 5, true)}
          />
          <ChallengeCard
            title="Glömd laddning"
            value={pct(challenges?.forgot_charge_pct)}
            desc="av scenarion — risk för räckviddsoro"
          />
          <ChallengeCard
            title="Missad V2H"
            value={pct(challenges?.missed_v2h_pct)}
            desc="av dyra kvällar utan V2H"
          />
          <ChallengeCard
            title="Extrempristimmar"
            value={`${challenges?.extreme_hours_count ?? 0}`}
            desc={`> 2 SEK — V2H aktivt ${pct(challenges?.extreme_v2h_pct)} av gångerna`}
          />
          <ChallengeCard
            title="Platta prisdagar"
            value={`${challenges?.flat_days_count ?? 0}`}
            desc="dagar med platt pris — enbart laddningsoptimering"
          />
        </div>
      </section>

      <Sheet open={!!openHh} onOpenChange={(o) => !o && setOpenHh(null)}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          {openHh && (
            <div className="space-y-6 pt-4">
              <div>
                <h3 className="text-xl font-semibold">{openHh.name}</h3>
                <p className="text-sm text-muted-foreground">Beteendeanalys för detta hushåll</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <KpiCard label="Morgongaranti" value={pct(openHh.morning_guarantee_pct)} tone={toneClass(openHh.morning_guarantee_pct, 95, 85)} />
                <KpiCard label="V2H täckningsgrad" value={pct(openHh.v2h_coverage_pct)} tone={toneClass(openHh.v2h_coverage_pct, 80, 50)} />
                <KpiCard label="V2H h/dag" value={`${openHh.v2h_hours_per_day?.toFixed(1) ?? "—"} h`} tone={toneClass(openHh.v2h_hours_per_day, 8, 4)} />
                <KpiCard label="Snitt SEK/dag" value={fmtSek(openHh.avg_sek_per_day)} />
                <KpiCard label="Kabel in" value={minToHHMM(openHh.cable_in_min)} />
                <KpiCard label="Kabel ut" value={minToHHMM(openHh.cable_out_min)} />
              </div>
              <Card className="p-4 rounded-2xl">
                <h4 className="text-sm font-medium mb-2">24-timmars beteende</h4>
                <HourBar data={hhHourly} />
              </Card>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
