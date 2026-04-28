import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CalendarIcon, LineChart as LineIcon } from "lucide-react";
import { format } from "date-fns";
import type { DateRange } from "react-day-picker";
import { cn } from "@/lib/utils";

function EmptyTable({ headers, message }: { headers: string[]; message: string }) {
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
          <TableRow>
            <TableCell colSpan={headers.length} className="h-32 text-center text-sm text-muted-foreground">
              {message}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </Card>
  );
}

function DateRangePicker({ value, onChange }: { value?: DateRange; onChange: (r?: DateRange) => void }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className={cn("rounded-full justify-start font-normal min-w-[260px]", !value && "text-muted-foreground")}>
          <CalendarIcon className="mr-2 h-4 w-4" />
          {value?.from ? (
            value.to ? `${format(value.from, "LLL d")} – ${format(value.to, "LLL d, y")}` : format(value.from, "LLL d, y")
          ) : "Pick date range"}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar mode="range" selected={value} onSelect={onChange} numberOfMonths={2} className="p-3 pointer-events-auto" />
      </PopoverContent>
    </Popover>
  );
}

export default function DataExplorer() {
  const [range, setRange] = useState<DateRange | undefined>();
  const [area, setArea] = useState("SE3");
  const [company, setCompany] = useState("");

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
          <div className="flex flex-wrap items-center gap-3">
            <DateRangePicker value={range} onChange={setRange} />
            <Select value={area} onValueChange={setArea}>
              <SelectTrigger className="rounded-full w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {["SE1", "SE2", "SE3", "SE4"].map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <Card className="rounded-2xl border-border/60 shadow-card p-10">
            <div className="h-72 flex flex-col items-center justify-center text-center">
              <div className="h-12 w-12 rounded-full bg-primary-muted flex items-center justify-center mb-4">
                <LineIcon className="h-5 w-5 text-primary" />
              </div>
              <p className="text-sm text-muted-foreground">Connect Nordpool data to populate</p>
            </div>
          </Card>

          <EmptyTable headers={["Hour", "Price area", "Price (SEK/kWh)", "Source"]} message="No data yet" />
        </TabsContent>

        <TabsContent value="tariffs" className="space-y-6 mt-6">
          <div className="flex items-center gap-3">
            <Select value={company} onValueChange={setCompany}>
              <SelectTrigger className="rounded-full w-[260px]">
                <SelectValue placeholder="Select grid company" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ellevio">Ellevio</SelectItem>
                <SelectItem value="vattenfall">Vattenfall Eldistribution</SelectItem>
                <SelectItem value="eon">E.ON Energidistribution</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <EmptyTable headers={["Company", "Hour", "Weekend", "Tariff (SEK/kWh)", "Valid from"]} message="No tariff data yet" />
        </TabsContent>
      </Tabs>
    </div>
  );
}
