import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FileText } from "lucide-react";

function ResultsTable({ headers }: { headers: string[] }) {
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
            <TableCell colSpan={headers.length} className="h-40">
              <div className="flex flex-col items-center justify-center text-center">
                <div className="h-10 w-10 rounded-full bg-primary-muted flex items-center justify-center mb-3">
                  <FileText className="h-4 w-4 text-primary" />
                </div>
                <p className="text-sm text-muted-foreground">No results yet — run a simulation to see data here</p>
              </div>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </Card>
  );
}

export default function Results() {
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
          <ResultsTable headers={["Simulation ID", "Household", "Period", "Mode", "Total saved (SEK)", "Avg price paid", "Events"]} />
        </TabsContent>

        <TabsContent value="logs" className="mt-6">
          <ResultsTable headers={["Timestamp", "Household", "Decision", "Spot price", "SoC %", "Reason"]} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
