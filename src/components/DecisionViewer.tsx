import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight, Zap, Pause, Battery, Plug, PlugZap, AlertTriangle } from "lucide-react";
import { format, parseISO, addDays, isSameDay, eachDayOfInterval } from "date-fns";
import { sv } from "date-fns/locale";
import { cn } from "@/lib/utils";
import {
  ComposedChart, Area, Line, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, ReferenceArea, Cell,
} from "recharts";

/* ---------- Types ---------- */
interface Props {
  simulationId: string;
  householdId: string;
  periodFrom: string;
  periodTo: string;
  priceThreshold?: number;
}
interface Log {
  id: string;
  logged_at: string;
  decision: "charge" | "pause" | "v2h" | "v2g" | "emergency_charge" | string;
  reason: string | null;
  spot_price_sek: number | null;
  soc_pct: number | null;
  charge_kw: number | null;
  v2h_saving_sek: number | null;
  house_consumption_kw: number | null;
}
interface Evt {
  id: string;
  occurred_at: string;
  event_type: string;
  value_kw: number | null;
  value_soc_pct: number | null;
  value_price_sek: number | null;
  value_sek_impact: number | null;
  reason: string | null;
}

/* ---------- Color tokens ---------- */
const COLORS = {
  charge: "hsl(172, 66%, 34%)",
  v2h: "hsl(239, 84%, 67%)",
  v2g: "hsl(280, 70%, 60%)",
  emergency: "hsl(0, 75%, 55%)",
  pause: "hsl(220, 9%, 65%)",
  price: "hsl(13, 68%, 63%)",
  soc: "hsl(172, 66%, 45%)",
  green: "hsl(142, 60%, 60%)",
  yellow: "hsl(48, 90%, 65%)",
  orange: "hsl(28, 90%, 60%)",
  red: "hsl(0, 75%, 60%)",
};
const TOO_CHEAP = 0.20;
const DAY_THRESHOLDS = [0.5, 1.0, 2.0]; // green / yellow / orange / red

const EVENT_ICONS: Record<string, { icon: string; label: string; color: string }> = {
  charging_started:        { icon: "⚡", label: "Laddning startad",   color: COLORS.charge },
  charging_stopped:        { icon: "⏸", label: "Laddning pausad",    color: COLORS.pause },
  v2h_started:             { icon: "🔋", label: "V2H startad",        color: COLORS.v2h },
  v2h_stopped:             { icon: "🔋", label: "V2H stoppad",        color: COLORS.v2h },
  v2g_started:             { icon: "⚡", label: "V2G startad",        color: COLORS.v2g },
  v2g_stopped:             { icon: "⚡", label: "V2G stoppad",        color: COLORS.v2g },
  cable_connected:         { icon: "🏠", label: "Kabel inkopplad",   color: COLORS.soc },
  cable_disconnected:      { icon: "🏠", label: "Kabel urkopplad",   color: COLORS.pause },
  emergency_charge_started:{ icon: "🚨", label: "Nödladdning",        color: COLORS.emergency },
  cheap_price_detected:    { icon: "💰", label: "Lågt pris",          color: COLORS.green },
  expensive_price_detected:{ icon: "💸", label: "Högt pris",          color: COLORS.red },
};

