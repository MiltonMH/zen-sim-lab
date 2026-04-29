import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Download, CheckCircle2, AlertCircle, FlaskConical } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface ElspotRecord {
  HourDK: string;
  HourUTC?: string;
  PriceArea: string;
  SpotPriceDKK: number | null;
  SpotPriceEUR: number | null;
}

const EUR_TO_SEK = 11.20;
const PRICE_AREA = "SE3";
const FETCH_URL =
  'https://dataportal.api.energidataservice.dk/v1/dataset/Elspotprices?limit=8784&filter=%7B%22PriceArea%22:%22DK2%22%7D&start=2024-01-01&end=2024-12-31&sort=HourDK%20asc';

type Phase = "loading" | "ready" | "importing" | "done" | "error";

export default function ImportData() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [records, setRecords] = useState<ElspotRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [importedCount, setImportedCount] = useState(0);

  // Test API state
  const [testLoading, setTestLoading] = useState(false);
  const [testRecords, setTestRecords] = useState<ElspotRecord[] | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  const fetchAll = async () => {
    setPhase("loading");
    setError(null);
    try {
      console.log("[ImportData] Fetching", FETCH_URL);
      const res = await fetch(FETCH_URL);
      if (!res.ok) throw new Error(`API returned ${res.status}`);
      const json = await res.json();
      const recs: ElspotRecord[] = json.records ?? [];
      console.log("[ImportData] Got", recs.length, "records");
      setRecords(recs);
      setPhase("ready");
    } catch (e: any) {
      console.error("[ImportData] Fetch failed", e);
      setError(e.message ?? "Fetch failed");
      setPhase("error");
    }
  };

  useEffect(() => {
    fetchAll();
  }, []);

  const runTest = async () => {
    setTestLoading(true);
    setTestError(null);
    setTestRecords(null);
    try {
      const url =
        'https://dataportal.api.energidataservice.dk/v1/dataset/Elspotprices?limit=5&filter=%7B%22PriceArea%22:%22DK2%22%7D&sort=HourDK%20desc';
      const res = await fetch(url);
      if (!res.ok) throw new Error(`API returned ${res.status}`);
      const json = await res.json();
      setTestRecords(json.records ?? []);
    } catch (e: any) {
      setTestError(e.message ?? "Test failed");
    } finally {
      setTestLoading(false);
    }
  };

  const confirmImport = async () => {
    const rows = records
      .filter((r) => r.SpotPriceDKK != null)
      .map((r) => ({
        hour: new Date(r.HourDK + "Z").toISOString(),
        price_sek_kwh: Number((((r.SpotPriceDKK as number) / 1000) * EUR_TO_SEK).toFixed(5)),
        price_area: PRICE_AREA,
        source: "nordpool",
      }));

    setPhase("importing");
    setProgress({ done: 0, total: rows.length });

    try {
      const chunkSize = 500;
      let done = 0;
      for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        const { error: insErr } = await supabase.from("spot_prices").insert(chunk);
        if (insErr) throw insErr;
        done += chunk.length;
        setProgress({ done, total: rows.length });
      }
      setImportedCount(done);
      setPhase("done");
      toast.success(`Successfully imported ${done.toLocaleString()} rows`);
    } catch (e: any) {
      console.error("[ImportData] Insert failed", e);
      setError(e.message ?? "Import failed");
      setPhase("error");
      toast.error(e.message ?? "Import failed");
    }
  };

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Import Data</h1>
        <p className="text-muted-foreground mt-1.5 text-sm">Pull market data into the lab.</p>
      </header>

      <Card className="max-w-[640px] mx-auto rounded-2xl border-border/60 shadow-card p-8 space-y-10">
        {/* Section 1: Spot prices */}
        <section className="space-y-5">
          <div>
            <h2 className="text-lg font-semibold">Import spot prices</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Fetch 2024 hourly spot prices from Energidata (DK2 → SE3, EUR rate {EUR_TO_SEK}).
            </p>
          </div>

          {/* Test API */}
          <div className="rounded-xl border border-border/60 p-4 space-y-3 bg-muted/30">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">Test API connection</p>
                <p className="text-xs text-muted-foreground">Fetches 5 latest records</p>
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

          {/* Main flow */}
          <div className="rounded-xl border border-border/60 p-5 space-y-4">
            {phase === "loading" && (
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Fetching spot prices...
              </div>
            )}

            {phase === "error" && (
              <div className="space-y-3">
                <div className="flex items-start gap-2 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
                <Button onClick={fetchAll} variant="outline" size="sm" className="rounded-full">
                  Retry
                </Button>
              </div>
            )}

            {phase === "ready" && (
              <div className="space-y-4">
                <p className="text-sm">
                  <span className="font-semibold">{records.length.toLocaleString()}</span> records ready to import
                </p>
                <Button
                  onClick={confirmImport}
                  className="w-full rounded-full bg-primary hover:bg-primary/90 text-primary-foreground h-11 gap-2"
                >
                  <Download className="h-4 w-4" />
                  Confirm and import
                </Button>
              </div>
            )}

            {phase === "importing" && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Importing... {progress.done.toLocaleString()} of {progress.total.toLocaleString()}
                </div>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
                  />
                </div>
              </div>
            )}

            {phase === "done" && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm text-primary">
                  <CheckCircle2 className="h-4 w-4" />
                  Successfully imported {importedCount.toLocaleString()} rows
                </div>
                <Button onClick={fetchAll} variant="outline" size="sm" className="rounded-full">
                  Run again
                </Button>
              </div>
            )}
          </div>
        </section>

        <div className="h-px bg-border" />

        {/* Section 2 */}
        <section className="space-y-5">
          <div>
            <h2 className="text-lg font-semibold">Grid tariffs</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Grid tariff data will be added manually in a future update.
            </p>
          </div>
          <Button disabled className="w-full rounded-full h-11">Coming soon</Button>
        </section>
      </Card>
    </div>
  );
}
