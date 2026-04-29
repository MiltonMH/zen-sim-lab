import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Slider } from "@/components/ui/slider";
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

interface RunResult {
  days_processed: number;
  total_kwh_charged: number;
  total_saved_sek: number;
  price_savings_sek: number;
  total_v2h_kwh: number;
  total_v2h_saving_sek: number;
  peak_hours_avoided: number;
  avg_price_paid: number;
  v2x_capable: boolean;
  decisions_logged: number;
}

export default function SimulationRunner() {
  const [mode, setMode] = useState("price");
  const [scenarios, setScenarios] = useState([10]);
  const [range, setRange] = useState<DateRange | undefined>({ from: subDays(new Date(), 30), to: new Date() });
  const [households, setHouseholds] = useState<{ id: string; name: string }[]>([]);
  const [householdId, setHouseholdId] = useState<string>("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ res: RunResult; householdName: string } | null>(null);

  useEffect(() => {
    supabase.from("household_profiles").select("id, name").order("created_at", { ascending: false })
      .then(({ data }) => setHouseholds(data ?? []));
  }, []);

  const handleRun = async () => {
    if (!householdId || !range?.from || !range?.to) return;
    setRunning(true);
    setResult(null);

    const { data: ins, error } = await supabase.from("simulation_runs").insert({
      household_id: householdId,
      period_from: format(range.from, "yyyy-MM-dd"),
      period_to: format(range.to, "yyyy-MM-dd"),
      optimization_mode: mode,
      scenarios: scenarios[0],
      status: "pending",
    }).select("id").single();

    if (error || !ins) {
      setRunning(false);
      toast.error(error?.message || "Failed to queue");
      return;
    }

    const { data: fnData, error: fnErr } = await supabase.functions.invoke("run-simulation", {
      body: { simulation_id: ins.id },
    });

    setRunning(false);
    if (fnErr) {
      toast.error(`Simulering misslyckades: ${fnErr.message}`);
      return;
    }

    const householdName = households.find(h => h.id === householdId)?.name ?? "hushållet";
    toast.success(`Simulering klar! Sparade ${Number(fnData.total_saved_sek).toFixed(2)} SEK`);
    setResult({ res: fnData as RunResult, householdName });
  };

  const canRun = householdId && range?.from && range?.to;

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
              <Calendar mode="range" selected={range} onSelect={setRange} numberOfMonths={2} className="p-3 pointer-events-auto" />
            </PopoverContent>
          </Popover>
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
        </Section>

        <div className="space-y-2 pt-2">
          <Button
            onClick={handleRun}
            disabled={!canRun || running}
            className="w-full rounded-full bg-primary hover:bg-primary/90 text-primary-foreground h-12 text-base gap-2"
          >
            {running ? (<><Loader2 className="h-4 w-4 animate-spin" /> ZenOS optimerar...</>) : "Run simulation"}
          </Button>
          <p className="text-xs text-muted-foreground text-center">
            {!householdId ? "Select a household to enable" : "ZenOS analyserar timpriser och hittar billigaste timmarna"}
          </p>
        </div>

        {result && (
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5 space-y-3">
            <div className="flex items-center gap-2 text-emerald-600">
              <CheckCircle2 className="h-5 w-5" />
              <span className="font-semibold text-sm">Simulering klar!</span>
            </div>
            <p className="text-sm">
              ZenOS sparade <strong className="text-emerald-600">{result.res.total_saved_sek.toFixed(2)} SEK</strong> över <strong>{result.res.days_processed} dagar</strong>.
            </p>
            <div className="rounded-xl bg-background/60 border border-border/40 p-3 text-xs space-y-1.5">
              <div className="flex justify-between"><span className="text-muted-foreground">Prisoptimering</span><span className="font-semibold">{result.res.price_savings_sek.toFixed(2)} SEK</span></div>
              {result.res.v2x_capable && (
                <div className="flex justify-between"><span className="text-muted-foreground">V2H</span><span className="font-semibold text-sky-600">{result.res.total_v2h_saving_sek.toFixed(2)} SEK</span></div>
              )}
              <div className="flex justify-between"><span className="text-muted-foreground">Topptimmar undvikta</span><span className="font-semibold">{result.res.peak_hours_avoided} st</span></div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <Stat label="kWh laddat" value={`${result.res.total_kwh_charged.toFixed(1)}`} />
              <Stat label="Snittpris" value={`${result.res.avg_price_paid.toFixed(3)} SEK/kWh`} />
              {result.res.v2x_capable && <Stat label="V2H kWh" value={result.res.total_v2h_kwh.toFixed(1)} />}
              <Stat label="Beslut loggade" value={result.res.decisions_logged.toString()} />
            </div>
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-background/60 border border-border/40 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-semibold text-sm mt-0.5">{value}</div>
    </div>
  );
}
