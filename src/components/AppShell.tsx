import { useState } from "react";
import { Home, Database, Building2, Play, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import Overview from "@/pages/Overview";
import DataExplorer from "@/pages/DataExplorer";
import Households from "@/pages/Households";
import SimulationRunner from "@/pages/SimulationRunner";
import Results from "@/pages/Results";

type View = "overview" | "data" | "households" | "runner" | "results";

const nav: { id: View; label: string; icon: typeof Home }[] = [
  { id: "overview", label: "Overview", icon: Home },
  { id: "data", label: "Data Explorer", icon: Database },
  { id: "households", label: "Households", icon: Building2 },
  { id: "runner", label: "Simulation Runner", icon: Play },
  { id: "results", label: "Results & Logs", icon: FileText },
];

export default function AppShell() {
  const [view, setView] = useState<View>("overview");

  return (
    <div className="min-h-screen w-full flex bg-background">
      <aside className="w-64 shrink-0 bg-sidebar border-r border-sidebar-border flex flex-col">
        <div className="px-6 pt-7 pb-8 flex items-center gap-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-primary animate-pulse-dot" />
          <span className="font-semibold text-[17px] tracking-tight text-sidebar-foreground">ZenOS Lab</span>
        </div>

        <nav className="flex-1 px-3 space-y-1">
          {nav.map((item) => {
            const Icon = item.icon;
            const active = view === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setView(item.id)}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 rounded-full text-sm font-medium transition-colors",
                  active
                    ? "bg-primary text-primary-foreground shadow-soft"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="px-6 py-5 border-t border-sidebar-border">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse-dot" />
            Supabase: connecting...
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-x-hidden">
        <div className="max-w-[1400px] mx-auto px-10 py-10">
          {view === "overview" && <Overview />}
          {view === "data" && <DataExplorer />}
          {view === "households" && <Households />}
          {view === "runner" && <SimulationRunner />}
          {view === "results" && <Results />}
        </div>
      </main>
    </div>
  );
}
