import { useEffect, useMemo, useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChevronRight, Loader2, Play } from "lucide-react";
import { format } from "date-fns";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const SEK = (n: number | null | undefined) =>
  n == null ? "—" : `${Number(n).toFixed(3)} SEK`;

// ─────────────────────────────────────────────────────────────
// Spot prices drill-down
// ─────────────────────────────────────────────────────────────

type Selection = {
  year: number | null;
  month: number | null;
  day: number | null;
};

function Breadcrumbs({
  selection,
  onNavigate,
}: {
  selection: Selection;
  onNavigate: (next: Selection) => void;
}) {
  const crumbs: Array<{ label: string; sel: Selection }> = [
    { label: "All years", sel: { year: null, month: null, day: null } },
  ];
  if (selection.year != null) {
    crumbs.push({ label: String(selection.year), sel: { year: selection.year, month: null, day: null } });
  }
  if (selection.year != null && selection.month != null) {
    crumbs.push({
      label: MONTH_NAMES[selection.month - 1],
      sel: { year: selection.year, month: selection.month, day: null },
    });
  }
  if (selection.year != null && selection.month != null && selection.day != null) {
    crumbs.push({
      label: `${String(selection.day).padStart(2, "0")} ${MONTH_NAMES[selection.month - 1].slice(0, 3)}`,
      sel: { ...selection },
    });
  }

  return (
    <nav className="flex items-center flex-wrap gap-1 text-sm">
      {crumbs.map((c, i) => {
        const isLast = i === crumbs.length - 1;
        return (
          <span key={i} className="flex items-center gap-1">
            <button
              onClick={() => !isLast && onNavigate(c.sel)}
              className={cn(
                "px-2 py-1 rounded-md transition-colors",
                isLast
                  ? "text-foreground font-medium cursor-default"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted",
              )}
              disabled={isLast}
            >
              {c.label}
            </button>
            {!isLast && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" />}
          </span>
        );
      })}
    </nav>
  );
}

function StatCard({
  title,
  subtitle,
  metrics,
  onClick,
}: {
  title: string;
  subtitle?: string;
  metrics: Array<{ label: string; value: string }>;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group text-left rounded-2xl border border-border/60 bg-card hover:border-primary/40 hover:shadow-card transition-all p-5 space-y-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xl font-semibold tracking-tight">{title}</div>
          {subtitle && <div className="text-xs text-muted-foreground mt-0.5">{subtitle}</div>}
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
      </div>
      <div className="grid grid-cols-2 gap-3 pt-1">
        {metrics.map((m) => (
          <div key={m.label}>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{m.label}</div>
            <div className="text-sm font-medium tabular-nums">{m.value}</div>
          </div>
        ))}
      </div>
    </button>
  );
}

function LoadingBlock() {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground py-12 justify-center">
      <Loader2 className="h-4 w-4 animate-spin" />
      Loading…
    </div>
  );
}

function EmptyBlock({ message }: { message: string }) {
  return (
    <Card className="rounded-2xl border-dashed border-border/60 p-10 text-center text-sm text-muted-foreground">
      {message}
    </Card>
  );
}

// Level 1 – Years
function YearsLevel({ onPick }: { onPick: (year: number) => void }) {
  const [rows, setRows] = useState<Array<{ year: number; rows: number; avg_price: number }> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.rpc("spot_prices_years").then(({ data, error }) => {
      if (error) setError(error.message);
      else setRows((data ?? []).map((r: any) => ({ ...r, rows: Number(r.rows), avg_price: Number(r.avg_price) })));
    });
  }, []);

  if (error) return <EmptyBlock message={`Error: ${error}`} />;
  if (!rows) return <LoadingBlock />;
  if (rows.length === 0) return <EmptyBlock message="No spot price data yet. Import data first." />;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {rows.map((r) => (
        <StatCard
          key={r.year}
          title={String(r.year)}
          subtitle="Year"
          metrics={[
            { label: "Rows", value: r.rows.toLocaleString() },
            { label: "Avg price", value: SEK(r.avg_price) },
          ]}
          onClick={() => onPick(r.year)}
        />
      ))}
    </div>
  );
}

// Level 2 – Months
function MonthsLevel({ year, onPick }: { year: number; onPick: (month: number) => void }) {
  const [rows, setRows] = useState<Array<{ month: number; rows: number; avg_price: number; max_price: number }> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRows(null);
    supabase.rpc("spot_prices_months", { _year: year }).then(({ data, error }) => {
      if (error) setError(error.message);
      else setRows((data ?? []).map((r: any) => ({
        month: r.month,
        rows: Number(r.rows),
        avg_price: Number(r.avg_price),
        max_price: Number(r.max_price),
      })));
    });
  }, [year]);

  if (error) return <EmptyBlock message={`Error: ${error}`} />;
  if (!rows) return <LoadingBlock />;

  // Always render 12 months; mark months without data as disabled
  const byMonth = new Map(rows.map((r) => [r.month, r]));

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
        const data = byMonth.get(m);
        if (!data) {
          return (
            <div
              key={m}
              className="rounded-2xl border border-dashed border-border/60 p-5 opacity-50 cursor-not-allowed"
            >
              <div className="text-xl font-semibold tracking-tight">{MONTH_NAMES[m - 1]}</div>
              <div className="text-xs text-muted-foreground mt-2">No data</div>
            </div>
          );
        }
        return (
          <StatCard
            key={m}
            title={MONTH_NAMES[m - 1]}
            subtitle={`${data.rows} hours`}
            metrics={[
              { label: "Avg price", value: SEK(data.avg_price) },
              { label: "Max price", value: SEK(data.max_price) },
            ]}
            onClick={() => onPick(m)}
          />
        );
      })}
    </div>
  );
}

