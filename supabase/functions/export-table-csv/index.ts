// Export any public table as CSV in 10,000-row chunks via LIMIT/OFFSET.
// Usage: GET /export-table-csv?table=spot_prices&chunk=0  (chunk size fixed at 10_000)
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const CHUNK_SIZE = 10_000;

// Whitelist of exportable tables (security: never accept arbitrary table names)
const ALLOWED_TABLES = new Set([
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
]);

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = cols.join(",");
  const body = rows.map((r) => cols.map((c) => esc(r[c])).join(",")).join("\n");
  return `${header}\n${body}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const table = url.searchParams.get("table") ?? "";
    const chunk = Math.max(0, parseInt(url.searchParams.get("chunk") ?? "0", 10));
    const meta = url.searchParams.get("meta") === "1";

    if (!ALLOWED_TABLES.has(table)) {
      return new Response(
        JSON.stringify({ error: `Invalid table. Allowed: ${[...ALLOWED_TABLES].join(", ")}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // meta=1 → return row count + total chunks so the UI can loop
    if (meta) {
      const { count, error } = await supabase
        .from(table)
        .select("*", { count: "exact", head: true });
      if (error) throw error;
      return new Response(
        JSON.stringify({
          table,
          total_rows: count ?? 0,
          chunk_size: CHUNK_SIZE,
          total_chunks: Math.ceil((count ?? 0) / CHUNK_SIZE),
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const from = chunk * CHUNK_SIZE;
    const to = from + CHUNK_SIZE - 1;
    const { data, error } = await supabase.from(table).select("*").range(from, to);
    if (error) throw error;

    const csv = toCsv(data ?? []);
    const filename = `${table}__chunk-${String(chunk).padStart(4, "0")}.csv`;

    return new Response(csv, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Chunk": String(chunk),
        "X-Chunk-Rows": String(data?.length ?? 0),
      },
    });
  } catch (e) {
    console.error("export-table-csv error", e);
    return new Response(JSON.stringify({ error: String((e as Error).message ?? e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
