import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Slider } from "@/components/ui/slider";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon } from "lucide-react";
import { format, subDays } from "date-fns";
import type { DateRange } from "react-day-picker";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const modes = [
  { id: "none", label: "No optimization", desc: "Baseline — charge whenever connected" },
  { id: "price", label: "Price optimization", desc: "Charge when spot price is lowest" },
  { id: "full", label: "Full ZenOS", desc: "Price + grid tariff + battery health" },
];

export default function SimulationRunner() {
  const [mode, setMode] = useState("none");
  const [scenarios, setScenarios] = useState([10]);
  const [range, setRange] = useState<DateRange | undefined>({ from: subDays(new Date(), 30), to: new Date() });
  const [households, setHouseholds] = useState<{ id: string; name: string }[]>([]);
  const [householdId, setHouseholdId] = useState<string>("");
  const [running, setRunning] = useState(false);

  useEffect(() => {
    supabase.from("household_profiles").select("id, name").order("created_at", { ascending: false })
      .then(({ data }) => setHouseholds(data ?? []));
  }, []);

  const handleRun = async () => {
    if (!householdId || !range?.from || !range?.to) return;
    setRunning(true);
    const { error } = await supabase.from("simulation_runs").insert({
      household_id: householdId,
      period_from: format(range.from, "yyyy-MM-dd"),
      period_to: format(range.to, "yyyy-MM-dd"),
      optimization_mode: mode,
      scenarios: scenarios[0],
      status: "pending",
    });
    setRunning(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Simulation queued");
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
            className="w-full rounded-full bg-primary hover:bg-primary/90 text-primary-foreground h-12 text-base"
          >
            {running ? "Queuing..." : "Run simulation"}
          </Button>
          <p className="text-xs text-muted-foreground text-center">
            {!householdId ? "Select a household to enable" : "Estimated time: ~2 seconds per scenario"}
          </p>
        </div>
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
