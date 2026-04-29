import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CalendarIcon, Loader2, CheckCircle2, Download } from "lucide-react";
import { format, subDays } from "date-fns";
import type { DateRange } from "react-day-picker";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const modes = [
  { id: "none", label: "No optimization", desc: "Baseline — charge whenever connected" },
  { id: "price", label: "Price optimization", desc: "Charge during the cheapest hours" },
  { id: "full", label: "Full ZenOS", desc: "Price + grid tariff + battery health" },
];

const PRICE_THRESHOLDS = [1.5, 2.0, 2.5];
const SECONDS_PER_SCENARIO = 3; // rough estimate for ETA

interface ScenarioParams {
  starting_soc: number;
  daily_km_multiplier: number;
  price_threshold: number;
  min_soc: number;
  departure_offset_hours: number;
}
interface RunResult {
  total_saved_sek: number;
  price_savings_sek: number;
  total_v2h_saving_sek: number;
  total_kwh_charged: number;
  total_v2h_kwh: number;
  peak_hours_avoided: number;
  avg_price_paid: number;
  v2x_capable: boolean;
  decisions_logged: number;
  days_processed: number;
}
interface Household {
  id: string; name: string;
  car_model: string | null; price_area: string | null; ev_model_id: string | null;
}
interface ScenarioRunOutcome {
  scenario_number: number;
  params: ScenarioParams;
  result: RunResult | null;
  error?: string;
}

function generateScenarioParams(n: number): ScenarioParams {
  return {
    starting_soc: Math.round(20 + Math.random() * 70),
    daily_km_multiplier: Number((0.7 + Math.random() * 0.6).toFixed(2)),
    departure_offset_hours: Math.round((Math.random() * 2 - 1) * 10) / 10,
    price_threshold: PRICE_THRESHOLDS[(n - 1) % PRICE_THRESHOLDS.length],
    min_soc: Math.round(15 + Math.random() * 20),
  };
}

async function runOneSimulation(
  householdId: string,
  periodFrom: string,
  periodTo: string,
  mode: string,
  scenarioCount: number,
  scenarioNumber: number,
): Promise<ScenarioRunOutcome> {
  const params = generateScenarioParams(scenarioNumber);
  const { data: ins, error } = await supabase.from("simulation_runs").insert({
    household_id: householdId,
    period_from: periodFrom,
    period_to: periodTo,
    optimization_mode: mode,
    scenarios: scenarioCount,
    scenario_number: scenarioNumber,
    scenario_params: params as unknown as Record<string, unknown>,
    status: "pending",
  } as never).select("id").single();
  if (error || !ins) {
    return { scenario_number: scenarioNumber, params, result: null, error: error?.message ?? "insert failed" };
  }
  const { data: fnData, error: fnErr } = await supabase.functions.invoke("run-simulation", {
    body: { simulation_id: ins.id },
  });
  if (fnErr) return { scenario_number: scenarioNumber, params, result: null, error: fnErr.message };
  return { scenario_number: scenarioNumber, params, result: fnData as RunResult };
}

