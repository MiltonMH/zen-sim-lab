import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Home } from "lucide-react";
import { toast } from "sonner";

export default function Households() {
  const [open, setOpen] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setOpen(false);
    toast.success("Household saved (database coming soon)");
  };

  return (
    <div className="space-y-10">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Virtual Households</h1>
          <p className="text-muted-foreground mt-1.5 text-sm">Define households used as inputs to simulations.</p>
        </div>
        <Button onClick={() => setOpen(true)} className="rounded-full bg-primary hover:bg-primary/90 text-primary-foreground gap-2">
          <Plus className="h-4 w-4" /> New household
        </Button>
      </header>

      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="h-16 w-16 rounded-full bg-primary-muted flex items-center justify-center mb-5">
          <Home className="h-7 w-7 text-primary" strokeWidth={1.5} />
        </div>
        <h2 className="text-lg font-semibold">No households created yet</h2>
        <p className="text-sm text-muted-foreground mt-1.5 max-w-sm">
          Create your first virtual household to begin simulating energy consumption
        </p>
        <Button onClick={() => setOpen(true)} className="rounded-full bg-primary hover:bg-primary/90 text-primary-foreground mt-6 gap-2">
          <Plus className="h-4 w-4" /> Create first household
        </Button>
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>New household</SheetTitle>
            <SheetDescription>Define a virtual household profile.</SheetDescription>
          </SheetHeader>

          <form onSubmit={handleSubmit} className="space-y-4 mt-6">
            <Field label="Name"><Input required placeholder="Familjen Andersson" /></Field>
            <Field label="House type">
              <Select defaultValue="Villa">
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Villa">Villa</SelectItem>
                  <SelectItem value="Lägenhet">Lägenhet</SelectItem>
                  <SelectItem value="Radhus">Radhus</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Area m²"><Input type="number" placeholder="140" /></Field>
            <Field label="Price area">
              <Select defaultValue="SE3">
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["SE1", "SE2", "SE3", "SE4"].map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Grid company"><Input placeholder="Ellevio" /></Field>
            <Field label="Car model"><Input placeholder="Tesla Model Y" /></Field>
            <Field label="Battery capacity kWh"><Input type="number" placeholder="75" /></Field>
            <Field label="Daily km"><Input type="number" placeholder="40" /></Field>
            <Field label="Commuter type">
              <Select defaultValue="Pendlare">
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Pendlare">Pendlare</SelectItem>
                  <SelectItem value="Hemarbetare">Hemarbetare</SelectItem>
                  <SelectItem value="Blandat">Blandat</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            <Button type="submit" className="w-full rounded-full bg-primary hover:bg-primary/90 text-primary-foreground mt-6">
              Save household
            </Button>
          </form>
        </SheetContent>
      </Sheet>
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