/* ---------- Component ---------- */
export default function DecisionViewer({
  simulationId, householdId, periodFrom, periodTo, priceThreshold = 2.0,
}: Props) {
  const [logs, setLogs] = useState<Log[]>([]);
  const [events, setEvents] = useState<Evt[]>([]);
  const [loading, setLoading] = useState(true);
  const [dayIndex, setDayIndex] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const fromIso = `${periodFrom}T00:00:00+00:00`;
      const toIso = `${periodTo}T23:59:59+00:00`;
      const [{ data: l }, { data: e }] = await Promise.all([
        supabase.from("optimization_logs")
          .select("id,logged_at,decision,reason,spot_price_sek,soc_pct,charge_kw,v2h_saving_sek,house_consumption_kw")
          .eq("simulation_id", simulationId)
          .gte("logged_at", fromIso).lte("logged_at", toIso)
          .order("logged_at", { ascending: true }),
        supabase.from("simulation_events")
          .select("id,occurred_at,event_type,value_kw,value_soc_pct,value_price_sek,value_sek_impact,reason")
          .eq("simulation_id", simulationId)
          .order("occurred_at", { ascending: true }),
      ]);
      if (!alive) return;
      setLogs((l ?? []) as Log[]);
      setEvents((e ?? []) as Evt[]);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [simulationId, periodFrom, periodTo]);

  /* group logs by Stockholm day */
  const days = useMemo(() => {
    const map = new Map<string, Log[]>();
    for (const l of logs) {
      const d = format(parseISO(l.logged_at), "yyyy-MM-dd");
      if (!map.has(d)) map.set(d, []);
      map.get(d)!.push(l);
    }
    const sorted = [...map.keys()].sort();
    return sorted.map(d => ({ day: d, logs: map.get(d)! }));
  }, [logs]);

  /* daily savings (for color-coding day strip) */
  const dailySavings = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of logs) {
      const d = format(parseISO(l.logged_at), "yyyy-MM-dd");
      m.set(d, (m.get(d) ?? 0) + Number(l.v2h_saving_sek ?? 0));
    }
    return m;
  }, [logs]);

  if (loading) {
    return (
      <Card className="rounded-2xl p-12 text-center text-muted-foreground">
        Läser in beslut…
      </Card>
    );
  }
  if (days.length === 0) {
    return (
      <Card className="rounded-2xl p-12 text-center text-muted-foreground">
        Inga beslut loggade för denna simulering.
      </Card>
    );
  }

  const currentDay = days[Math.min(dayIndex, days.length - 1)];
  const dayEvents = events.filter(e => isSameDay(parseISO(e.occurred_at), parseISO(currentDay.day)));

  return (
    <div className="space-y-4">
      {/* Day strip */}
      <DayStrip
        days={days}
        dailySavings={dailySavings}
        activeIndex={dayIndex}
        onSelect={setDayIndex}
      />

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-4">
        {/* Chart */}
        <DecisionChart
          dayLabel={currentDay.day}
          logs={currentDay.logs}
          events={dayEvents}
          priceThreshold={priceThreshold}
        />

        {/* Insight panel */}
        <InsightPanel
          dayLabel={currentDay.day}
          logs={currentDay.logs}
          events={dayEvents}
          priceThreshold={priceThreshold}
        />
      </div>

      {/* Day prev/next nav (mobile-friendly) */}
      <div className="flex items-center justify-between gap-2">
        <Button
          variant="outline" size="sm" className="rounded-full gap-1"
          disabled={dayIndex === 0}
          onClick={() => setDayIndex(i => Math.max(0, i - 1))}
        >
          <ChevronLeft className="h-4 w-4" /> Föregående dag
        </Button>
        <span className="text-xs text-muted-foreground">
          Dag {dayIndex + 1} av {days.length}
        </span>
        <Button
          variant="outline" size="sm" className="rounded-full gap-1"
          disabled={dayIndex >= days.length - 1}
          onClick={() => setDayIndex(i => Math.min(days.length - 1, i + 1))}
        >
          Nästa dag <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

/* ===================== DAY STRIP ===================== */
function DayStrip({
  days, dailySavings, activeIndex, onSelect,
}: {
  days: { day: string; logs: Log[] }[];
  dailySavings: Map<string, number>;
  activeIndex: number;
  onSelect: (i: number) => void;
}) {
  return (
    <Card className="rounded-2xl border-border/60 p-3 overflow-x-auto">
      <div className="flex gap-2 min-w-min">
        {days.map((d, i) => {
          const sav = dailySavings.get(d.day) ?? 0;
          const tone = sav > 1 ? "border-emerald-400/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
            : sav < -1 ? "border-red-400/60 bg-red-500/10 text-red-700 dark:text-red-300"
            : "border-border/60 bg-muted/30 text-muted-foreground";
          const date = parseISO(d.day);
          return (
            <button
              key={d.day}
              onClick={() => onSelect(i)}
              className={cn(
                "rounded-xl border px-3 py-2 text-left transition shrink-0",
                tone,
                activeIndex === i && "ring-2 ring-primary border-primary"
              )}
            >
              <div className="text-[10px] uppercase tracking-wider">
                {format(date, "EEE", { locale: sv })}
              </div>
              <div className="text-sm font-semibold">
                {format(date, "d MMM", { locale: sv })}
              </div>
              {Math.abs(sav) > 0.5 && (
                <div className="text-[10px] mt-0.5 tabular-nums">
                  {sav > 0 ? "+" : ""}{sav.toFixed(1)} kr
                </div>
              )}
            </button>
          );
        })}
      </div>
    </Card>
  );
}

/* ===================== CHART ===================== */
function DecisionChart({
  dayLabel, logs, events, priceThreshold,
}: {
  dayLabel: string; logs: Log[]; events: Evt[]; priceThreshold: number;
}) {
  // Build data per hour
  const data = useMemo(() => logs.map(l => {
    const isCharge = l.decision === "charge" || l.decision === "emergency_charge";
    const isV2h = l.decision === "v2h";
    const isV2g = l.decision === "v2g";
    const kw = Number(l.charge_kw ?? 0);
    const reason = l.reason ?? "";
    const isAway = /cable_disconnected|away/i.test(reason);
    const isWaiting = /no_action|similar|waiting/i.test(reason);
    const price = Number(l.spot_price_sek ?? 0);
    let pauseTone: "away" | "expensive" | "waiting" | null = null;
    if (l.decision === "pause") {
      pauseTone = isAway ? "away" : isWaiting ? "waiting" : "expensive";
    }
    return {
      hour: format(parseISO(l.logged_at), "HH:mm"),
      iso: l.logged_at,
      price,
      soc: l.soc_pct != null ? Number(l.soc_pct) : null,
      houseKw: l.house_consumption_kw != null ? Number(l.house_consumption_kw) : null,
      charge: isCharge ? Math.max(0, kw) : 0,
      v2h: isV2h ? -Math.abs(kw || 7) : 0,
      v2g: isV2g ? -Math.abs(kw || 7) : 0,
      decision: l.decision,
      reason,
      isEmergency: l.decision === "emergency_charge",
      isAway,
      pauseTone,
    };
  }), [logs, priceThreshold]);

  // Contiguous "away" ranges for ReferenceArea overlay
  const awayRanges = useMemo(() => {
    const ranges: { x1: string; x2: string }[] = [];
    let start: string | null = null;
    for (let i = 0; i < data.length; i++) {
      const d = data[i];
      if (d.isAway && start === null) start = d.hour;
      const ending = !d.isAway || i === data.length - 1;
      if (ending && start !== null) {
        const endHour = d.isAway ? d.hour : data[i - 1].hour;
        ranges.push({ x1: start, x2: endHour });
        start = null;
      }
    }
    return ranges;
  }, [data]);

  if (data.length === 0) {
    return <Card className="rounded-2xl p-12 text-center text-muted-foreground">Inga datapunkter denna dag.</Card>;
  }

  const maxPrice = Math.max(...data.map(d => d.price), priceThreshold + 0.2, 2.5);
  const date = parseISO(dayLabel);

  return (
    <Card className="rounded-2xl border-border/60 shadow-card p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Beslutsvy</h3>
          <p className="text-base font-semibold capitalize">
            {format(date, "EEEE d MMMM yyyy", { locale: sv })}
          </p>
        </div>
        <div className="flex flex-wrap gap-3 text-[11px]">
          <Legend dot={COLORS.charge} label="Laddning" />
          <Legend dot={COLORS.v2h} label="V2H" />
          <Legend dot={COLORS.v2g} label="V2G" />
          <Legend dot={COLORS.pause} label="Pause" />
          <Legend dot={COLORS.soc} label="SoC %" dashed />
        </div>
      </div>

      {/* Top: price chart with zones */}
      <div className="w-full h-[260px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 50, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
            <XAxis dataKey="hour" tick={{ fontSize: 10 }} interval={1} />
            <YAxis
              yAxisId="price"
              tick={{ fontSize: 10 }}
              domain={[0, Math.ceil(maxPrice * 1.1 * 10) / 10]}
              label={{ value: "SEK/kWh", angle: -90, position: "insideLeft", style: { fontSize: 10, fill: "hsl(var(--muted-foreground))" } }}
            />
            <YAxis
              yAxisId="soc" orientation="right" domain={[0, 100]}
              tick={{ fontSize: 10 }}
              label={{ value: "SoC %", angle: 90, position: "insideRight", style: { fontSize: 10, fill: COLORS.soc } }}
            />
            <YAxis yAxisId="house" hide domain={[0, "dataMax + 2"]} />

            {/* Price zones */}
            <ReferenceArea yAxisId="price" y1={0} y2={DAY_THRESHOLDS[0]} fill={COLORS.green} fillOpacity={0.08} />
            <ReferenceArea yAxisId="price" y1={DAY_THRESHOLDS[0]} y2={DAY_THRESHOLDS[1]} fill={COLORS.yellow} fillOpacity={0.08} />
            <ReferenceArea yAxisId="price" y1={DAY_THRESHOLDS[1]} y2={DAY_THRESHOLDS[2]} fill={COLORS.orange} fillOpacity={0.10} />
            <ReferenceArea yAxisId="price" y1={DAY_THRESHOLDS[2]} y2={maxPrice * 1.5} fill={COLORS.red} fillOpacity={0.10} />

            {/* Bilen borta — gråa zoner */}
            {awayRanges.map((r, i) => (
              <ReferenceArea
                key={`away-${i}`}
                yAxisId="price"
                x1={r.x1}
                x2={r.x2}
                fill="hsl(220, 9%, 85%)"
                fillOpacity={0.4}
                label={i === 0 ? { value: "Bilen borta", fontSize: 10, fill: "hsl(220, 9%, 35%)", position: "insideTop" } : undefined}
              />
            ))}

            {/* Husförbrukning */}
            <Area
              yAxisId="house"
              type="monotone"
              dataKey="houseKw"
              name="Husförbrukning"
              fill="hsl(36, 83%, 70%)"
              fillOpacity={0.2}
              stroke="hsl(36, 83%, 50%)"
              strokeWidth={1.5}
              isAnimationActive={false}
              connectNulls
            />

            {/* Threshold lines */}
            <ReferenceLine yAxisId="price" y={priceThreshold} stroke={COLORS.red} strokeDasharray="5 4" strokeWidth={1.2}
              label={{ value: `Laddningsstopp ${priceThreshold} kr`, fontSize: 10, fill: COLORS.red, position: "right" }} />
            <ReferenceLine yAxisId="price" y={TOO_CHEAP} stroke={COLORS.charge} strokeDasharray="5 4" strokeWidth={1.2}
              label={{ value: "Alltid ladda", fontSize: 10, fill: COLORS.charge, position: "right" }} />

            {/* Event markers */}
            {events.map(ev => {
              const hour = format(parseISO(ev.occurred_at), "HH:mm");
              const meta = EVENT_ICONS[ev.event_type];
              if (!meta) return null;
              return (
                <ReferenceLine
                  key={ev.id}
                  yAxisId="price"
                  x={hour}
                  stroke={meta.color}
                  strokeDasharray="2 3"
                  strokeOpacity={0.6}
                  label={{ value: meta.icon, fontSize: 12, position: "top" }}
                />
              );
            })}

            {/* SoC dashed line */}
            <Line yAxisId="soc" type="monotone" dataKey="soc" stroke={COLORS.soc}
              strokeDasharray="4 3" strokeWidth={1.5} dot={false} connectNulls
              isAnimationActive={false} />

            {/* Price line */}
            <Line yAxisId="price" type="monotone" dataKey="price" stroke={COLORS.price}
              strokeWidth={2.2} dot={false} isAnimationActive={false} />

            <Tooltip content={<HourTooltip />} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Bottom: decision activity bars */}
      <div className="w-full h-[140px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 50, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
            <XAxis dataKey="hour" tick={{ fontSize: 10 }} interval={1} />
            <YAxis
              tick={{ fontSize: 10 }}
              domain={[-12, 12]}
              label={{ value: "kW", angle: -90, position: "insideLeft", style: { fontSize: 10, fill: "hsl(var(--muted-foreground))" } }}
            />
            <ReferenceLine y={0} stroke="hsl(var(--border))" />
            <Tooltip content={<HourTooltip showActivityOnly />} />
            <Bar dataKey="charge" name="Laddning kW" radius={[3, 3, 0, 0]}>
              {data.map((d, i) => (
                <Cell key={i} fill={d.isEmergency ? COLORS.emergency : "hsl(172, 66%, 34%)"} />
              ))}
            </Bar>
            <Bar dataKey="v2h" name="V2H kW" radius={[0, 0, 3, 3]}>
              {data.map((d, i) => (
                <Cell key={i} fill="hsl(239, 84%, 67%)" />
              ))}
            </Bar>
            <Bar dataKey="v2g" name="V2G kW" fill={COLORS.v2g} radius={[0, 0, 3, 3]} />
            {/* Pause indicators (small bar at 1 kW for tone) */}
            <Bar dataKey={(d: any) => d.pauseTone ? 1 : 0} name="Paus" radius={[3, 3, 0, 0]}>
              {data.map((d, i) => {
                const fill =
                  d.pauseTone === "away" ? "hsl(220, 9%, 70%)" :
                  d.pauseTone === "expensive" ? "hsl(13, 68%, 63%)" :
                  d.pauseTone === "waiting" ? "hsl(220, 9%, 88%)" :
                  "transparent";
                return <Cell key={i} fill={fill} />;
              })}
            </Bar>
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Color zone legend */}
      <div className="flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground border-t border-border/40 pt-3">
        <span className="font-semibold uppercase tracking-wider">Prisnivåer</span>
        <ZoneSwatch color={COLORS.green}  label="< 0.50 kr (billigt)" />
        <ZoneSwatch color={COLORS.yellow} label="0.50–1.00 kr (normalt)" />
        <ZoneSwatch color={COLORS.orange} label="1.00–2.00 kr (dyrt)" />
        <ZoneSwatch color={COLORS.red}    label="> 2.00 kr (mycket dyrt)" />
      </div>
    </Card>
  );
}

