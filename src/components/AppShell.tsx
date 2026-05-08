import { useEffect, useState } from "react";
import { Home, Database, Play, BarChart3, LogOut, Users, Brain, Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import Login from "@/pages/Login";
import Overview from "@/pages/Overview";
import Data from "@/pages/Data";

import Simulering from "@/pages/Simulering";
import ResultatLoggar from "@/pages/ResultatLoggar";
import Hushall from "@/pages/Hushall";
import MLAnalys from "@/pages/MLAnalys";

type View = "overview" | "data" | "hushall" | "simulering" | "ml" | "resultat";

type NavParams = Record<string, string | undefined>;

interface NavItem {
  id: View;
  label: string;
  icon: typeof Home;
}

const navItems: NavItem[] = [
  { id: "overview", label: "Översikt", icon: Home },
  { id: "data", label: "Data", icon: Database },
  { id: "hushall", label: "Hushåll", icon: Users },
  { id: "simulering", label: "Simulering", icon: Play },
  { id: "ml", label: "ML Analys", icon: Brain },
  { id: "resultat", label: "Resultat & Loggar", icon: BarChart3 },
];

export default function AppShell() {
  const [view, setView] = useState<View>("overview");
  const [params, setParams] = useState<NavParams>({});
  const [mobileOpen, setMobileOpen] = useState(false);
  const { session, loading, signOut, user } = useAuth();

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ view: View; params?: NavParams }>).detail;
      if (detail?.view) {
        const legacyMap: Record<string, View> = {
          import: "data",
          "data-spot": "data",
          "data-tariffs": "data",
          households: "hushall",
          runner: "simulering",
          "runner-bulk": "simulering",
          "results-overview": "resultat",
          "results-households": "resultat",
          "results-logs": "resultat",
        };
        const next = (legacyMap[detail.view as string] ?? detail.view) as View;
        setView(next);
        setParams(detail.params ?? {});
        setMobileOpen(false);
      }
    };
    window.addEventListener("zen:navigate", handler as EventListener);
    return () => window.removeEventListener("zen:navigate", handler as EventListener);
  }, []);

  const navigate = (id: View) => {
    setView(id);
    setParams({});
    setMobileOpen(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="h-2.5 w-2.5 rounded-full bg-primary animate-pulse-dot" />
      </div>
    );
  }

  if (!session) return <Login />;

  const renderPage = () => {
    switch (view) {
      case "overview": return <Overview />;
      case "data": return <Data initialTab={(params.tab as "spot" | "tariffs" | "import" | undefined) ?? "spot"} />;
      case "hushall": return <Hushall />;
      case "ml": return <MLAnalys />;
      case "simulering":
        return <Simulering initialMode={(params.mode as "single" | "bulk" | undefined) ?? "single"} preselectedHouseholdId={params.household} />;
      case "resultat":
        return <ResultatLoggar initialView={(params.view as "all" | "overview" | "households" | "logs" | undefined) ?? "all"} initialSimulationId={params.simulation} initialHouseholdId={params.household} />;
      default: return <Overview />;
    }
  };

  const currentLabel = navItems.find((n) => n.id === view)?.label ?? "ZenOS Lab";

  const SidebarBody = (
    <>
      <div className="px-6 pt-7 pb-8 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-primary animate-pulse-dot" />
          <span className="font-semibold text-[17px] tracking-tight text-sidebar-foreground">ZenOS Lab</span>
        </div>
        <button
          onClick={() => setMobileOpen(false)}
          className="md:hidden p-1.5 rounded-md hover:bg-sidebar-accent text-sidebar-foreground"
          aria-label="Stäng meny"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <nav className="flex-1 min-h-0 overflow-y-auto px-3 pb-4 space-y-1">
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

      <div className="px-3 py-4 border-t border-sidebar-border space-y-2 shrink-0">
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
    </>
  );

  return (
    <div className="h-screen w-full flex bg-background overflow-hidden">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-64 shrink-0 bg-sidebar border-r border-sidebar-border flex-col h-full">
        {SidebarBody}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div
            className="absolute inset-0 bg-foreground/40 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="relative w-72 max-w-[85%] bg-sidebar border-r border-sidebar-border flex flex-col h-full animate-in slide-in-from-left duration-200">
            {SidebarBody}
          </aside>
        </div>
      )}

      <main className="flex-1 h-full overflow-y-auto overflow-x-hidden">
        {/* Mobile top bar */}
        <div className="md:hidden sticky top-0 z-30 flex items-center gap-3 px-4 h-14 bg-background/90 backdrop-blur border-b border-border">
          <button
            onClick={() => setMobileOpen(true)}
            className="p-2 -ml-2 rounded-md hover:bg-muted text-foreground"
            aria-label="Öppna meny"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-primary animate-pulse-dot" />
            <span className="font-semibold text-sm tracking-tight">{currentLabel}</span>
          </div>
        </div>

        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 md:px-10 py-6 sm:py-8 md:py-10">
          {renderPage()}
        </div>
      </main>
    </div>
  );
}
