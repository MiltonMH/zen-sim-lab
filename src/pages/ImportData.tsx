import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CalendarIcon, Download } from "lucide-react";
import { format } from "date-fns";
import type { DateRange } from "react-day-picker";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface ElspotRecord {
  HourDK: string;
  PriceArea: string;
  SpotPriceDKK: number | null;
  SpotPriceEUR: number | null;
}

export default function ImportData() {
  const [range, setRange] = useState<DateRange | undefined>({
    from: new Date("2024-01-01"),
    to: new Date(),
  });
  const [area, setArea] = useState("SE3");
  const [eurRate, setEurRate] = useState("11.20");
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const handleImport = async () => {
    if (!range?.from || !range?.to) {
      toast.error("Pick a date range");
      return;
    }
    const eur = Number(eurRate);
    if (!eur || eur <= 0) {
      toast.error("EUR to SEK rate must be a positive number");
      return;
    }

    setImporting(true);
    setProgress({ done: 0, total: 0 });

    try {
      const start = format(range.from, "yyyy-MM-dd") + "T00:00";
      const end = format(range.to, "yyyy-MM-dd") + "T00:00";
      const filter = encodeURIComponent(JSON.stringify({ PriceArea: ["DK1"] }));
      const url = `https://api.energidataservice.dk/dataset/Elspotprices?limit=0&filter=${filter}&start=${start}&end=${end}&sort=HourDK%20asc`;

      const res = await fetch(url);
      if (!res.ok) throw new Error(`Energidata API returned ${res.status}`);
      const json = await res.json();
      const records: ElspotRecord[] = json.records ?? [];

      if (records.length === 0) {
        toast.error("No data returned for that range");
        setImporting(false);
        setProgress(null);
        return;
      }

      const rows = records
        .filter((r) => r.SpotPriceDKK != null)
        .map((r) => ({
          hour: new Date(r.HourDK + "Z").toISOString(),
          price_sek_kwh: Number((((r.SpotPriceDKK as number) / 1000) * eur).toFixed(5)),
          price_area: area,
          source: "nordpool",
        }));

      const total = rows.length;
      setProgress({ done: 0, total });

      const chunkSize = 500;
      let done = 0;
      for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        const { error } = await supabase.from("spot_prices").insert(chunk);
        if (error) throw error;
        done += chunk.length;
        setProgress({ done, total });
      }

      toast.success(`Imported ${total.toLocaleString()} hourly prices`);
    } catch (e: any) {
      toast.error(e.message ?? "Import failed");
    } finally {
      setImporting(false);
      setProgress(null);
    }
  };

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Import Data</h1>
        <p className="text-muted-foreground mt-1.5 text-sm">Pull market data into the lab.</p>
      </header>

      <Card className="max-w-[640px] mx-auto rounded-2xl border-border/60 shadow-card p-8 space-y-10">
        {/* Section 1 */}
        <section className="space-y-5">
          <div>
            <h2 className="text-lg font-semibold">Import spot prices</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Fetch historical hourly spot prices from Nordpool for SE3 price area.
            </p>
          </div>

          <Field label="Date range">
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn("w-full rounded-xl justify-start font-normal", !range && "text-muted-foreground")}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {range?.from && range?.to
                    ? `${format(range.from, "LLL d, y")} – ${format(range.to, "LLL d, y")}`
                    : "Pick date range"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="range"
                  selected={range}
                  onSelect={setRange}
                  numberOfMonths={2}
                  className="p-3 pointer-events-auto"
                />
              </PopoverContent>
            </Popover>
          </Field>

          <Field label="Price area">
            <Select value={area} onValueChange={setArea}>
              <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="SE3">SE3</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field label="EUR to SEK conversion rate">
            <Input
              type="number"
              step="0.01"
              value={eurRate}
              onChange={(e) => setEurRate(e.target.value)}
              className="rounded-xl"
            />
          </Field>

          <Button
            onClick={handleImport}
            disabled={importing}
            className="w-full rounded-full bg-primary hover:bg-primary/90 text-primary-foreground h-11 gap-2"
          >
            <Download className="h-4 w-4" />
            {importing
              ? progress && progress.total > 0
                ? `Importing ${progress.done.toLocaleString()} of ${progress.total.toLocaleString()} hours...`
                : "Fetching..."
              : "Fetch and import"}
          </Button>
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</Label>
      {children}
    </div>
  );
}
