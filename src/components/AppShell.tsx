import { useEffect, useState } from "react";
import {
  Home, Database, Building2, Play, FileText, LogOut, Download,
  TrendingUp, Zap, Layers, BarChart3, Boxes,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import Login from "@/pages/Login";
import Overview from "@/pages/Overview";
import DataExplorer from "@/pages/DataExplorer";
import ImportData from "@/pages/ImportData";
import Households from "@/pages/Households";
import SimulationRunner from "@/pages/SimulationRunner";
import Results from "@/pages/Results";

type View =
  | "overview"
  | "import"
  | "data-spot"
  | "data-tariffs"
  | "households"
  | "runner"
  | "runner-bulk"
  | "results-overview"
  | "results-households"
  | "results-logs";

type NavParams = Record<string, string | undefined>;

interface NavItem {
  id: View;
  label: string;
  icon: typeof Home;
}

interface NavSection {
  label: string;
  items: NavItem[];
}

const sections: NavSection[] = [
  {
    label: "Data",
    items: [
      { id: "import", label: "Import Data", icon: Download },
      { id: "data-spot", label: "Spot Prices", icon: TrendingUp },
      { id: "data-tariffs", label: "Grid Tariffs", icon: Zap },
    ],
  },
  {
    label: "Simulering",
    items: [
      { id: "households", label: "Hushåll", icon: Building2 },
      { id: "runner", label: "Kör simulering", icon: Play },
      { id: "runner-bulk", label: "Bulk-körning", icon: Boxes },
    ],
  },
  {
    label: "Resultat",
    items: [
      { id: "results-overview", label: "Översikt", icon: BarChart3 },
      { id: "results-households", label: "Per hushåll", icon: Layers },
      { id: "results-logs", label: "Loggar", icon: FileText },
    ],
  },
  {
    label: "System",
    items: [
      { id: "overview", label: "Overview", icon: Home },
    ],
  },
];

export default function AppShell() {
  const [view, setView] = useState<View>("overview");
  const [params, setParams] = useState<NavParams>({});
  const { session, loading, signOut, user } = useAuth();

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ view: View; params?: NavParams }>).detail;
      if (detail?.view) {
        setView(detail.view);
        setParams(detail.params ?? {});
      }
    };
    window.addEventListener("zen:navigate", handler as EventListener);
    return () => window.removeEventListener("zen:navigate", handler as EventListener);
  }, []);

  const navigate = (id: View, p: NavParams = {}) => {
    setView(id);
    setParams(p);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="h-2.5 w-2.5 rounded-full bg-primary animate-pulse-dot" />
      </div>
    );
  }

  if (!session) return <Login />;

  // Map sidebar items to underlying page + tab/view params
  const renderPage = () => {
    switch (view) {
      case "overview":
        return <Overview />;
      case "import":
        return <ImportData initialTab={params.tab as "spot" | "tariffs" | undefined} />;
      case "data-spot":
        return <DataExplorer initialTab="spot" />;
      case "data-tariffs":
        return <DataExplorer initialTab="tariffs" />;
      case "households":
        return <Households />;
      case "runner":
        return <SimulationRunner initialMode="single" preselectedHouseholdId={params.household} />;
      case "runner-bulk":
        return <SimulationRunner initialMode="bulk" />;
      case "results-overview":
        return <Results initialView="overview" />;
      case "results-households":
        return <Results initialView="households" />;
      case "results-logs":
        return <Results initialView="logs" />;
      default:
        return <Overview />;
    }
  };

  return (
    <div className="min-h-screen w-full flex bg-background">
      <aside className="w-64 shrink-0 bg-sidebar border-r border-sidebar-border flex flex-col">
        <div className="px-6 pt-7 pb-6 flex items-center gap-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-primary animate-pulse-dot" />
          <span className="font-semibold text-[17px] tracking-tight text-sidebar-foreground">ZenOS Lab</span>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 pb-4 space-y-5">
          {sections.map((section) => (
            <div key={section.label} className="space-y-1">
              <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                {section.label}
              </div>
              {section.items.map((item) => {
                const Icon = item.icon;
                const active = view === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => navigate(item.id)}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2 rounded-full text-sm font-medium transition-colors",
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
            </div>
          ))}
        </nav>

        <div className="px-3 py-4 border-t border-sidebar-border space-y-2">
          {user?.email && (
            <div className="px-3 text-xs text-muted-foreground truncate">{user.email}</div>
          )}
          <button
            onClick={signOut}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-full text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-x-hidden">
        <div className="max-w-[1400px] mx-auto px-10 py-10">
          {renderPage()}
        </div>
      </main>
    </div>
  );
}