function Legend({ dot, label, dashed }: { dot: string; label: string; dashed?: boolean }) {
  return (
    <span className="flex items-center gap-1.5 text-muted-foreground">
      {dashed
        ? <span className="inline-block w-4 h-0 border-t-2 border-dashed" style={{ borderColor: dot }} />
        : <span className="h-2.5 w-2.5 rounded-full" style={{ background: dot }} />}
      {label}
    </span>
  );
}
function ZoneSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-2.5 w-4 rounded-sm" style={{ background: color, opacity: 0.35 }} />
      {label}
    </span>
  );
}

/* ===================== TOOLTIP ===================== */
function HourTooltip({ active, payload, showActivityOnly }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload as any;
  const decisionLabel: Record<string, string> = {
    charge: "Laddning", emergency_charge: "Nödladdning",
    v2h: "V2H", v2g: "V2G", pause: "Pause",
  };
  const wouldHaveCost = (p.charge === 0 && p.v2h === 0)
    ? Number((11 * p.price).toFixed(2))
    : null;
  return (
    <div className="rounded-xl border border-border/60 bg-popover/95 backdrop-blur p-3 text-xs shadow-lg space-y-1 min-w-[200px]">
      <div className="font-semibold text-sm">Klockan {p.hour}</div>
      <Row label="Spotpris" value={`${p.price.toFixed(3)} SEK/kWh`} />
      <Row label="Beslut" value={decisionLabel[p.decision] ?? p.decision} />
      {p.soc != null && <Row label="SoC" value={`${p.soc.toFixed(0)}%`} />}
      {p.charge > 0 && <Row label="Laddat" value={`${p.charge.toFixed(1)} kW`} />}
      {p.v2h < 0 && <Row label="V2H" value={`${Math.abs(p.v2h).toFixed(1)} kW`} />}
      <Row label="Anledning" value={prettyReason(p.reason)} muted />
      {!showActivityOnly && wouldHaveCost != null && (
        <div className="pt-1 mt-1 border-t border-border/40 text-emerald-600 dark:text-emerald-400">
          Kostnad om laddat: {wouldHaveCost.toFixed(2)} SEK
        </div>
      )}
    </div>
  );
}
function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-mono", muted && "text-muted-foreground text-[11px]")}>{value}</span>
    </div>
  );
}

