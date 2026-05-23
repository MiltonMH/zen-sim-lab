import { useState } from "react";
import JSZip from "jszip";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Download, Database } from "lucide-react";

const TABLES = [
  "charging_events",
  "consumption_profiles",
  "ev_models",
  "grid_company_settings",
  "grid_tariff_sources",
  "grid_tariffs",
  "household_profiles",
  "optimization_logs",
  "simulation_events",
  "simulation_runs",
  "spot_prices",
  "virtual_chargers",
] as const;

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/export-table-csv`;
const ANON = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

type Status = "idle" | "running" | "done" | "error";

export default function ExportData() {
  const [status, setStatus] = useState<Record<string, Status>>({});
  const [progress, setProgress] = useState<Record<string, { done: number; total: number }>>({});
  const [busy, setBusy] = useState(false);

  async function authHeaders() {
    const { data: { session } } = await supabase.auth.getSession();
    return {
      apikey: ANON,
      Authorization: `Bearer ${session?.access_token ?? ANON}`,
    };
  }

  async function downloadTable(table: string, asZip = true) {
    setStatus((s) => ({ ...s, [table]: "running" }));
    try {
      const headers = await authHeaders();

      // 1) meta
      const metaRes = await fetch(`${FN_URL}?table=${table}&meta=1`, { headers });
      if (!metaRes.ok) throw new Error(await metaRes.text());
      const meta = await metaRes.json() as { total_rows: number; total_chunks: number; chunk_size: number };

      if (meta.total_rows === 0) {
        toast.info(`${table}: 0 rader`);
        setStatus((s) => ({ ...s, [table]: "done" }));
        return;
      }

      setProgress((p) => ({ ...p, [table]: { done: 0, total: meta.total_chunks } }));

      const zip = new JSZip();
      const folder = zip.folder(table)!;

      // 2) loop chunks
      for (let i = 0; i < meta.total_chunks; i++) {
        const res = await fetch(`${FN_URL}?table=${table}&chunk=${i}`, { headers });
        if (!res.ok) throw new Error(`chunk ${i}: ${await res.text()}`);
        const csv = await res.text();
        folder.file(`${table}__chunk-${String(i).padStart(4, "0")}.csv`, csv);
        setProgress((p) => ({ ...p, [table]: { done: i + 1, total: meta.total_chunks } }));
      }

      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${table}__${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);

      setStatus((s) => ({ ...s, [table]: "done" }));
      toast.success(`${table}: ${meta.total_rows} rader nedladdade (${meta.total_chunks} filer)`);
    } catch (e: any) {
      console.error(e);
      setStatus((s) => ({ ...s, [table]: "error" }));
      toast.error(`${table}: ${e.message ?? e}`);
    }
  }

  async function downloadAll() {
    setBusy(true);
    for (const t of TABLES) {
      await downloadTable(t);
    }
    setBusy(false);
    toast.success("Alla tabeller nedladdade ✅");
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Database className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold">Exportera databas</h1>
          <p className="text-sm text-muted-foreground">CSV i chunks om 10 000 rader, paketerade som ZIP.</p>
        </div>
      </div>

      <Card className="p-5 flex items-center justify-between rounded-2xl">
        <div>
          <div className="font-medium">Ladda ner alla tabeller</div>
          <div className="text-xs text-muted-foreground">{TABLES.length} tabeller, en ZIP per tabell</div>
        </div>
        <Button onClick={downloadAll} disabled={busy} className="rounded-full gap-2">
          <Download className="h-4 w-4" /> {busy ? "Laddar ner…" : "Hämta allt"}
        </Button>
      </Card>

      <div className="grid gap-3">
        {TABLES.map((t) => {
          const p = progress[t];
          const st = status[t] ?? "idle";
          return (
            <Card key={t} className="p-4 rounded-xl flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="font-mono text-sm">{t}</div>
                {p && (
                  <div className="mt-2 flex items-center gap-3">
                    <Progress value={(p.done / Math.max(1, p.total)) * 100} className="h-1.5 flex-1" />
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {p.done}/{p.total}
                    </span>
                  </div>
                )}
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full ${
                st === "done" ? "bg-emerald-500/15 text-emerald-700" :
                st === "error" ? "bg-destructive/15 text-destructive" :
                st === "running" ? "bg-amber-500/15 text-amber-700" :
                "bg-muted text-muted-foreground"
              }`}>{st}</span>
              <Button size="sm" variant="outline" className="rounded-full" disabled={st === "running"}
                onClick={() => downloadTable(t)}>
                <Download className="h-3.5 w-3.5 mr-1.5" /> ZIP
              </Button>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
