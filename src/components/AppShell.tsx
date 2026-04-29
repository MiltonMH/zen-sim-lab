import { useEffect, useState } from "react";
import { Home, Database, Play, BarChart3, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import Login from "@/pages/Login";
import Overview from "@/pages/Overview";
import Data from "@/pages/Data";
import ImportData from "@/pages/ImportData";
import Simulering from "@/pages/Simulering";
import Results from "@/pages/Results";

type View = "overview" | "data" | "simulering" | "resultat";

type NavParams = Record<string, string | undefined>;

interface NavItem {
  id: View;
  label: string;
  icon: typeof Home;
}

const navItems: NavItem[] = [
  { id: "overview", label: "Översikt", icon: Home },
  { id: "data", label: "Data", icon: Database },
  { id: "simulering", label: "Simulering", icon: Play },
  { id: "resultat", label: "Resultat & Loggar", icon: BarChart3 },
];

export default function AppShell() {
  const [view, setView] = useState<View>("overview");
  const [params, setParams] = useState<NavParams>({});
  const { session, loading, signOut, user } = useAuth();

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ view: View; params?: NavParams }>).detail;
      if (detail?.view) {
        // Map any legacy view names from old code paths to the new 4-item structure
        const legacyMap: Record<string, View> = {
          import: "data",
          "data-spot": "data",
          "data-tariffs": "data",
          households: "simulering",
          runner: "simulering",
          "runner-bulk": "simulering",
          "results-overview": "resultat",
          "results-households": "resultat",
          "results-logs": "resultat",
        };
        const next = (legacyMap[detail.view as string] ?? detail.view) as View;
        setView(next);
        setParams(detail.params ?? {});
      }
    };
    window.addEventListener("zen:navigate", handler as EventListener);
    return () => window.removeEventListener("zen:navigate", handler as EventListener);
  }, []);

  const navigate = (id: View) => {
    setView(id);
    setParams({});
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="h-2.5 w-2.5 rounded-full bg-primary animate-pulse-dot" />
      </div>
    );
  }

  if (!session) return <Login />;

  // Page content unchanged in this step — only the sidebar is being restructured.
  // Data tab defaults to spot-prices view inside the existing DataExplorer.
  // Simulering defaults to the single-run mode inside the existing runner.
  // Resultat defaults to the overview view inside the existing Results page.
  const renderPage = () => {
    switch (view) {
      case "overview":
        return <Overview />;
      case "data":
        return <Data initialTab={(params.tab as "spot" | "tariffs" | "import" | undefined) ?? "spot"} />;
      case "simulering":
        return (
          <Simulering
            initialMode={(params.mode as "single" | "bulk" | undefined) ?? "single"}
            preselectedHouseholdId={params.household}
          />
        );
      case "resultat":
        return <Results initialView={(params.view as "overview" | "households" | "logs" | undefined) ?? "overview"} />;
      default:
        return <Overview />;
    }
  };

  return (
    <div className="min-h-screen w-full flex bg-background">
      <aside className="w-64 shrink-0 bg-sidebar border-r border-sidebar-border flex flex-col">
        <div className="px-6 pt-7 pb-8 flex items-center gap-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-primary animate-pulse-dot" />
          <span className="font-semibold text-[17px] tracking-tight text-sidebar-foreground">ZenOS Lab</span>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 pb-4 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = view === item.id;
            return (
              <button
                key={item.id}
                onClick={() => navigate(item.id)}
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