/* ===================== INSIGHT PANEL ===================== */
function InsightPanel({
  dayLabel, logs, events, priceThreshold,
}: {
  dayLabel: string; logs: Log[]; events: Evt[]; priceThreshold: number;
}) {
  const sum = useMemo(() => {
    let chargeKwh = 0, v2hKwh = 0, v2hSavings = 0, chargeHours = 0, peakAvoided = 0;
    let cheapest: Log | null = null;
    let dearestAvoided: Log | null = null;
    for (const l of logs) {
      const kw = Number(l.charge_kw ?? 0);
      const price = Number(l.spot_price_sek ?? 0);
      if (l.decision === "charge" || l.decision === "emergency_charge") {
        chargeKwh += Math.max(0, kw); chargeHours++;
        if (!cheapest || price < Number(cheapest.spot_price_sek ?? Infinity)) cheapest = l;
      } else if (l.decision === "v2h") {
        v2hKwh += Math.abs(kw || 7);
        v2hSavings += Number(l.v2h_saving_sek ?? 0);
      } else if (l.decision === "pause" && price > priceThreshold) {
        peakAvoided++;
        if (!dearestAvoided || price > Number(dearestAvoided.spot_price_sek ?? -Infinity)) dearestAvoided = l;
      }
    }
    const v2hRange = events.filter(e => e.event_type === "v2h_started" || e.event_type === "v2h_stopped");
    return { chargeKwh, v2hKwh, v2hSavings, chargeHours, peakAvoided, cheapest, dearestAvoided, v2hRange };
  }, [logs, events, priceThreshold]);

  const totalHours = logs.length || 24;

  // Why didn't ZenOS charge at hour X? Pick the highest-priced "pause" hour with lowest SoC reasoning
  const whyExample = useMemo(() => {
    const paused = logs.filter(l => l.decision === "pause");
    if (paused.length === 0) return null;
    // Prefer mid-day pauses where price was middling and SoC was OK
    const mid = paused
      .filter(l => Number(l.spot_price_sek ?? 0) < priceThreshold)
      .sort((a, b) => Number(b.spot_price_sek ?? 0) - Number(a.spot_price_sek ?? 0))[0]
      ?? paused[0];
    return mid;
  }, [logs, priceThreshold]);

  return (
    <Card className="rounded-2xl border-border/60 shadow-card p-5 space-y-5 h-fit">
      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Dagens sammanfattning</div>
        <div className="h-px bg-border/60 mt-1.5 mb-3" />
        <dl className="space-y-1.5 text-sm">
          <Field label="Laddade" value={`${sum.chargeKwh.toFixed(1)} kWh`} accent={COLORS.charge} />
          <Field label="V2H" value={`${sum.v2hKwh.toFixed(1)} kWh`} accent={COLORS.v2h} />
          {sum.cheapest && (
            <Field
              label="Billigaste laddtimme"
              value={`${format(parseISO(sum.cheapest.logged_at), "HH:mm")} (${Number(sum.cheapest.spot_price_sek).toFixed(2)} kr)`}
            />
          )}
          {sum.dearestAvoided && (
            <Field
              label="Dyraste undvikna timme"
              value={`${format(parseISO(sum.dearestAvoided.logged_at), "HH:mm")} (${Number(sum.dearestAvoided.spot_price_sek).toFixed(2)} kr)`}
            />
          )}
          <Field label="V2H idag" value={`${sum.v2hSavings.toFixed(2)} SEK`} accent={COLORS.v2h} bold />
        </dl>
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">ZenOS beslut</div>
        <div className="h-px bg-border/60 mt-1.5 mb-3" />
        <ul className="space-y-1.5 text-sm">
          <li className="flex items-start gap-2">
            <Zap className="h-4 w-4 mt-0.5 shrink-0" style={{ color: COLORS.charge }} />
            Laddade {sum.chargeHours} av {totalHours} timmar
          </li>
          <li className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" style={{ color: COLORS.orange }} />
            Undvek {sum.peakAvoided} topptimme{sum.peakAvoided === 1 ? "" : "r"}
          </li>
          {sum.v2hRange.length > 0 && (
            <li className="flex items-start gap-2">
              <Battery className="h-4 w-4 mt-0.5 shrink-0" style={{ color: COLORS.v2h }} />
              Aktiverade V2H {format(parseISO(sum.v2hRange[0].occurred_at), "HH:mm")}
              {sum.v2hRange.length > 1 && `–${format(parseISO(sum.v2hRange[sum.v2hRange.length - 1].occurred_at), "HH:mm")}`}
            </li>
          )}
        </ul>
      </div>

      {whyExample && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Varför laddade inte ZenOS kl {format(parseISO(whyExample.logged_at), "HH:mm")}?
          </div>
          <div className="h-px bg-border/60 mt-1.5 mb-3" />
          <div className="rounded-xl bg-muted/40 p-3 text-xs space-y-1.5">
            <div>Pris: <span className="font-mono font-semibold">{Number(whyExample.spot_price_sek).toFixed(2)} SEK</span> — {Number(whyExample.spot_price_sek) > priceThreshold ? "över priströskeln" : "under priströskeln"}</div>
            {whyExample.soc_pct != null && (
              <div>SoC var <span className="font-mono font-semibold">{Number(whyExample.soc_pct).toFixed(0)}%</span> — {Number(whyExample.soc_pct) > 80 ? "tillräckligt för dagen" : "OK för stunden"}</div>
            )}
            <div className="text-muted-foreground italic pt-1 border-t border-border/40">
              {prettyReason(whyExample.reason)}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
function Field({ label, value, accent, bold }: { label: string; value: string; accent?: string; bold?: boolean }) {
  return (
    <div className="flex justify-between items-baseline gap-3">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className={cn("font-mono tabular-nums", bold && "font-semibold")} style={accent ? { color: accent } : undefined}>{value}</dd>
    </div>
  );
}

/* ---------- helpers ---------- */
function prettyReason(r: string | null): string {
  if (!r) return "—";
  const map: Record<string, string> = {
    night_charge_planned: "Nattladdning — billigaste timmen",
    v2h_planned: "V2H — dyrare än batterikostnaden",
    evening_peak_v2h: "Kvällstopp — V2H aktiverad",
    morning_v2h: "Morgon V2H — lönsamt",
    cable_disconnected: "Bilen borta",
    morning_guarantee: "Morgongaranti — laddar",
    v2h_floor_reached: "Batterigolv nått — stoppar V2H",
    no_action: "Inväntar bättre pris",
    too_cheap_to_ignore: "Pris extremt lågt — ladda alltid",
    best_combined_score: "Bästa kombinerade poäng",
    soc_above_95_protect: "Batteri nästan fullt",
    soc_below_20_emergency: "Kritisk SoC — nödladdning",
    minimum_dagsladdning: "Minimum för dagens körning",
    house_peak_consumption: "Hög hushållsförbrukning",
    lower_score: "Lägre prisscore",
    peak_price_v2h: "Topptimme — V2H aktiv",
  };
  // Match prefix like "night_charge_planned: 0.42 SEK/kWh"
  const key = r.split(":")[0].trim();
  if (map[key]) return map[key];
  for (const k of Object.keys(map)) {
    if (r.includes(k)) return map[k];
  }
  if (r.startsWith("spot_above_")) return "Pris över tröskel";
  return r.replace(/_/g, " ");
}
