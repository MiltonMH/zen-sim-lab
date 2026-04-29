import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon, Loader2, CheckCircle2 } from "lucide-react";
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
interface ScenarioRunOutcome {
  scenario_number: number;
  params: ScenarioParams;
  result: RunResult | null;
  error?: string;
}

function generateScenarioParams(n: number): ScenarioParams {
  return {
    starting_soc: Math.round(20 + Math.random() * 70),         // 20-90%
    daily_km_multiplier: Number((0.7 + Math.random() * 0.6).toFixed(2)), // ±30%
    departure_offset_hours: Math.round((Math.random() * 2 - 1) * 10) / 10, // ±1h
    price_threshold: PRICE_THRESHOLDS[(n - 1) % PRICE_THRESHOLDS.length],
    min_soc: Math.round(15 + Math.random() * 20),              // 15-35%
  };
}

export default function SimulationRunner() {
  const [mode, setMode] = useState("price");
  const [scenarios, setScenarios] = useState([10]);
  const [range, setRange] = useState<DateRange | undefined>(undefined);
  const [households, setHouseholds] = useState<{ id: string; name: string }[]>([]);
  const [householdId, setHouseholdId] = useState<string>("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [outcomes, setOutcomes] = useState<ScenarioRunOutcome[]>([]);
  const [bounds, setBounds] = useState<{ min: Date; max: Date } | null>(null);

  useEffect(() => {
    supabase.from("household_profiles").select("id, name").order("created_at", { ascending: false })
      .then(({ data }) => setHouseholds(data ?? []));

    (async () => {
      const [{ data: minRow }, { data: maxRow }] = await Promise.all([
        supabase.from("spot_prices").select("hour").order("hour", { ascending: true }).limit(1).maybeSingle(),
        supabase.from("spot_prices").select("hour").order("hour", { ascending: false }).limit(1).maybeSingle(),
      ]);
      if (!minRow?.hour || !maxRow?.hour) return;
      const min = new Date(minRow.hour);
      const max = new Date(maxRow.hour);
      setBounds({ min, max });
      const from = subDays(max, 30);
      setRange({ from: from < min ? min : from, to: max });
    })();
  }, []);

  const handleRun = async () => {
    if (!householdId || !range?.from || !range?.to) return;
    const N = scenarios[0];
    setRunning(true);
    setOutcomes([]);
    setProgress({ current: 0, total: N });

    const periodFrom = format(range.from, "yyyy-MM-dd");
    const periodTo = format(range.to, "yyyy-MM-dd");
    const collected: ScenarioRunOutcome[] = [];

    for (let i = 1; i <= N; i++) {
      setProgress({ current: i, total: N });
      const params = generateScenarioParams(i);

      const { data: ins, error } = await supabase.from("simulation_runs").insert({
        household_id: householdId,
        period_from: periodFrom,
        period_to: periodTo,
        optimization_mode: mode,
        scenarios: N,
        scenario_number: i,
        scenario_params: params as unknown as Record<string, unknown>,
        status: "pending",
      }).select("id").single();

      if (error || !ins) {
        collected.push({ scenario_number: i, params, result: null, error: error?.message ?? "insert failed" });
        continue;
      }

      const { data: fnData, error: fnErr } = await supabase.functions.invoke("run-simulation", {
        body: { simulation_id: ins.id },
      });

      if (fnErr) {
        collected.push({ scenario_number: i, params, result: null, error: fnErr.message });
      } else {
        collected.push({ scenario_number: i, params, result: fnData as RunResult });
      }
      setOutcomes([...collected]);
    }

    setRunning(false);
    setProgress(null);
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
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Run Simulation</h1>
        <p className="text-muted-foreground mt-1.5 text-sm">Configure and execute a scenario batch.</p>
      </header>

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

        <Section title="Time period">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className={cn("w-full rounded-xl justify-start font-normal", !range && "text-muted-foreground")}>
                <CalendarIcon className="mr-2 h-4 w-4" />
                {range?.from && range?.to ? `${format(range.from, "LLL d, y")} – ${format(range.to, "LLL d, y")}` : "Pick date range"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="range"
                selected={range}
                onSelect={setRange}
                numberOfMonths={2}
                defaultMonth={bounds?.max ?? undefined}
                disabled={bounds ? { before: bounds.min, after: bounds.max } : undefined}
                className="p-3 pointer-events-auto"
              />
            </PopoverContent>
          </Popover>
          <p className="text-xs text-muted-foreground mt-2">
            {bounds
              ? `Prisdata tillgänglig: ${format(bounds.min, "yyyy-MM-dd")} – ${format(bounds.max, "yyyy-MM-dd")}`
              : "Laddar tillgängligt datumintervall…"}
          </p>
        </Section>

        <Section title="Optimization mode">
          <RadioGroup value={mode} onValueChange={setMode} className="space-y-2">
            {modes.map((m) => (
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
          <div className="flex justify-between text-xs text-muted-foreground mt-2">
            <span>1</span><span>100</span>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Varje scenario varierar SoC, körsträcka, avgångstid, priströskel & min-SoC.
          </p>
        </Section>

        <div className="space-y-2 pt-2">
          <Button
            onClick={handleRun}
            disabled={!canRun || running}
            className="w-full rounded-full bg-primary hover:bg-primary/90 text-primary-foreground h-12 text-base gap-2"
          >
            {running ? (
              <><Loader2 className="h-4 w-4 animate-spin" />
                {progress ? `Kör scenario ${progress.current} av ${progress.total}...` : "ZenOS optimerar..."}
              </>
            ) : "Run simulation"}
          </Button>
          {progress && (
            <Progress value={(progress.current / progress.total) * 100} className="h-2" />
          )}
          <p className="text-xs text-muted-foreground text-center">
            {!householdId ? "Select a household to enable" : "ZenOS analyserar timpriser och hittar billigaste timmarna"}
          </p>
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
            {outcomes.some(o => o.error) && (
              <p className="text-xs text-destructive">{outcomes.filter(o => o.error).length} scenarion misslyckades</p>
            )}
          </div>
        )}
      </Card>
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
