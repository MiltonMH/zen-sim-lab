import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { format, isSameDay } from "date-fns";
import { sv } from "date-fns/locale";
import { cn } from "@/lib/utils";

interface SimEvent {
  id: string;
  occurred_at: string;
  event_type: string;
  value_kw: number | null;
  value_soc_pct: number | null;
  value_price_sek: number | null;
  value_sek_impact: number | null;
  reason: string | null;
}

interface Style {
  color: string;       // tailwind bg color for the dot
  label: string;
  category: Category;
}
type Category = "charging" | "v2h" | "v2g" | "cable" | "price" | "soc";

const STYLES: Record<string, Style> = {
  charging_started:        { color: "bg-emerald-500",  label: "LADDNING STARTAD",     category: "charging" },
  charging_stopped:        { color: "bg-muted-foreground", label: "LADDNING STOPPAD", category: "charging" },
  v2h_started:             { color: "bg-sky-500",      label: "V2H STARTAD",          category: "v2h" },
  v2h_stopped:             { color: "bg-sky-500",      label: "V2H STOPPAD",          category: "v2h" },
  v2g_started:             { color: "bg-purple-500",   label: "V2G STARTAD",          category: "v2g" },
  v2g_stopped:             { color: "bg-purple-500",   label: "V2G STOPPAD",          category: "v2g" },
  cable_connected:         { color: "bg-teal-500",     label: "KABEL INKOPPLAD",      category: "cable" },
  cable_disconnected:      { color: "bg-teal-500",     label: "KABEL URKOPPLAD",      category: "cable" },
  emergency_charge_started:{ color: "bg-red-500",      label: "NÖDLADDNING STARTAD",  category: "charging" },
  cheap_price_detected:    { color: "bg-emerald-500",  label: "LÅGT PRIS DETEKTERAT", category: "price" },
  expensive_price_detected:{ color: "bg-orange-500",   label: "HÖGT PRIS DETEKTERAT", category: "price" },
  soc_minimum_hit:         { color: "bg-red-500",      label: "SoC MINIMIGRÄNS",      category: "soc" },
  soc_limit_reached:       { color: "bg-red-500",      label: "SoC GRÄNS NÅDD",       category: "soc" },
  price_threshold_hit:     { color: "bg-orange-500",   label: "PRISTRÖSKEL",          category: "price" },
  schedule_override:       { color: "bg-muted-foreground", label: "SCHEMA-ÖVERSTYRNING", category: "charging" },
};

const FILTERS: { id: Category | "all"; label: string }[] = [
  { id: "all",      label: "Alla" },
  { id: "charging", label: "Laddning" },
  { id: "v2h",      label: "V2H" },
  { id: "cable",    label: "Kabel" },
  { id: "price",    label: "Pris" },
  { id: "soc",      label: "SoC" },
];

interface Props {
  simulationId: string;
  householdName?: string | null;
  periodFrom: string;
  periodTo: string;
}

