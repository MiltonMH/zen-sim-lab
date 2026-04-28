import { Card } from "@/components/ui/card";
import { LineChart as LineIcon, Check } from "lucide-react";

const stats = [
  { label: "Spot prices loaded", value: 0 },
  { label: "Grid tariffs", value: 0 },
  { label: "Households", value: 0 },
  { label: "Simulation runs", value: 0 },
  { label: "Charging events", value: 0 },
];

const steps = [
  { n: 1, label: "Load price data" },
  { n: 2, label: "Create a household" },
  { n: 3, label: "Run simulation" },
];

export default function Overview() {
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
            <div className="mt-3 text-3xl font-semibold tabular-nums">{s.value}</div>
          </div>
        ))}
      </div>

      <Card className="rounded-2xl border-border/60 shadow-card p-10">
        <div className="h-72 flex flex-col items-center justify-center text-center">
          <div className="h-12 w-12 rounded-full bg-primary-muted flex items-center justify-center mb-4">
            <LineIcon className="h-5 w-5 text-primary" />
          </div>
          <p className="text-sm text-muted-foreground max-w-md">
            No simulation data yet — run your first simulation to see results here
          </p>
        </div>
      </Card>

      <section>
        <h2 className="text-lg font-semibold mb-5">Getting started</h2>
        <div className="flex items-center gap-4">
          {steps.map((s, i) => (
            <div key={s.n} className="flex items-center gap-4 flex-1">
              <div className="flex items-center gap-3 bg-card rounded-2xl px-5 py-4 border border-border/60 shadow-card flex-1">
                <div className="h-8 w-8 rounded-full bg-primary-muted text-primary flex items-center justify-center text-sm font-semibold">
                  {s.n}
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