// Level 3 – Days
function DaysLevel({
  year,
  month,
  onPick,
}: {
  year: number;
  month: number;
  onPick: (day: number) => void;
}) {
  const [rows, setRows] = useState<Array<{ day: number; rows: number; avg_price: number; min_price: number; max_price: number }> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRows(null);
    supabase.rpc("spot_prices_days", { _year: year, _month: month }).then(({ data, error }) => {
      if (error) setError(error.message);
      else setRows((data ?? []).map((r: any) => ({
        day: r.day,
        rows: Number(r.rows),
        avg_price: Number(r.avg_price),
        min_price: Number(r.min_price),
        max_price: Number(r.max_price),
      })));
    });
  }, [year, month]);

  if (error) return <EmptyBlock message={`Error: ${error}`} />;
  if (!rows) return <LoadingBlock />;
  if (rows.length === 0) return <EmptyBlock message="No data for this month." />;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
      {rows.map((d) => {
        const dateLabel = format(new Date(year, month - 1, d.day), "EEE dd MMM");
        return (
          <StatCard
            key={d.day}
            title={String(d.day).padStart(2, "0")}
            subtitle={dateLabel}
            metrics={[
              { label: "Avg", value: SEK(d.avg_price) },
              { label: "Min", value: SEK(d.min_price) },
              { label: "Max", value: SEK(d.max_price) },
              { label: "Hours", value: String(d.rows) },
            ]}
            onClick={() => onPick(d.day)}
          />
        );
      })}
    </div>
  );
}

