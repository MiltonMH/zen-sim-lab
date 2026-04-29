import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { Loader2, Download, CheckCircle2, AlertCircle, FlaskConical, RefreshCw, Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface ElpriceRecord {
  SEK_per_kWh: number;
  EUR_per_kWh?: number;
  EXR?: number;
  time_start: string;
  time_end: string;
}

const PRICE_AREA = "SE3";
const YEAR_OPTIONS = [2024, 2025] as const;

type Phase = "idle" | "importing" | "done" | "error";

function pad(n: number) {
  return n.toString().padStart(2, "0");
}

function urlForDate(year: number, month: number, day: number) {
  return `https://www.elprisetjustnu.se/api/v1/prices/${year}/${pad(month)}-${pad(day)}_${PRICE_AREA}.json`;
}

function daysInYear(year: number): Array<{ month: number; day: number }> {
  const out: Array<{ month: number; day: number }> = [];
  const start = new Date(Date.UTC(year, 0, 1));
  const end = new Date(Date.UTC(year + 1, 0, 1));
  for (let d = new Date(start); d < end; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push({ month: d.getUTCMonth() + 1, day: d.getUTCDate() });
  }
  return out;
}

interface TariffSourceRow {
  id: string;
  company_name: string;
  price_area: string | null;
  last_fetched: string | null;
  active: boolean;
  hours: number;
}

function GridTariffsTab() {
  const [rows, setRows] = useState<TariffSourceRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: sources } = await supabase
        .from("grid_tariff_sources")
        .select("id, company_name, price_area, last_fetched, active")
        .order("company_name");
      const { data: tariffs } = await supabase
        .from("grid_tariffs")
        .select("grid_company");
      const counts = new Map<string, number>();
      (tariffs ?? []).forEach((t: any) => counts.set(t.grid_company, (counts.get(t.grid_company) ?? 0) + 1));
      setRows((sources ?? []).map((s: any) => ({ ...s, hours: counts.get(s.company_name) ?? 0 })));
      setLoading(false);
    })();
  }, []);

  return (
    <Card className="rounded-2xl border-border/60 shadow-card p-6 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Zap className="h-4 w-4" /> Grid tariffs
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Swedish grid companies published via the RISE Eltariff API. Manual 2025 rates loaded for simulation.
          </p>
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
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Laddar…
        </div>
      ) : (
        <div className="rounded-xl border border-border/60 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium">Company</th>
                <th className="text-left px-4 py-2.5 font-medium">Price area</th>
                <th className="text-right px-4 py-2.5 font-medium">Hours of data</th>
                <th className="text-left px-4 py-2.5 font-medium">Last updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border/60">
                  <td className="px-4 py-2.5">{r.company_name}</td>
                  <td className="px-4 py-2.5">
                    {r.price_area ? <Badge variant="secondary" className="rounded-full">{r.price_area}</Badge> : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{r.hours.toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {r.last_fetched ? new Date(r.last_fetched).toLocaleString("sv-SE") : "Aldrig"}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">Inga grid companies registrerade.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export default function ImportData({ initialTab = "spot" }: { initialTab?: "spot" | "tariffs" } = {}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0, rows: 0 });
  const [importedCount, setImportedCount] = useState(0);
  const [selectedYear, setSelectedYear] = useState<number>(2025);

  const [testLoading, setTestLoading] = useState(false);
  const [testRecords, setTestRecords] = useState<ElpriceRecord[] | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  const runTest = async () => {
    setTestLoading(true);
    setTestError(null);
    setTestRecords(null);
    try {
      const res = await fetch(urlForDate(selectedYear, 1, 1));
      if (!res.ok) throw new Error(`API returned ${res.status}`);
      const json: ElpriceRecord[] = await res.json();
      setTestRecords(json.slice(0, 5));
    } catch (e: any) {
      setTestError(e.message ?? "Test failed");
    } finally {
      setTestLoading(false);
    }
  };

  const runImport = async () => {
    const days = daysInYear(selectedYear);
    setPhase("importing");
    setError(null);
    setProgress({ done: 0, total: days.length, rows: 0 });

    const buffer: Array<{
      hour: string;
      price_sek_kwh: number;
      price_area: string;
      source: string;
    }> = [];
    let totalRows = 0;

    const flush = async () => {
      if (buffer.length === 0) return;
      const chunk = buffer.splice(0, buffer.length);
      const { error: insErr } = await supabase.from("spot_prices").insert(chunk);
      if (insErr) throw insErr;
    };

    try {
      for (let i = 0; i < days.length; i++) {
        const { month, day } = days[i];
        const res = await fetch(urlForDate(selectedYear, month, day));
        if (!res.ok) {
          console.warn(`[ImportData] ${selectedYear}-${pad(month)}-${pad(day)} returned ${res.status}`);
        } else {
          const json: ElpriceRecord[] = await res.json();
          for (const r of json) {
            buffer.push({
              hour: new Date(r.time_start).toISOString(),
              price_sek_kwh: Number(r.SEK_per_kWh.toFixed(5)),
              price_area: PRICE_AREA,
              source: "elprisetjustnu",
            });
            totalRows++;
          }
        }

        if (buffer.length >= 500) {
          await flush();
        }

        setProgress({ done: i + 1, total: days.length, rows: totalRows });
      }
      await flush();
      setImportedCount(totalRows);
      setPhase("done");
      toast.success(`Successfully imported ${totalRows.toLocaleString()} rows`);
    } catch (e: any) {
      console.error("[ImportData] Import failed", e);
      setError(e.message ?? "Import failed");
      setPhase("error");
      toast.error(e.message ?? "Import failed");
    }
  };

  const pct = progress.total ? (progress.done / progress.total) * 100 : 0;

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Import Data</h1>
        <p className="text-muted-foreground mt-1.5 text-sm">Pull market data into the lab.</p>
      </header>

      <Tabs defaultValue={initialTab} className="max-w-[860px] mx-auto">
        <TabsList className="rounded-full">
          <TabsTrigger value="spot" className="rounded-full">Spot prices</TabsTrigger>
          <TabsTrigger value="tariffs" className="rounded-full">Grid tariffs</TabsTrigger>
        </TabsList>

        <TabsContent value="spot" className="mt-6">
          <Card className="rounded-2xl border-border/60 shadow-card p-8 space-y-10">
            <section className="space-y-5">
              <div>
                <h2 className="text-lg font-semibold">Import spot prices</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Fetch {selectedYear} hourly SE3 spot prices from elprisetjustnu.se (day by day).
                </p>
              </div>

              <div className="flex items-center justify-between gap-3 rounded-xl border border-border/60 p-4">
                <div>
                  <p className="text-sm font-medium">Year</p>
                  <p className="text-xs text-muted-foreground">Choose which year to import</p>
                </div>
                <Select
                  value={String(selectedYear)}
                  onValueChange={(v) => setSelectedYear(Number(v))}
                  disabled={phase === "importing"}
                >
                  <SelectTrigger className="w-32 rounded-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {YEAR_OPTIONS.map((y) => (
                      <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="rounded-xl border border-border/60 p-4 space-y-3 bg-muted/30">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">Test API connection</p>
                    <p className="text-xs text-muted-foreground">Fetches Jan 1 (first 5 hours)</p>
                  </div>
                  <Button onClick={runTest} disabled={testLoading} variant="outline" size="sm" className="rounded-full gap-2">
                    {testLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />}
                    Test
                  </Button>
                </div>
                {testError && <p className="text-xs text-destructive">{testError}</p>}
                {testRecords && (
                  <pre className="text-[11px] bg-background rounded-lg p-3 overflow-x-auto max-h-48">
                    {JSON.stringify(testRecords, null, 2)}
                  </pre>
                )}
              </div>

              <div className="rounded-xl border border-border/60 p-5 space-y-4">
                {phase === "idle" && (
                  <Button
                    onClick={runImport}
                    className="w-full rounded-full bg-primary hover:bg-primary/90 text-primary-foreground h-11 gap-2"
                  >
                    <Download className="h-4 w-4" />
                    Import {selectedYear} ({daysInYear(selectedYear).length} days)
                  </Button>
                )}

                {phase === "importing" && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-sm">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Importing day {progress.done} of {progress.total} · {progress.rows.toLocaleString()} rows
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                )}

                {phase === "done" && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-sm text-primary">
                      <CheckCircle2 className="h-4 w-4" />
                      Successfully imported {importedCount.toLocaleString()} rows
                    </div>
                    <Button onClick={() => setPhase("idle")} variant="outline" size="sm" className="rounded-full">
                      Run again
                    </Button>
                  </div>
                )}

                {phase === "error" && (
                  <div className="space-y-3">
                    <div className="flex items-start gap-2 text-sm text-destructive">
                      <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                      <span>{error}</span>
                    </div>
                    <Button onClick={() => setPhase("idle")} variant="outline" size="sm" className="rounded-full">
                      Reset
                    </Button>
                  </div>
                )}
              </div>
            </section>
          </Card>
        </TabsContent>

        <TabsContent value="tariffs" className="mt-6">
          <GridTariffsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
