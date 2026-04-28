import { useEffect, useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";

function StateRow({ headers, message }: { headers: string[]; message: string }) {
  return (
    <TableRow>
      <TableCell colSpan={headers.length} className="h-32 text-center text-sm text-muted-foreground">{message}</TableCell>
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
          {loading ? <StateRow headers={headers} message="Loading..." />
            : error ? <StateRow headers={headers} message={`Error: ${error}`} />
            : rows.length === 0 ? <StateRow headers={headers} message={empty} />
            : rows.map((cells, i) => (
              <TableRow key={i}>
                {cells.map((c, j) => <TableCell key={j} className="text-sm tabular-nums">{c}</TableCell>)}
              </TableRow>
            ))}
        </TableBody>
      </Table>
    </Card>
  );
}

export default function DataExplorer() {
  const [spot, setSpot] = useState<any[]>([]);
  const [tariffs, setTariffs] = useState<any[]>([]);
  const [loadingS, setLoadingS] = useState(true);
  const [loadingT, setLoadingT] = useState(true);
  const [errS, setErrS] = useState<string | null>(null);
  const [errT, setErrT] = useState<string | null>(null);

  useEffect(() => {
    supabase.from("spot_prices").select("*").order("hour", { ascending: false }).limit(100)
      .then(({ data, error }) => {
        if (error) setErrS(error.message); else setSpot(data ?? []);
        setLoadingS(false);
      });
    supabase.from("grid_tariffs").select("*").order("valid_from", { ascending: false }).limit(100)
      .then(({ data, error }) => {
        if (error) setErrT(error.message); else setTariffs(data ?? []);
        setLoadingT(false);
      });
  }, []);

  const spotHeaders = ["Hour", "Price area", "Price (SEK/kWh)", "Source"];
  const spotRows = spot.map(r => [
    format(new Date(r.hour), "yyyy-MM-dd HH:mm"),
    r.price_area,
    Number(r.price_sek_kwh).toFixed(4),
    r.source ?? "—",
  ]);

  const tariffHeaders = ["Company", "Hour", "Weekend", "Tariff (SEK/kWh)", "Valid from"];
  const tariffRows = tariffs.map(r => [
    r.grid_company,
    `${String(r.hour_of_day).padStart(2, "0")}:00`,
    r.is_weekend ? "Yes" : "No",
    Number(r.tariff_sek_kwh).toFixed(4),
    r.valid_from,
  ]);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Data Explorer</h1>
        <p className="text-muted-foreground mt-1.5 text-sm">Inspect spot prices and grid tariffs.</p>
      </header>

      <Tabs defaultValue="spot">
        <TabsList className="rounded-full bg-muted p-1">
          <TabsTrigger value="spot" className="rounded-full px-6">Spot prices</TabsTrigger>
          <TabsTrigger value="tariffs" className="rounded-full px-6">Grid tariffs</TabsTrigger>
        </TabsList>

        <TabsContent value="spot" className="space-y-6 mt-6">
          <DataTable headers={spotHeaders} rows={spotRows} loading={loadingS} error={errS} empty="No spot prices loaded yet" />
        </TabsContent>

        <TabsContent value="tariffs" className="space-y-6 mt-6">
          <DataTable headers={tariffHeaders} rows={tariffRows} loading={loadingT} error={errT} empty="No tariff data yet" />
        </TabsContent>
      </Tabs>
    </div>
  );
}