export default function EventTimeline({ simulationId, householdName, periodFrom, periodTo }: Props) {
  const [events, setEvents] = useState<SimEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState<Category | "all">("all");

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("simulation_events")
        .select("id, occurred_at, event_type, value_kw, value_soc_pct, value_price_sek, value_sek_impact, reason")
        .eq("simulation_id", simulationId)
        .order("occurred_at", { ascending: true });
      if (!active) return;
      if (error) console.error("event fetch", error);
      setEvents((data ?? []) as SimEvent[]);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [simulationId]);

  const filtered = useMemo(() => {
    if (activeFilter === "all") return events;
    return events.filter(e => (STYLES[e.event_type]?.category ?? "charging") === activeFilter);
  }, [events, activeFilter]);

  const stats = useMemo(() => {
    let charging = 0, v2h = 0, price = 0;
    for (const e of events) {
      const cat = STYLES[e.event_type]?.category;
      if (cat === "charging") charging++;
      else if (cat === "v2h" && e.event_type === "v2h_started") v2h++;
      else if (cat === "price") price++;
    }
    return { total: events.length, charging, v2h, price };
  }, [events]);

  const runningTotal = useMemo(
    () => filtered.reduce((s, e) => s + Number(e.value_sek_impact ?? 0), 0),
    [filtered]
  );

  const exportCsv = () => {
    const cols = ["Tidpunkt", "Händelse", "kW", "SoC%", "Pris", "SEK-påverkan", "Anledning"];
    const rows = events.map(e => [
      format(new Date(e.occurred_at), "yyyy-MM-dd HH:mm"),
      STYLES[e.event_type]?.label ?? e.event_type,
      e.value_kw ?? "",
      e.value_soc_pct ?? "",
      e.value_price_sek ?? "",
      e.value_sek_impact ?? "",
      (e.reason ?? "").replace(/"/g, '""'),
    ].map(v => /[",\n]/.test(String(v)) ? `"${v}"` : String(v)).join(","));
    const csv = [cols.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `zenios-events-${simulationId.slice(0, 8)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (loading) {
    return <Card className="rounded-2xl p-12 text-center text-muted-foreground">Laddar händelselogg…</Card>;
  }

  return (
    <Card className="rounded-2xl border-border/60 shadow-card overflow-hidden">
      {/* Header */}
      <div className="px-6 py-5 border-b border-border/60">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Händelselogg</h3>
            <p className="text-base font-medium mt-1">
              {householdName ?? "—"} · {periodFrom} → {periodTo}
            </p>
          </div>
          <Button variant="outline" size="sm" className="rounded-full gap-2" onClick={exportCsv}>
            <Download className="h-3.5 w-3.5" /> Exportera CSV
          </Button>
        </div>

        {/* Summary bar */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5">
          <SummaryStat label="Totalt händelser" value={stats.total} />
          <SummaryStat label="Laddningar" value={stats.charging} />
          <SummaryStat label="V2H sessioner" value={stats.v2h} />
          <SummaryStat label="Prisvarningar" value={stats.price} />
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2 mt-5">
          {FILTERS.map(f => (
            <button
              key={f.id}
              onClick={() => setActiveFilter(f.id)}
              className={cn(
                "px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
                activeFilter === f.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/70"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Timeline */}
      <div className="p-6">
        {filtered.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            Inga händelser för aktuellt filter.
          </div>
        ) : (
          <Timeline events={filtered} />
        )}

        {filtered.length > 0 && (
          <div className="mt-6 pt-4 border-t border-border/60 flex items-center justify-between">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">Total påverkan</span>
            <span className={cn(
              "font-semibold text-base",
              runningTotal > 0 ? "text-emerald-600" : runningTotal < 0 ? "text-destructive" : "text-muted-foreground"
            )}>
              {runningTotal > 0 ? "+" : ""}{runningTotal.toFixed(2)} SEK
            </span>
          </div>
        )}
      </div>
    </Card>
  );
}

function Timeline({ events }: { events: SimEvent[] }) {
  let prevDay: Date | null = null;
  return (
    <div className="relative">
      {events.map((e, idx) => {
        const d = new Date(e.occurred_at);
        const showDay = !prevDay || !isSameDay(prevDay, d);
        prevDay = d;
        return (
          <div key={e.id}>
            {showDay && <DaySeparator date={d} />}
            <EventRow event={e} isLast={idx === events.length - 1} />
          </div>
        );
      })}
    </div>
  );
}

function DaySeparator({ date }: { date: Date }) {
  const txt = format(date, "EEEE d MMMM yyyy", { locale: sv });
  return (
    <div className="flex items-center gap-3 my-4">
      <div className="flex-1 h-px bg-border" />
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">{txt}</span>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}

function EventRow({ event, isLast }: { event: SimEvent; isLast: boolean }) {
  const style = STYLES[event.event_type] ?? { color: "bg-muted-foreground", label: event.event_type, category: "charging" as Category };
  const time = format(new Date(event.occurred_at), "HH:mm");
  const impact = event.value_sek_impact != null ? Number(event.value_sek_impact) : null;

  return (
    <div className="relative flex gap-4 pb-5">
      {/* Dot + connecting line */}
      <div className="relative flex flex-col items-center">
        <div className={cn("h-3 w-3 rounded-full mt-1.5 ring-4 ring-background", style.color)} />
        {!isLast && <div className="flex-1 w-px bg-border mt-1" />}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 pb-1">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-xs text-muted-foreground tabular-nums">{time}</span>
            <span className="text-sm font-semibold tracking-wide">{style.label}</span>
          </div>
          {impact != null && impact !== 0 && (
            <span className={cn(
              "font-mono text-sm font-semibold tabular-nums",
              impact > 0 ? "text-emerald-600" : "text-destructive"
            )}>
              {impact > 0 ? "+" : ""}{impact.toFixed(2)} SEK
            </span>
          )}
        </div>
        <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
          {event.value_price_sek != null && (
            <div>Pris: <span className="font-mono">{Number(event.value_price_sek).toFixed(3)} SEK/kWh</span></div>
          )}
          {event.value_kw != null && event.value_kw !== 0 && (
            <div>Effekt: <span className="font-mono">{Number(event.value_kw).toFixed(1)} kW</span></div>
          )}
          {event.value_soc_pct != null && (
            <div>SoC: <span className="font-mono">{Number(event.value_soc_pct).toFixed(0)}%</span></div>
          )}
          {event.reason && <div className="italic">{event.reason}</div>}
        </div>
      </div>
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border/40 bg-background/60 px-4 py-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-semibold text-lg mt-1 tabular-nums">{value}</div>
    </div>
  );
}
