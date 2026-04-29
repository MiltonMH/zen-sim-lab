import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ListFilter, Layers, FileText, Download, Activity,
} from "lucide-react";
import { LineChart, Line, ResponsiveContainer } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import SimulationDetail from "@/pages/SimulationDetail";
import EventTimeline from "@/components/EventTimeline";
import HouseholdProfile from "@/pages/HouseholdProfile";
import { cn } from "@/lib/utils";
import { modeLabel } from "@/lib/optimizationModes";
import { HOUSEHOLD_TYPE_FILTERS, householdTypeMeta, type HouseholdType } from "@/lib/householdTypes";

type View = "all" | "households" | "logs";

interface SimRow {
  id: string;
  household_id: string | null;
  period_from: string;
  period_to: string;
  optimization_mode: string;
  total_saved_sek: number | null;
  total_v2h_saving_sek: number | null;
  scenarios: number | null;
  status: string | null;
  started_at: string | null;
}
interface HouseholdRow {
  id: string;
  name: string;
}

function fmtSek(n: number | null | undefined, digits = 2) {
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

/* ───────────────── Tab 1: Alla simuleringar ───────────────── */
function AllSimsTab({
  sims, households, householdMap, onOpen,
}: {
  sims: SimRow[];
  households: HouseholdRow[];
  householdMap: Map<string, string>;
  onOpen: (id: string) => void;
}) {
  const [householdFilter, setHouseholdFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [sortBy, setSortBy] = useState<"date" | "saved" | "household">("date");
  const [exporting, setExporting] = useState(false);

  const filtered = useMemo(() => {
    let out = [...sims];
    if (householdFilter !== "all") out = out.filter((s) => s.household_id === householdFilter);
    if (statusFilter !== "all") out = out.filter((s) => (s.status ?? "") === statusFilter);
    if (from) out = out.filter((s) => s.period_to >= from);
    if (to) out = out.filter((s) => s.period_from <= to);
    out.sort((a, b) => {
      if (sortBy === "saved") return Number(b.total_saved_sek ?? 0) - Number(a.total_saved_sek ?? 0);
      if (sortBy === "household") {
        const an = householdMap.get(a.household_id ?? "") ?? "";
        const bn = householdMap.get(b.household_id ?? "") ?? "";
        return an.localeCompare(bn, "sv");
      }
      return (b.started_at ?? "").localeCompare(a.started_at ?? "");
    });
    return out;
  }, [sims, householdFilter, statusFilter, from, to, sortBy, householdMap]);

  const exportFiltered = async () => {
    if (filtered.length === 0) return;
    setExporting(true);
    try {
      const simIds = filtered.map((s) => s.id);
      const householdIds = Array.from(new Set(filtered.map((s) => s.household_id).filter(Boolean))) as string[];

      // Chunk helper for IN clauses (Postgres practical limit)
      const chunk = (arr: string[], size = 100): string[][] => {
        const out: string[][] = [];
        for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
        return out;
      };

      const fetchAll = async (table: "simulation_events" | "optimization_logs", column: string, ids: string[]) => {
        const rows: any[] = [];
        for (const ch of chunk(ids)) {
          const { data } = await (supabase as any).from(table).select("*").in(column, ch);
          if (data) rows.push(...(data as any[]));
        }
        return rows;
      };

      const [fullSims, householdProfiles, events, logs] = await Promise.all([
        (async () => {
          const out: any[] = [];
          for (const ch of chunk(simIds)) {
            const { data } = await supabase.from("simulation_runs").select("*").in("id", ch);
            if (data) out.push(...data);
          }
          return out;
        })(),
        householdIds.length
          ? (async () => {
              const out: any[] = [];
              for (const ch of chunk(householdIds)) {
                const { data } = await supabase.from("household_profiles").select("*").in("id", ch);
                if (data) out.push(...data);
              }
              return out;
            })()
          : Promise.resolve([]),
        fetchAll("simulation_events", "simulation_id", simIds),
        householdIds.length ? fetchAll("optimization_logs", "household_id", householdIds) : Promise.resolve([]),
      ]);

      const payload = {
        exported_at: new Date().toISOString(),
        filters: {
          household_id: householdFilter === "all" ? null : householdFilter,
          household_name: householdFilter === "all" ? "Alla hushåll" : householdMap.get(householdFilter) ?? null,
          status: statusFilter === "all" ? null : statusFilter,
          date_from: from || null,
          date_to: to || null,
        },
        counts: {
          simulations: fullSims.length,
          households: householdProfiles.length,
          events: events.length,
          optimization_logs: logs.length,
        },
        households: householdProfiles,
        simulations: fullSims,
        simulation_events: events,
        optimization_logs: logs,
      };

      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const stamp = new Date().toISOString().slice(0, 10);
      const scope = householdFilter === "all" ? "alla-hushall" : (householdMap.get(householdFilter) ?? "hushall").toLowerCase().replace(/\s+/g, "-");
      const range = from || to ? `_${from || "start"}_till_${to || "slut"}` : "";
      a.href = url;
      a.download = `simuleringar_${scope}${range}_${stamp}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="rounded-2xl border-border/60 shadow-card p-4">
        <div className="flex items-center gap-3 flex-wrap">
          <ListFilter className="h-4 w-4 text-muted-foreground" />
          <Select value={householdFilter} onValueChange={setHouseholdFilter}>
            <SelectTrigger className="w-[200px] rounded-full"><SelectValue placeholder="Hushåll" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alla hushåll</SelectItem>
              {households.map((h) => (
                <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-[160px] rounded-full" />
          <span className="text-xs text-muted-foreground">till</span>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-[160px] rounded-full" />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[160px] rounded-full"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alla statusar</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Sortera</span>
            <Select value={sortBy} onValueChange={(v) => setSortBy(v as any)}>
              <SelectTrigger className="w-[160px] rounded-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="date">Datum</SelectItem>
                <SelectItem value="saved">Sparat</SelectItem>
                <SelectItem value="household">Hushåll</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              className="rounded-full gap-2"
              onClick={exportFiltered}
              disabled={exporting || filtered.length === 0}
              title={`Exportera ${filtered.length} simuleringar`}
            >
              <Download className="h-3.5 w-3.5" />
              {exporting ? "Exporterar…" : `Exportera (${filtered.length})`}
            </Button>
          </div>
        </div>
      </Card>

      <Card className="rounded-2xl border-border/60 shadow-card overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">Inga simuleringar matchar filtren.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left px-5 py-2.5 font-medium">Datum</th>
                <th className="text-left px-5 py-2.5 font-medium">Hushåll</th>
                <th className="text-left px-5 py-2.5 font-medium">Period</th>
                <th className="text-left px-5 py-2.5 font-medium">Läge</th>
                <th className="text-right px-5 py-2.5 font-medium">Sparat</th>
                <th className="text-right px-5 py-2.5 font-medium">V2H</th>
                <th className="text-right px-5 py-2.5 font-medium">Scenarion</th>
                <th className="text-left px-5 py-2.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr
                  key={s.id}
                  className="border-t border-border/60 hover:bg-muted/30 cursor-pointer transition-colors"
                  onClick={() => onOpen(s.id)}
                >
                  <td className="px-5 py-3 text-muted-foreground tabular-nums">{fmtDateTime(s.started_at)}</td>
                  <td className="px-5 py-3 font-medium">{s.household_id ? householdMap.get(s.household_id) ?? "—" : "—"}</td>
                  <td className="px-5 py-3 tabular-nums">{fmtDate(s.period_from)} – {fmtDate(s.period_to)}</td>
                  <td className="px-5 py-3"><Badge variant="secondary" className="rounded-full">{modeLabel(s.optimization_mode)}</Badge></td>
                  <td className="px-5 py-3 text-right tabular-nums text-emerald-600 dark:text-emerald-400 font-medium">{fmtSek(Number(s.total_saved_sek ?? 0))}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-sky-600 dark:text-sky-400">{fmtSek(Number(s.total_v2h_saving_sek ?? 0))}</td>
                  <td className="px-5 py-3 text-right tabular-nums">{s.scenarios ?? 1}</td>
                  <td className="px-5 py-3"><StatusPill status={s.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

/* ───────────────── Tab 2: Per hushåll (cards) ───────────────── */
interface HouseholdCardData {
  id: string;
  name: string;
  house_type: string | null;
  area_m2: number | null;
  price_area: string | null;
  heating_type: string | null;
  car_model: string | null;
  battery_kwh: number | null;
  ev_brand: string | null;
  ev_model: string | null;
  ev_battery: number | null;
  ccs2_port: boolean;
  household_type: string | null;
}

function cap(s: string | null | undefined) {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function PerHouseholdTab({
  sims, households, onOpenHousehold,
}: {
  sims: SimRow[];
  households: HouseholdCardData[];
  onOpenHousehold: (id: string) => void;
}) {
  const grouped = useMemo(() => {
    const g = new Map<string, SimRow[]>();
    sims.forEach((s) => {
      if (!s.household_id) return;
      const arr = g.get(s.household_id) ?? [];
      arr.push(s);
      g.set(s.household_id, arr);
    });
    return households
      .map((hh) => {
        const rows = (g.get(hh.id) ?? []).sort((a, b) => (a.started_at ?? "").localeCompare(b.started_at ?? ""));
        const totalSaved = rows.reduce((a, r) => a + Number(r.total_saved_sek ?? 0), 0);
        const totalV2h = rows.reduce((a, r) => a + Number(r.total_v2h_saving_sek ?? 0), 0);
        const avg = rows.length ? totalSaved / rows.length : 0;
        const last10 = rows.slice(-10).map((r, i) => ({ i, v: Number(r.total_saved_sek ?? 0) }));
        const trendUp = last10.length >= 2 && last10[last10.length - 1].v >= last10[0].v;
        return {
          ...hh,
          rows,
          totalSaved,
          totalV2h,
          avg,
          last10,
          trendUp,
        };
      })
      .filter((h) => h.rows.length > 0)
      .sort((a, b) => b.totalSaved - a.totalSaved);
  }, [sims, households]);

  if (grouped.length === 0) {
    return (
      <Card className="rounded-2xl border-border/60 shadow-card p-10 text-center text-sm text-muted-foreground">
        Inga simuleringar ännu.
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {grouped.map((g) => {
        const carText = g.ev_brand
          ? `${g.ev_brand} ${g.ev_model}${g.ev_battery ? ` | ${g.ev_battery} kWh` : ""}`
          : g.car_model
            ? `${g.car_model}${g.battery_kwh ? ` | ${g.battery_kwh} kWh` : ""}`
            : "Bil okänd";
        const meta = [
          g.house_type && g.area_m2 ? `${cap(g.house_type)} ${g.area_m2}m²` : g.house_type ? cap(g.house_type) : null,
          g.price_area,
          g.heating_type ? cap(g.heating_type) : null,
        ].filter(Boolean).join(" | ");
        return (
          <button
            key={g.id}
            onClick={() => onOpenHousehold(g.id)}
            className="text-left group"
          >
            <Card className="rounded-2xl border-border/60 shadow-card p-5 transition-all hover:shadow-md hover:border-primary/30">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-base font-semibold tracking-tight truncate">{g.name}</div>
                  <div className="text-[12px] text-muted-foreground mt-0.5 truncate">{meta || "—"}</div>
                  <div className="text-[12px] text-muted-foreground truncate">{carText}</div>
                </div>
                {g.ccs2_port !== false && (
                  <Badge className="rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-transparent shrink-0">CCS2</Badge>
                )}
              </div>

              <div className="border-t border-border/60 my-4" />

              <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                <CardStat label="Snittbesparing" value={`${g.avg.toLocaleString("sv-SE", { maximumFractionDigits: 2 })} SEK/sim`} />
                <CardStat label="Total sparat" value={fmtSek(g.totalSaved, 0)} accent="emerald" />
                <CardStat label="V2H sparat" value={fmtSek(g.totalV2h, 0)} accent="sky" />
                <CardStat label="Simuleringar" value={`${g.rows.length} st`} />
              </div>

              {g.last10.length >= 2 && (
                <div className="mt-4">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Trend (senaste {g.last10.length})</div>
                  <div className="h-10">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={g.last10}>
                        <Line
                          type="monotone"
                          dataKey="v"
                          stroke={g.trendUp ? "hsl(142 71% 45%)" : "hsl(var(--muted-foreground))"}
                          strokeWidth={1.75}
                          dot={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </Card>
          </button>
        );
      })}
    </div>
  );
}

function CardStat({ label, value, accent }: { label: string; value: string; accent?: "emerald" | "sky" }) {
  const tone =
    accent === "emerald" ? "text-emerald-600 dark:text-emerald-400"
    : accent === "sky" ? "text-sky-600 dark:text-sky-400"
    : "text-foreground";
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn("text-sm font-medium tabular-nums mt-0.5", tone)}>{value}</div>
    </div>
  );
}

/* ───────────────── Tab 3: Händelseloggar ───────────────── */
function LogsTab({
  sims, households, householdMap,
}: {
  sims: SimRow[];
  households: HouseholdRow[];
  householdMap: Map<string, string>;
}) {
  const [householdId, setHouseholdId] = useState<string>("all");
  const [simulationId, setSimulationId] = useState<string>("");

  const visibleSims = useMemo(() => {
    if (householdId === "all") return sims;
    return sims.filter((s) => s.household_id === householdId);
  }, [sims, householdId]);

  // Auto-pick first matching simulation when filters change
  useEffect(() => {
    if (visibleSims.length === 0) {
      setSimulationId("");
    } else if (!visibleSims.find((s) => s.id === simulationId)) {
      setSimulationId(visibleSims[0].id);
    }
  }, [visibleSims, simulationId]);

  const sim = sims.find((s) => s.id === simulationId);
  const householdName = sim?.household_id ? householdMap.get(sim.household_id) ?? "—" : "—";

  const exportJson = async () => {
    if (!simulationId) return;
    const { data } = await supabase
      .from("simulation_events")
      .select("*")
      .eq("simulation_id", simulationId)
      .order("occurred_at", { ascending: true });
    const blob = new Blob([JSON.stringify(data ?? [], null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `events-${simulationId.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <Card className="rounded-2xl border-border/60 shadow-card p-4">
        <div className="flex items-center gap-3 flex-wrap">
          <Activity className="h-4 w-4 text-muted-foreground" />
          <Select value={householdId} onValueChange={setHouseholdId}>
            <SelectTrigger className="w-[220px] rounded-full"><SelectValue placeholder="Hushåll" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alla hushåll</SelectItem>
              {households.map((h) => (
                <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={simulationId} onValueChange={setSimulationId} disabled={visibleSims.length === 0}>
            <SelectTrigger className="w-[320px] rounded-full"><SelectValue placeholder="Välj simulering" /></SelectTrigger>
            <SelectContent>
              {visibleSims.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {fmtDate(s.period_from)}–{fmtDate(s.period_to)} · {s.household_id ? householdMap.get(s.household_id) : ""} · {modeLabel(s.optimization_mode)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="ml-auto">
            <Button variant="outline" size="sm" className="rounded-full gap-2" onClick={exportJson} disabled={!simulationId}>
              <Download className="h-3.5 w-3.5" /> Exportera (JSON)
            </Button>
          </div>
        </div>
      </Card>

      {sim ? (
        <EventTimeline
          simulationId={sim.id}
          householdName={householdName}
          periodFrom={sim.period_from}
          periodTo={sim.period_to}
        />
      ) : (
        <Card className="rounded-2xl border-border/60 shadow-card p-10 text-center text-sm text-muted-foreground">
          Välj en simulering för att se händelseloggen.
        </Card>
      )}
    </div>
  );
}

/* ───────────────── Slide-over wrapper around SimulationDetail ───────────────── */
function SimulationSlideOver({
  simulationId, onClose,
}: {
  simulationId: string | null;
  onClose: () => void;
}) {
  return (
    <Sheet open={!!simulationId} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-3xl lg:max-w-4xl overflow-y-auto p-0"
      >
        {simulationId && (
          <div className="px-6 py-6">
            <SimulationDetail simulationId={simulationId} onBack={onClose} />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

/* ───────────────── Page ───────────────── */
type LegacyView = "overview" | "households" | "logs";

export default function ResultatLoggar({
  initialView = "all",
  initialSimulationId,
  initialHouseholdId,
}: {
  initialView?: View | LegacyView;
  initialSimulationId?: string;
  initialHouseholdId?: string;
} = {}) {
  // Map legacy view names from older navigation events
  const mapped: View =
    initialView === "overview" ? "all"
    : initialView === "households" ? "households"
    : initialView === "logs" ? "logs"
    : (initialView as View);

  const [tab, setTab] = useState<View>(mapped);
  const [sims, setSims] = useState<SimRow[]>([]);
  const [households, setHouseholds] = useState<HouseholdRow[]>([]);
  const [householdCards, setHouseholdCards] = useState<HouseholdCardData[]>([]);
  const [openId, setOpenId] = useState<string | null>(initialSimulationId ?? null);
  const [profileHouseholdId, setProfileHouseholdId] = useState<string | null>(initialHouseholdId ?? null);

  useEffect(() => {
    (async () => {
      const [{ data: simData }, { data: hhData }, { data: evData }] = await Promise.all([
        supabase
          .from("simulation_runs")
          .select("id, household_id, period_from, period_to, optimization_mode, total_saved_sek, total_v2h_saving_sek, scenarios, status, started_at")
          .order("started_at", { ascending: false })
          .limit(500),
        supabase
          .from("household_profiles")
          .select("id, name, house_type, area_m2, price_area, heating_type, car_model, battery_kwh, ev_model_id")
          .order("name"),
        supabase.from("ev_models").select("id, brand, model, battery_kwh, ccs2_port"),
      ]);
      setSims((simData ?? []) as SimRow[]);
      const hhRows = (hhData ?? []) as Array<HouseholdRow & {
        house_type: string | null; area_m2: number | null; price_area: string | null;
        heating_type: string | null; car_model: string | null; battery_kwh: number | null;
        ev_model_id: string | null;
      }>;
      setHouseholds(hhRows.map((h) => ({ id: h.id, name: h.name })));
      const evMap = new Map<string, { brand: string; model: string; battery_kwh: number; ccs2_port: boolean }>();
      (evData ?? []).forEach((e: any) => evMap.set(e.id, e));
      setHouseholdCards(hhRows.map((h) => {
        const ev = h.ev_model_id ? evMap.get(h.ev_model_id) : undefined;
        return {
          id: h.id,
          name: h.name,
          house_type: h.house_type,
          area_m2: h.area_m2,
          price_area: h.price_area,
          heating_type: h.heating_type,
          car_model: h.car_model,
          battery_kwh: h.battery_kwh,
          ev_brand: ev?.brand ?? null,
          ev_model: ev?.model ?? null,
          ev_battery: ev?.battery_kwh ?? null,
          ccs2_port: ev?.ccs2_port !== false,
        };
      }));
    })();
  }, []);

  const householdMap = useMemo(() => {
    const m = new Map<string, string>();
    households.forEach((h) => m.set(h.id, h.name));
    return m;
  }, [households]);

  // If a household profile is selected, render the full profile page instead of the tabs.
  if (profileHouseholdId) {
    return (
      <HouseholdProfile
        householdId={profileHouseholdId}
        onBack={() => { setProfileHouseholdId(null); setTab("households"); }}
        onBackToResults={() => { setProfileHouseholdId(null); setTab("all"); }}
        onOpenSimulation={(id) => setOpenId(id)}
      />
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Resultat & Loggar</h1>
        <p className="text-muted-foreground mt-1.5 text-sm">
          Bläddra i alla simuleringar, gruppera per hushåll eller granska händelseloggen.
        </p>
      </header>

      <Tabs value={tab} onValueChange={(v) => setTab(v as View)}>
        <TabsList className="rounded-full bg-muted p-1">
          <TabsTrigger value="all" className="rounded-full px-5 gap-2">
            <Layers className="h-3.5 w-3.5" /> Alla simuleringar
          </TabsTrigger>
          <TabsTrigger value="households" className="rounded-full px-5 gap-2">
            <Layers className="h-3.5 w-3.5" /> Per hushåll
          </TabsTrigger>
          <TabsTrigger value="logs" className="rounded-full px-5 gap-2">
            <FileText className="h-3.5 w-3.5" /> Händelseloggar
          </TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="mt-6">
          <AllSimsTab
            sims={sims}
            households={households}
            householdMap={householdMap}
            onOpen={setOpenId}
          />
        </TabsContent>
        <TabsContent value="households" className="mt-6">
          <PerHouseholdTab
            sims={sims}
            households={householdCards}
            onOpenHousehold={(id) => setProfileHouseholdId(id)}
          />
        </TabsContent>
        <TabsContent value="logs" className="mt-6">
          <LogsTab sims={sims} households={households} householdMap={householdMap} />
        </TabsContent>
      </Tabs>

      <SimulationSlideOver simulationId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}
