import { useEffect, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";

function StateRow({ count, message }: { count: number; message: string }) {
  return (
    <TableRow>
      <TableCell colSpan={count} className="h-32 text-center text-sm text-muted-foreground">{message}</TableCell>
    </TableRow>
  );
}

function DataTable({ headers, rows, loading, error, empty }: {
  headers: string[]; rows: React.ReactNode[][]; loading: boolean; error: string | null; empty: string;
}) {
  return (
    <Card className="rounded-2xl border-border/60 shadow-card overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40">
            {headers.map(h => <TableHead key={h} className="text-xs uppercase tracking-wider font-medium">{h}</TableHead>)}
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? <StateRow count={headers.length} message="Loading..." />
            : error ? <StateRow count={headers.length} message={`Error: ${error}`} />
            : rows.length === 0 ? <StateRow count={headers.length} message={empty} />
            : rows.map((cells, i) => (
              <TableRow key={i}>
                {cells.map((c, j) => <TableCell key={j} className="text-sm">{c}</TableCell>)}
              </TableRow>
            ))}
        </TableBody>
      </Table>
    </Card>
  );
}

export default function Results() {
  const [runs, setRuns] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [householdMap, setHouseholdMap] = useState<Record<string, string>>({});
  const [loadingR, setLoadingR] = useState(true);
  const [loadingL, setLoadingL] = useState(true);
  const [errR, setErrR] = useState<string | null>(null);
  const [errL, setErrL] = useState<string | null>(null);

  useEffect(() => {
    supabase.from("household_profiles").select("id, name").then(({ data }) => {
      const map: Record<string, string> = {};
      (data ?? []).forEach((h: any) => { map[h.id] = h.name; });
      setHouseholdMap(map);
    });
    supabase.from("simulation_runs").select("*").order("started_at", { ascending: false }).limit(100)
      .then(({ data, error }) => {
        if (error) setErrR(error.message); else setRuns(data ?? []);
        setLoadingR(false);
      });
    supabase.from("optimization_logs").select("*").order("logged_at", { ascending: false }).limit(100)
      .then(({ data, error }) => {
        if (error) setErrL(error.message); else setLogs(data ?? []);
        setLoadingL(false);
      });
  }, []);

  const runRows = runs.map(r => [
    <span className="font-mono text-xs">{r.id.slice(0, 8)}</span>,
    householdMap[r.household_id] ?? "—",
    `${r.period_from} → ${r.period_to}`,
    <span className="capitalize">{r.optimization_mode}</span>,
    r.total_saved_sek != null ? Number(r.total_saved_sek).toFixed(2) : "—",
    r.avg_price_paid != null ? Number(r.avg_price_paid).toFixed(4) : "—",
    r.scenarios ?? "—",
  ]);

  const logRows = logs.map(l => [
    format(new Date(l.logged_at), "yyyy-MM-dd HH:mm"),
    householdMap[l.household_id] ?? "—",
    <span className="capitalize">{l.decision}</span>,
    l.spot_price_sek != null ? Number(l.spot_price_sek).toFixed(4) : "—",
    l.soc_pct != null ? `${Number(l.soc_pct).toFixed(0)}%` : "—",
    l.reason ?? "—",
  ]);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Results & Logs</h1>
        <p className="text-muted-foreground mt-1.5 text-sm">Review simulation outputs and per-decision logs.</p>
      </header>

      <Tabs defaultValue="results">
        <TabsList className="rounded-full bg-muted p-1">
          <TabsTrigger value="results" className="rounded-full px-6">Simulation results</TabsTrigger>
          <TabsTrigger value="logs" className="rounded-full px-6">Optimization logs</TabsTrigger>
        </TabsList>

        <TabsContent value="results" className="mt-6">
          <DataTable
            headers={["Simulation ID", "Household", "Period", "Mode", "Total saved (SEK)", "Avg price paid", "Events"]}
            rows={runRows} loading={loadingR} error={errR}
            empty="No results yet — run a simulation to see data here"
          />
        </TabsContent>

        <TabsContent value="logs" className="mt-6">
          <DataTable
            headers={["Timestamp", "Household", "Decision", "Spot price", "SoC %", "Reason"]}
            rows={logRows} loading={loadingL} error={errL}
            empty="No optimization logs yet"
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
