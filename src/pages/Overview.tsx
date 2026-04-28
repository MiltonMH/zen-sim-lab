import { Card } from "@/components/ui/card";
import { LineChart as LineIcon, Check } from "lucide-react";
import { useCounts } from "@/hooks/useCounts";
import { cn } from "@/lib/utils";

export default function Overview() {
  const { counts, loading } = useCounts();

  const stats = [
    { label: "Spot prices loaded", value: counts.spot_prices },
    { label: "Grid tariffs", value: counts.grid_tariffs },
    { label: "Households", value: counts.household_profiles },
    { label: "Simulation runs", value: counts.simulation_runs },
    { label: "Charging events", value: counts.charging_events },
  ];

  const steps = [
    { n: 1, label: "Load price data", done: counts.spot_prices > 0 },
    { n: 2, label: "Create a household", done: counts.household_profiles > 0 },
    { n: 3, label: "Run simulation", done: counts.simulation_runs > 0 },
  ];

  return (
    <div className="space-y-10">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Overview</h1>
        <p className="text-muted-foreground mt-1.5 text-sm">Monitor data sources, households, and simulation activity.</p>
      </header>

      <div className="grid grid-cols-5 gap-4">
        {stats.map((s) => (
          <div key={s.label} className="stat-card">
            <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium">{s.label}</div>
            <div className="mt-3 text-3xl font-semibold tabular-nums">
              {loading ? <span className="text-muted-foreground/40">—</span> : s.value}
            </div>
          </div>
        ))}
      </div>

      <Card className="rounded-2xl border-border/60 shadow-card p-10">
        <div className="h-72 flex flex-col items-center justify-center text-center">
          <div className="h-12 w-12 rounded-full bg-primary-muted flex items-center justify-center mb-4">
            <LineIcon className="h-5 w-5 text-primary" />
          </div>
          <p className="text-sm text-muted-foreground max-w-md">
            {counts.simulation_runs > 0
              ? `${counts.simulation_runs} simulation run(s) recorded — open Results & Logs for details`
              : "No simulation data yet — run your first simulation to see results here"}
          </p>
        </div>
      </Card>

      <section>
        <h2 className="text-lg font-semibold mb-5">Getting started</h2>
        <div className="flex items-center gap-4">
          {steps.map((s, i) => (
            <div key={s.n} className="flex items-center gap-4 flex-1">
              <div className={cn(
                "flex items-center gap-3 bg-card rounded-2xl px-5 py-4 border shadow-card flex-1 transition-colors",
                s.done ? "border-primary/40 bg-primary-muted/30" : "border-border/60"
              )}>
                <div className={cn(
                  "h-8 w-8 rounded-full flex items-center justify-center text-sm font-semibold",
                  s.done ? "bg-primary text-primary-foreground" : "bg-primary-muted text-primary"
                )}>
                  {s.done ? <Check className="h-4 w-4" /> : s.n}
                </div>
                <span className="text-sm font-medium">{s.label}</span>
              </div>
              {i < steps.length - 1 && <div className="h-px w-6 bg-border" />}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
