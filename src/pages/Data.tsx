import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Download, RefreshCw, TrendingUp, Zap } from "lucide-react";
import { SpotPricesExplorer, TariffsTab } from "@/pages/DataExplorer";
import ImportData from "@/pages/ImportData";
import { supabase } from "@/integrations/supabase/client";

type DataTab = "spot" | "tariffs" | "import";

interface TariffSourceRow {
  id: string;
  company_name: string;
  price_area: string | null;
  last_fetched: string | null;
  active: boolean;
  hours: number;
}

function TariffSourcesPanel() {
  const [rows, setRows] = useState<TariffSourceRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: sources } = await supabase
        .from("grid_tariff_sources")
        .select("id, company_name, price_area, last_fetched, active")
        .order("company_name");
      const { data: tariffs } = await supabase.from("grid_tariffs").select("grid_company");
      const counts = new Map<string, number>();
      (tariffs ?? []).forEach((t: any) => counts.set(t.grid_company, (counts.get(t.grid_company) ?? 0) + 1));
      setRows((sources ?? []).map((s: any) => ({ ...s, hours: counts.get(s.company_name) ?? 0 })));
      setLoading(false);
    })();
  }, []);

  return (
    <Card className="rounded-2xl border-border/60 shadow-card overflow-hidden">
      <div className="px-5 py-4 border-b border-border/60 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-sky-500" />
          <h3 className="text-base font-semibold">Elnätsbolag</h3>
        </div>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Button disabled variant="outline" size="sm" className="rounded-full gap-2">
                  <RefreshCw className="h-3.5 w-3.5" /> Uppdatera från RISE API
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>RISE API integration coming soon</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      {loading ? (
        <div className="p-6 text-sm text-muted-foreground">Laddar…</div>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="text-left px-5 py-2.5 font-medium">Bolag</th>
              <th className="text-left px-5 py-2.5 font-medium">Prisområde</th>
              <th className="text-right px-5 py-2.5 font-medium">Timmar data</th>
              <th className="text-left px-5 py-2.5 font-medium">Senast uppdaterad</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-border/60">
                <td className="px-5 py-2.5">{r.company_name}</td>
                <td className="px-5 py-2.5">
                  {r.price_area ? <Badge variant="secondary" className="rounded-full">{r.price_area}</Badge> : "—"}
                </td>
                <td className="px-5 py-2.5 text-right tabular-nums">{r.hours.toLocaleString("sv-SE")}</td>
                <td className="px-5 py-2.5 text-muted-foreground">
                  {r.last_fetched ? new Date(r.last_fetched).toLocaleString("sv-SE") : "Aldrig"}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-5 py-6 text-center text-muted-foreground">
                  Inga elnätsbolag registrerade.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </Card>
  );
}

export default function Data({ initialTab = "spot" }: { initialTab?: DataTab } = {}) {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Data</h1>
        <p className="text-muted-foreground mt-1.5 text-sm">
          Spotpriser, elnätstariffer och import — allt på ett ställe.
        </p>
      </header>

      <Tabs defaultValue={initialTab}>
        <TabsList className="rounded-full bg-muted p-1">
          <TabsTrigger value="spot" className="rounded-full px-5 gap-2">
            <TrendingUp className="h-3.5 w-3.5" /> Spotpriser
          </TabsTrigger>
          <TabsTrigger value="tariffs" className="rounded-full px-5 gap-2">
            <Zap className="h-3.5 w-3.5" /> Elnätstariffer
          </TabsTrigger>
          <TabsTrigger value="import" className="rounded-full px-5 gap-2">
            <Download className="h-3.5 w-3.5" /> Importera
          </TabsTrigger>
        </TabsList>

        <TabsContent value="spot" className="mt-6">
          <SpotPricesExplorer />
        </TabsContent>

        <TabsContent value="tariffs" className="mt-6 space-y-6">
          <TariffSourcesPanel />
          <TariffsTab />
        </TabsContent>

        <TabsContent value="import" className="mt-6">
          {/* Reuse the existing import page — it already has year selector, test-fetch, and import flow. */}
          <ImportData initialTab="spot" />
        </TabsContent>
      </Tabs>
    </div>
  );
}