export default function SimulationRunner({
  initialMode = "single",
  preselectedHouseholdId,
}: { initialMode?: "single" | "bulk"; preselectedHouseholdId?: string } = {}) {
  const [pageMode, setPageMode] = useState<"single" | "bulk">(initialMode);
  const [households, setHouseholds] = useState<Household[]>([]);
  const [evMap, setEvMap] = useState<Record<string, { v2x_capable: boolean; brand: string; model: string }>>({});
  const [bounds, setBounds] = useState<{ min: Date; max: Date } | null>(null);

  useEffect(() => {
    (async () => {
      const [{ data: hh }, { data: ev }, { data: minRow }, { data: maxRow }] = await Promise.all([
        supabase.from("household_profiles").select("id,name,car_model,price_area,ev_model_id").order("created_at", { ascending: false }),
        supabase.from("ev_models").select("id,brand,model,v2x_capable"),
        supabase.from("spot_prices").select("hour").order("hour", { ascending: true }).limit(1).maybeSingle(),
        supabase.from("spot_prices").select("hour").order("hour", { ascending: false }).limit(1).maybeSingle(),
      ]);
      setHouseholds((hh ?? []) as Household[]);
      const m: Record<string, any> = {};
      (ev ?? []).forEach((e: any) => { m[e.id] = e; });
      setEvMap(m);
      if (minRow?.hour && maxRow?.hour) setBounds({ min: new Date(minRow.hour), max: new Date(maxRow.hour) });
    })();
  }, []);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Run Simulation</h1>
        <p className="text-muted-foreground mt-1.5 text-sm">Configure and execute a scenario batch.</p>
      </header>

      <div className="flex justify-center">
        <div className="inline-flex rounded-full bg-muted p-1">
          {[
            { id: "single", label: "Enskild simulering" },
            { id: "bulk", label: "Bulk-körning" },
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setPageMode(t.id as "single" | "bulk")}
              className={cn(
                "px-5 py-2 rounded-full text-sm font-medium transition-colors",
                pageMode === t.id ? "bg-background shadow-soft text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {pageMode === "single"
        ? <SingleMode households={households} bounds={bounds} />
        : <BulkMode households={households} evMap={evMap} bounds={bounds} />}
    </div>
  );
}

/* ============================ SINGLE MODE ============================ */
function SingleMode({ households, bounds }: { households: Household[]; bounds: { min: Date; max: Date } | null }) {
  const [mode, setMode] = useState("price");
  const [scenarios, setScenarios] = useState([10]);
  const [range, setRange] = useState<DateRange | undefined>(undefined);
  const [householdId, setHouseholdId] = useState<string>("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [outcomes, setOutcomes] = useState<ScenarioRunOutcome[]>([]);

  useEffect(() => {
    if (!bounds || range) return;
    const from = subDays(bounds.max, 30);
    setRange({ from: from < bounds.min ? bounds.min : from, to: bounds.max });
  }, [bounds, range]);

  const handleRun = async () => {
    if (!householdId || !range?.from || !range?.to) return;
    const N = scenarios[0];
    setRunning(true); setOutcomes([]); setProgress({ current: 0, total: N });
    const periodFrom = format(range.from, "yyyy-MM-dd");
    const periodTo = format(range.to, "yyyy-MM-dd");
    const collected: ScenarioRunOutcome[] = [];
    for (let i = 1; i <= N; i++) {
      setProgress({ current: i, total: N });
      const o = await runOneSimulation(householdId, periodFrom, periodTo, mode, N, i);
      collected.push(o);
      setOutcomes([...collected]);
    }
    setRunning(false); setProgress(null);
    const ok = collected.filter(o => o.result);
    if (ok.length === 0) toast.error("Alla scenarier misslyckades");
    else toast.success(`${ok.length} scenarion klara`);
  };

  const canRun = householdId && range?.from && range?.to;
  const successful = outcomes.filter(o => o.result) as Array<ScenarioRunOutcome & { result: RunResult }>;
  const stats = successful.length > 0 ? {
    best: Math.max(...successful.map(o => o.result.total_saved_sek)),
    worst: Math.min(...successful.map(o => o.result.total_saved_sek)),
    avg: successful.reduce((s, o) => s + o.result.total_saved_sek, 0) / successful.length,
  } : null;

  return (
    <Card className="max-w-[600px] mx-auto rounded-2xl border-border/60 shadow-card p-8 space-y-7">
      <Section title="Select household">
        <Select value={householdId} onValueChange={setHouseholdId} disabled={households.length === 0}>
          <SelectTrigger className="rounded-xl">
            <SelectValue placeholder={households.length === 0 ? "No households yet" : "Choose a household"} />
          </SelectTrigger>
          <SelectContent>
            {households.map(h => <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </Section>

      <DateRangeField range={range} setRange={setRange} bounds={bounds} />

      <Section title="Optimization mode">
        <RadioGroup value={mode} onValueChange={setMode} className="space-y-2">
          {modes.map(m => (
            <label key={m.id} htmlFor={m.id}
              className={cn(
                "flex items-start gap-3 rounded-xl border p-4 cursor-pointer transition-colors",
                mode === m.id ? "border-primary bg-primary-muted/40" : "border-border hover:bg-muted/40"
              )}>
              <RadioGroupItem id={m.id} value={m.id} className="mt-0.5" />
              <div>
                <div className="text-sm font-medium">{m.label}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{m.desc}</div>
              </div>
            </label>
          ))}
        </RadioGroup>
      </Section>

      <Section title={`Number of scenarios — ${scenarios[0]}`}>
        <Slider value={scenarios} onValueChange={setScenarios} min={1} max={100} step={1} />
        <div className="flex justify-between text-xs text-muted-foreground mt-2"><span>1</span><span>100</span></div>
      </Section>

      <div className="space-y-2 pt-2">
        <Button onClick={handleRun} disabled={!canRun || running}
          className="w-full rounded-full bg-primary hover:bg-primary/90 text-primary-foreground h-12 text-base gap-2">
          {running ? (
            <><Loader2 className="h-4 w-4 animate-spin" />
              {progress ? `Kör scenario ${progress.current} av ${progress.total}...` : "ZenOS optimerar..."}
            </>
          ) : "Run simulation"}
        </Button>
        {progress && <Progress value={(progress.current / progress.total) * 100} className="h-2" />}
      </div>

      {!running && successful.length > 0 && stats && (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5 space-y-3">
          <div className="flex items-center gap-2 text-emerald-600">
            <CheckCircle2 className="h-5 w-5" />
            <span className="font-semibold text-sm">{successful.length} scenarion klara</span>
          </div>
          <div className="grid grid-cols-3 gap-3 text-xs">
            <Stat label="Bäst" value={`${stats.best.toFixed(2)} SEK`} tone="emerald" />
            <Stat label="Sämst" value={`${stats.worst.toFixed(2)} SEK`} />
            <Stat label="Snitt" value={`${stats.avg.toFixed(2)} SEK`} />
          </div>
        </div>
      )}
    </Card>
  );
}

/* ============================ BULK MODE ============================ */
interface PerHouseholdConfig {
  range?: DateRange;
  mode: string;
  scenarios: number;
}
interface HouseholdProgress {
  total: number; done: number; failed: number; results: RunResult[];
}

function BulkMode({ households, evMap, bounds }: {
  households: Household[];
  evMap: Record<string, { v2x_capable: boolean; brand: string; model: string }>;
  bounds: { min: Date; max: Date } | null;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sameSettings, setSameSettings] = useState(true);
  const [sharedRange, setSharedRange] = useState<DateRange | undefined>(undefined);
  const [sharedMode, setSharedMode] = useState("price");
  const [sharedScenarios, setSharedScenarios] = useState([10]);
  const [perCfg, setPerCfg] = useState<Record<string, PerHouseholdConfig>>({});
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Record<string, HouseholdProgress>>({});
  const [done, setDone] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);

  useEffect(() => {
    if (!bounds || sharedRange) return;
    const from = subDays(bounds.max, 30);
    setSharedRange({ from: from < bounds.min ? bounds.min : from, to: bounds.max });
  }, [bounds, sharedRange]);

  // Sync per-household defaults when newly selected
  useEffect(() => {
    setPerCfg(prev => {
      const next = { ...prev };
      for (const id of selected) {
        if (!next[id]) next[id] = { range: sharedRange, mode: sharedMode, scenarios: sharedScenarios[0] };
      }
      return next;
    });
  }, [selected, sharedRange, sharedMode, sharedScenarios]);

  const allSelected = households.length > 0 && selected.size === households.length;
  const totalSimulations = useMemo(() => {
    if (selected.size === 0) return 0;
    if (sameSettings) return selected.size * sharedScenarios[0];
    return Array.from(selected).reduce((s, id) => s + (perCfg[id]?.scenarios ?? 0), 0);
  }, [selected, sameSettings, sharedScenarios, perCfg]);

  const canRun = !running && selected.size > 0 && totalSimulations > 0
    && (sameSettings ? !!sharedRange?.from && !!sharedRange?.to
       : Array.from(selected).every(id => perCfg[id]?.range?.from && perCfg[id]?.range?.to));

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleRun = async () => {
    setRunning(true); setDone(false); setStartedAt(Date.now());
    const initial: Record<string, HouseholdProgress> = {};
    for (const id of selected) {
      const N = sameSettings ? sharedScenarios[0] : (perCfg[id]?.scenarios ?? 0);
      initial[id] = { total: N, done: 0, failed: 0, results: [] };
    }
    setProgress(initial);

    for (const id of selected) {
      const cfg = sameSettings
        ? { range: sharedRange!, mode: sharedMode, scenarios: sharedScenarios[0] }
        : { range: perCfg[id].range!, mode: perCfg[id].mode, scenarios: perCfg[id].scenarios };
      const periodFrom = format(cfg.range.from!, "yyyy-MM-dd");
      const periodTo = format(cfg.range.to!, "yyyy-MM-dd");
      for (let i = 1; i <= cfg.scenarios; i++) {
        const o = await runOneSimulation(id, periodFrom, periodTo, cfg.mode, cfg.scenarios, i);
        setProgress(prev => {
          const cur = prev[id];
          return {
            ...prev,
            [id]: {
              ...cur,
              done: cur.done + 1,
              failed: cur.failed + (o.result ? 0 : 1),
              results: o.result ? [...cur.results, o.result] : cur.results,
            },
          };
        });
      }
    }
    setRunning(false); setDone(true);
    toast.success(`Bulk-körning klar — ${totalSimulations} simuleringar`);
  };

  const exportAll = () => {
    const payload = Array.from(selected).map(id => {
      const h = households.find(x => x.id === id);
      const p = progress[id];
      return {
        household: h?.name, household_id: id,
        scenarios: p?.total ?? 0, completed: p?.done ?? 0, failed: p?.failed ?? 0,
        results: p?.results ?? [],
      };
    });
    const blob = new Blob([JSON.stringify({ exported_at: new Date().toISOString(), runs: payload }, null, 2)],
      { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `zenios-bulk-${format(new Date(), "yyyy-MM-dd-HHmm")}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast.success("Bulk-resultat exporterade");
  };

  // ===== Progress view (running) =====
  if (running) {
    const totalDone = Object.values(progress).reduce((s, p) => s + p.done, 0);
    const elapsed = startedAt ? (Date.now() - startedAt) / 1000 : 0;
    const remaining = totalDone > 0
      ? Math.max(0, Math.round((elapsed / totalDone) * (totalSimulations - totalDone)))
      : Math.round(totalSimulations * SECONDS_PER_SCENARIO);
    return (
      <Card className="max-w-[760px] mx-auto rounded-2xl border-border/60 shadow-card p-8 space-y-5">
        <div className="flex items-center gap-2">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <h2 className="text-lg font-semibold">Bulk-körning pågår</h2>
        </div>
        <div className="space-y-3">
          {Array.from(selected).map(id => {
            const h = households.find(x => x.id === id);
            const p = progress[id];
            const pct = p && p.total > 0 ? (p.done / p.total) * 100 : 0;
            return (
              <div key={id} className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="font-medium">{h?.name}</span>
                  <span className="text-muted-foreground">{p?.done ?? 0}/{p?.total ?? 0} · {pct.toFixed(0)}%</span>
                </div>
                <Progress value={pct} className="h-2" />
              </div>
            );
          })}
        </div>
        <div className="rounded-xl bg-muted/40 p-4 text-sm flex flex-wrap items-center justify-between gap-3">
          <span><span className="font-semibold">Totalt:</span> {totalDone} av {totalSimulations} klara</span>
          <span className="text-muted-foreground">Beräknad tid kvar: ~{remaining} sekunder</span>
        </div>
      </Card>
    );
  }

  // ===== Completion summary =====
  if (done) {
    const rows = Array.from(selected).map(id => {
      const h = households.find(x => x.id === id);
      const p = progress[id];
      const vals = p?.results.map(r => r.total_saved_sek) ?? [];
      const v2hSum = (p?.results ?? []).reduce((s, r) => s + (r.total_v2h_saving_sek ?? 0), 0);
      return {
        id, name: h?.name ?? "—", scenarios: p?.total ?? 0,
        best: vals.length ? Math.max(...vals) : 0,
        worst: vals.length ? Math.min(...vals) : 0,
        avg: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0,
        v2h: v2hSum,
      };
    });
    const sorted = [...rows].sort((a, b) => b.avg - a.avg);
    const bestId = sorted[0]?.id;
    const worstId = sorted[sorted.length - 1]?.id;

    return (
      <Card className="max-w-[900px] mx-auto rounded-2xl border-border/60 shadow-card p-8 space-y-6">
        <div className="flex items-center gap-2 text-emerald-600">
          <CheckCircle2 className="h-5 w-5" />
          <h2 className="text-lg font-semibold">Bulk-körning klar — {totalSimulations} simuleringar</h2>
        </div>
        <div className="rounded-xl border border-border/60 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                {["Hushåll","Scenarion","Bäst","Sämst","Snitt","V2H"].map(h =>
                  <TableHead key={h} className="text-xs uppercase tracking-wider font-medium">{h}</TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(r => (
                <TableRow key={r.id} className={cn(
                  r.id === bestId && "bg-emerald-500/10",
                  r.id === worstId && r.id !== bestId && "bg-muted/40",
                )}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell>{r.scenarios}</TableCell>
                  <TableCell className="text-emerald-600 font-semibold">{r.best.toFixed(2)}</TableCell>
                  <TableCell>{r.worst.toFixed(2)}</TableCell>
                  <TableCell className="font-semibold">{r.avg.toFixed(2)}</TableCell>
                  <TableCell className="text-sky-600">{r.v2h.toFixed(2)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button
            onClick={() => window.dispatchEvent(new CustomEvent("zen:navigate", { detail: { view: "results" } }))}
            className="rounded-full bg-primary hover:bg-primary/90 text-primary-foreground gap-2"
          >Se detaljerade resultat</Button>
          <Button variant="outline" onClick={exportAll} className="rounded-full gap-2">
            <Download className="h-4 w-4" /> Exportera alla (JSON)
          </Button>
          <Button variant="ghost" onClick={() => { setDone(false); setProgress({}); }} className="rounded-full ml-auto">
            Ny körning
          </Button>
        </div>
      </Card>
    );
  }

  // ===== Configuration view =====
  const estSeconds = totalSimulations * SECONDS_PER_SCENARIO;

  return (
    <Card className="max-w-[900px] mx-auto rounded-2xl border-border/60 shadow-card p-8 space-y-7">
      <Section title="Steg 1 — Välj hushåll">
        <div className="flex gap-2 mb-3">
          <Button variant="outline" size="sm" className="rounded-full"
            onClick={() => setSelected(new Set(households.map(h => h.id)))}>Välj alla</Button>
          <Button variant="outline" size="sm" className="rounded-full"
            onClick={() => setSelected(new Set())}>Avmarkera alla</Button>
          <span className="text-xs text-muted-foreground self-center ml-auto">
            {selected.size} / {households.length} valda {allSelected && "(alla)"}
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {households.map(h => {
            const checked = selected.has(h.id);
            const ev = h.ev_model_id ? evMap[h.ev_model_id] : undefined;
            return (
              <label key={h.id} htmlFor={`hh-${h.id}`}
                className={cn(
                  "flex items-start gap-3 rounded-xl border p-4 cursor-pointer transition-colors",
                  checked ? "border-primary bg-primary-muted/40" : "border-border hover:bg-muted/40"
                )}>
                <Checkbox id={`hh-${h.id}`} checked={checked} onCheckedChange={() => toggle(h.id)} className="mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{h.name}</div>
                  <div className="flex flex-wrap gap-1.5 mt-1.5 text-[10px]">
                    {(ev || h.car_model) && <span className="rounded-full bg-muted px-2 py-0.5">{ev ? `${ev.brand} ${ev.model}` : h.car_model}</span>}
                    {ev?.v2x_capable && <span className="rounded-full bg-sky-500/15 text-sky-700 px-2 py-0.5 font-semibold">V2X</span>}
                    {h.price_area && <span className="rounded-full bg-muted px-2 py-0.5">{h.price_area}</span>}
                  </div>
                </div>
              </label>
            );
          })}
        </div>
      </Section>

      <Section title="Steg 2 — Konfigurera">
        <div className="flex items-center justify-between rounded-xl border border-border bg-muted/30 px-4 py-3">
          <div>
            <div className="text-sm font-medium">Samma inställningar för alla</div>
            <div className="text-xs text-muted-foreground">Stäng av för att ange period/läge/scenarion per hushåll</div>
          </div>
          <Switch checked={sameSettings} onCheckedChange={setSameSettings} />
        </div>

        {sameSettings ? (
          <div className="space-y-5 mt-5">
            <DateRangeField range={sharedRange} setRange={setSharedRange} bounds={bounds} />
            <div>
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Optimization mode</Label>
              <RadioGroup value={sharedMode} onValueChange={setSharedMode} className="space-y-2 mt-2.5">
                {modes.map(m => (
                  <label key={m.id} htmlFor={`s-${m.id}`}
                    className={cn(
                      "flex items-start gap-3 rounded-xl border p-3 cursor-pointer transition-colors",
                      sharedMode === m.id ? "border-primary bg-primary-muted/40" : "border-border hover:bg-muted/40"
                    )}>
                    <RadioGroupItem id={`s-${m.id}`} value={m.id} className="mt-0.5" />
                    <div>
                      <div className="text-sm font-medium">{m.label}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{m.desc}</div>
                    </div>
                  </label>
                ))}
              </RadioGroup>
            </div>
            <div>
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Scenarion per hushåll — {sharedScenarios[0]}
              </Label>
              <Slider value={sharedScenarios} onValueChange={setSharedScenarios} min={1} max={100} step={1} className="mt-3" />
              <div className="flex justify-between text-xs text-muted-foreground mt-2"><span>1</span><span>100</span></div>
            </div>
          </div>
        ) : (
          <div className="space-y-3 mt-5">
            {selected.size === 0 && (
              <p className="text-xs text-muted-foreground">Välj minst ett hushåll i Steg 1</p>
            )}
            {Array.from(selected).map(id => {
              const h = households.find(x => x.id === id);
              const cfg = perCfg[id] ?? { range: sharedRange, mode: sharedMode, scenarios: sharedScenarios[0] };
              const updateCfg = (patch: Partial<PerHouseholdConfig>) =>
                setPerCfg(prev => ({ ...prev, [id]: { ...cfg, ...patch } }));
              return (
                <div key={id} className="rounded-xl border border-border p-4 space-y-3">
                  <div className="text-sm font-medium">{h?.name}</div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <DateRangeField range={cfg.range} setRange={(r) => updateCfg({ range: r })} bounds={bounds} compact />
                    <Select value={cfg.mode} onValueChange={(v) => updateCfg({ mode: v })}>
                      <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {modes.map(m => <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <div>
                      <div className="text-[11px] text-muted-foreground mb-1.5">Scenarion: {cfg.scenarios}</div>
                      <Slider value={[cfg.scenarios]} onValueChange={(v) => updateCfg({ scenarios: v[0] })} min={1} max={100} step={1} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      <div className="space-y-2 pt-2">
        <Button onClick={handleRun} disabled={!canRun}
          className="w-full rounded-full bg-emerald-600 hover:bg-emerald-600/90 text-white h-12 text-base">
          Kör {totalSimulations} simuleringar
        </Button>
        <p className="text-xs text-muted-foreground text-center">
          {totalSimulations > 0
            ? `${selected.size} hushåll · Beräknad tid: ~${estSeconds} sekunder`
            : "Välj hushåll och konfigurera för att aktivera"}
        </p>
      </div>
    </Card>
  );
}

/* ============================ Shared bits ============================ */
function DateRangeField({
  range, setRange, bounds, compact,
}: {
  range: DateRange | undefined;
  setRange: (r: DateRange | undefined) => void;
  bounds: { min: Date; max: Date } | null;
  compact?: boolean;
}) {
  return (
    <div className={compact ? "" : "space-y-2.5"}>
      {!compact && <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Time period</Label>}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" className={cn("w-full rounded-xl justify-start font-normal", !range && "text-muted-foreground")}>
            <CalendarIcon className="mr-2 h-4 w-4" />
            {range?.from && range?.to
              ? `${format(range.from, compact ? "MMM d" : "LLL d, y")} – ${format(range.to, compact ? "MMM d, y" : "LLL d, y")}`
              : "Pick date range"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="range"
            selected={range}
            onSelect={setRange}
            numberOfMonths={2}
            defaultMonth={range?.from ?? bounds?.max ?? undefined}
            fromMonth={bounds?.min}
            toMonth={bounds?.max}
            disabled={bounds ? { before: bounds.min, after: bounds.max } : undefined}
            className="p-3 pointer-events-auto"
          />
        </PopoverContent>
      </Popover>
      {!compact && (
        <p className="text-xs text-muted-foreground">
          {bounds
            ? `Prisdata tillgänglig: ${format(bounds.min, "yyyy-MM-dd")} – ${format(bounds.max, "yyyy-MM-dd")}`
            : "Laddar tillgängligt datumintervall…"}
        </p>
      )}
    </div>
  );
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2.5">
      <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{title}</Label>
      {children}
    </div>
  );
}
function Stat({ label, value, tone }: { label: string; value: string; tone?: "emerald" }) {
  return (
    <div className="rounded-lg bg-background/60 border border-border/40 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn("font-semibold text-sm mt-0.5", tone === "emerald" && "text-emerald-600")}>{value}</div>
    </div>
  );
}