// Level 4 – Day detail
function DayDetail({ year, month, day }: { year: number; month: number; day: number }) {
  const [rows, setRows] = useState<Array<{ hour: string; price_sek_kwh: number }> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRows(null);
    // Build a UTC-safe range covering the local Stockholm day.
    // Stockholm is UTC+1/+2 → fetch a wider UTC window then filter to local day.
    const startUtc = new Date(Date.UTC(year, month - 1, day - 1, 22, 0, 0)).toISOString();
    const endUtc = new Date(Date.UTC(year, month - 1, day + 1, 2, 0, 0)).toISOString();

    supabase
      .from("spot_prices")
      .select("hour, price_sek_kwh")
      .gte("hour", startUtc)
      .lte("hour", endUtc)
      .order("hour", { ascending: true })
      .then(({ data, error }) => {
        if (error) {
          setError(error.message);
          return;
        }
        const filtered = (data ?? []).filter((r) => {
          const d = new Date(r.hour);
          // Match by Stockholm local Y-M-D
          const local = new Date(d.toLocaleString("en-US", { timeZone: "Europe/Stockholm" }));
          return (
            local.getFullYear() === year &&
            local.getMonth() === month - 1 &&
            local.getDate() === day
          );
        });
        setRows(filtered.map((r) => ({ hour: r.hour, price_sek_kwh: Number(r.price_sek_kwh) })));
      });
  }, [year, month, day]);

  const chartData = useMemo(
    () =>
      (rows ?? []).map((r) => {
        const d = new Date(r.hour);
        const hour = d.toLocaleString("en-GB", { timeZone: "Europe/Stockholm", hour: "2-digit", minute: "2-digit" });
        return { hour, price: Number(r.price_sek_kwh.toFixed(4)) };
      }),
    [rows],
  );

  const dateTitle = format(new Date(year, month - 1, day), "EEEE, d MMMM yyyy");

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">{dateTitle}</h2>
          <p className="text-sm text-muted-foreground mt-1">Hourly SE3 spot price (Europe/Stockholm)</p>
        </div>
        <Button
          className="rounded-full bg-primary hover:bg-primary/90 text-primary-foreground gap-2"
          onClick={() => {
            // Not functional yet, per spec
          }}
        >
          <Play className="h-4 w-4" />
          Run simulation for this day
        </Button>
      </div>

      <Card className="rounded-2xl border-border/60 shadow-card p-5">
        {error ? (
          <EmptyBlock message={`Error: ${error}`} />
        ) : !rows ? (
          <LoadingBlock />
        ) : rows.length === 0 ? (
          <EmptyBlock message="No hourly data for this day." />
        ) : (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis
                  dataKey="hour"
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  tickLine={false}
                  axisLine={{ stroke: "hsl(var(--border))" }}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  tickLine={false}
                  axisLine={{ stroke: "hsl(var(--border))" }}
                  width={56}
                  tickFormatter={(v) => `${Number(v).toFixed(2)}`}
                />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 12,
                    fontSize: 12,
                  }}
                  formatter={(v: any) => [`${Number(v).toFixed(4)} SEK/kWh`, "Price"]}
                  labelFormatter={(l) => `Hour ${l}`}
                />
                <Line
                  type="monotone"
                  dataKey="price"
                  stroke="hsl(172, 66%, 34%)"
                  strokeWidth={2}
                  dot={{ r: 3, fill: "hsl(172, 66%, 34%)" }}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <Card className="rounded-2xl border-border/60 shadow-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40">
              <TableHead className="text-xs uppercase tracking-wider font-medium">Hour</TableHead>
              <TableHead className="text-xs uppercase tracking-wider font-medium">Price (SEK/kWh)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows && rows.length > 0 ? (
              rows.map((r, i) => {
                const hourLabel = new Date(r.hour).toLocaleString("en-GB", {
                  timeZone: "Europe/Stockholm",
                  hour: "2-digit",
                  minute: "2-digit",
                });
                return (
                  <TableRow key={i}>
                    <TableCell className="text-sm tabular-nums">{hourLabel}</TableCell>
                    <TableCell className="text-sm tabular-nums">{r.price_sek_kwh.toFixed(4)}</TableCell>
                  </TableRow>
                );
              })
            ) : (
              <TableRow>
                <TableCell colSpan={2} className="h-20 text-center text-sm text-muted-foreground">
                  {rows ? "No data" : "Loading…"}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function SpotPricesExplorer() {
  const [sel, setSel] = useState<Selection>({ year: null, month: null, day: null });

  return (
    <div className="space-y-6">
      <Breadcrumbs selection={sel} onNavigate={setSel} />

      {sel.year == null && (
        <YearsLevel onPick={(year) => setSel({ year, month: null, day: null })} />
      )}
      {sel.year != null && sel.month == null && (
        <MonthsLevel
          year={sel.year}
          onPick={(month) => setSel({ year: sel.year, month, day: null })}
        />
      )}
      {sel.year != null && sel.month != null && sel.day == null && (
        <DaysLevel
          year={sel.year}
          month={sel.month}
          onPick={(day) => setSel({ year: sel.year, month: sel.month, day })}
        />
      )}
      {sel.year != null && sel.month != null && sel.day != null && (
        <DayDetail year={sel.year} month={sel.month} day={sel.day} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Tariffs (unchanged)
// ─────────────────────────────────────────────────────────────

function TariffsTab() {
  const [tariffs, setTariffs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("grid_tariffs")
      .select("*")
      .order("valid_from", { ascending: false })
      .limit(100)
      .then(({ data, error }) => {
        if (error) setErr(error.message);
        else setTariffs(data ?? []);
        setLoading(false);
      });
  }, []);

  const headers = ["Company", "Hour", "Weekend", "Tariff (SEK/kWh)", "Valid from"];

  return (
    <Card className="rounded-2xl border-border/60 shadow-card overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40">
            {headers.map((h) => (
              <TableHead key={h} className="text-xs uppercase tracking-wider font-medium">{h}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow>
              <TableCell colSpan={headers.length} className="h-32 text-center text-sm text-muted-foreground">Loading…</TableCell>
            </TableRow>
          ) : err ? (
            <TableRow>
              <TableCell colSpan={headers.length} className="h-32 text-center text-sm text-muted-foreground">Error: {err}</TableCell>
            </TableRow>
          ) : tariffs.length === 0 ? (
            <TableRow>
              <TableCell colSpan={headers.length} className="h-32 text-center text-sm text-muted-foreground">No tariff data yet</TableCell>
            </TableRow>
          ) : (
            tariffs.map((r, i) => (
              <TableRow key={i}>
                <TableCell className="text-sm">{r.grid_company}</TableCell>
                <TableCell className="text-sm tabular-nums">{String(r.hour_of_day).padStart(2, "0")}:00</TableCell>
                <TableCell className="text-sm">{r.is_weekend ? "Yes" : "No"}</TableCell>
                <TableCell className="text-sm tabular-nums">{Number(r.tariff_sek_kwh).toFixed(4)}</TableCell>
                <TableCell className="text-sm">{r.valid_from}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </Card>
  );
}

export default function DataExplorer() {
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Data Explorer</h1>
        <p className="text-muted-foreground mt-1.5 text-sm">Drill down into spot prices and grid tariffs.</p>
      </header>

      <Tabs defaultValue="spot">
        <TabsList className="rounded-full bg-muted p-1">
          <TabsTrigger value="spot" className="rounded-full px-6">Spot prices</TabsTrigger>
          <TabsTrigger value="tariffs" className="rounded-full px-6">Grid tariffs</TabsTrigger>
        </TabsList>

        <TabsContent value="spot" className="mt-6">
          <SpotPricesExplorer />
        </TabsContent>

        <TabsContent value="tariffs" className="mt-6">
          <TariffsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
