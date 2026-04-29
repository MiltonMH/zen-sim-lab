import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Plus, Home, Car, Battery, MapPin, Check, ChevronsUpDown } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface Household {
  id: string;
  name: string;
  house_type: string;
  area_m2: number | null;
  price_area: string | null;
  grid_company: string | null;
  car_model: string | null;
  battery_kwh: number | null;
  daily_km: number | null;
  commuter_type: string | null;
  ev_model_id: string | null;
}

interface EvModel {
  id: string;
  brand: string;
  model: string;
  battery_kwh: number;
  range_km: number | null;
  max_charge_kw: number | null;
  v2x_capable: boolean;
}

export default function Households() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Household[]>([]);
  const [evModels, setEvModels] = useState<EvModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [evPickerOpen, setEvPickerOpen] = useState(false);

  const [form, setForm] = useState({
    name: "",
    house_type: "villa",
    area_m2: "",
    price_area: "SE3",
    grid_company: "",
    ev_model_id: "",
    car_model: "",
    battery_kwh: "",
    daily_km: "",
    commuter_type: "pendlare",
  });

  const fetchData = async () => {
    setLoading(true);
    const [{ data: hh, error: hErr }, { data: evs, error: eErr }] = await Promise.all([
      supabase.from("household_profiles").select("*").order("created_at", { ascending: false }),
      supabase.from("ev_models").select("*").order("brand").order("model"),
    ]);
    if (hErr || eErr) setError((hErr || eErr)!.message);
    else {
      setItems(hh as Household[]);
      setEvModels(evs as EvModel[]);
      setError(null);
    }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const selectedEv = useMemo(
    () => evModels.find(e => e.id === form.ev_model_id) || null,
    [evModels, form.ev_model_id]
  );

  const handleSelectEv = (ev: EvModel) => {
    setForm(f => ({
      ...f,
      ev_model_id: ev.id,
      car_model: `${ev.brand} ${ev.model}`,
      battery_kwh: String(ev.battery_kwh),
    }));
    setEvPickerOpen(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const { error } = await supabase.from("household_profiles").insert({
      name: form.name,
      house_type: form.house_type,
      area_m2: form.area_m2 ? Number(form.area_m2) : null,
      price_area: form.price_area,
      grid_company: form.grid_company || null,
      ev_model_id: form.ev_model_id || null,
      car_model: form.car_model || null,
      battery_kwh: form.battery_kwh ? Number(form.battery_kwh) : null,
      daily_km: form.daily_km ? Number(form.daily_km) : null,
      commuter_type: form.commuter_type,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Household saved");
    setOpen(false);
    setForm({ ...form, name: "", area_m2: "", grid_company: "", ev_model_id: "", car_model: "", battery_kwh: "", daily_km: "" });
    fetchData();
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

      {loading ? (
        <div className="grid grid-cols-3 gap-4">
          {[1,2,3].map(i => <Card key={i} className="rounded-2xl h-40 animate-pulse bg-muted/40 border-border/60" />)}
        </div>
      ) : error ? (
        <Card className="rounded-2xl p-8 border-destructive/40 bg-destructive/5">
          <p className="text-sm text-destructive">Failed to load: {error}</p>
        </Card>
      ) : items.length === 0 ? (
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
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {items.map((h) => (
            <Card key={h.id} className="rounded-2xl border-border/60 shadow-card p-6 space-y-4">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-base">{h.name}</h3>
                  <p className="text-xs text-muted-foreground capitalize mt-0.5">{h.house_type}</p>
                </div>
                <span className="text-xs px-2.5 py-1 rounded-full bg-primary-muted text-primary font-medium">{h.price_area ?? "—"}</span>
              </div>
              <div className="space-y-2 text-sm">
                {h.car_model && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Car className="h-3.5 w-3.5" /> <span>{h.car_model}</span>
                  </div>
                )}
                {h.battery_kwh && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Battery className="h-3.5 w-3.5" /> <span>{h.battery_kwh} kWh</span>
                  </div>
                )}
                {h.daily_km && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <MapPin className="h-3.5 w-3.5" /> <span>{h.daily_km} km/day</span>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>New household</SheetTitle>
            <SheetDescription>Define a virtual household profile.</SheetDescription>
          </SheetHeader>

          <form onSubmit={handleSubmit} className="space-y-4 mt-6">
            <Field label="Name"><Input required value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="Familjen Andersson" /></Field>
            <Field label="House type">
              <Select value={form.house_type} onValueChange={v => setForm({...form, house_type: v})}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="villa">Villa</SelectItem>
                  <SelectItem value="lägenhet">Lägenhet</SelectItem>
                  <SelectItem value="radhus">Radhus</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Area m²"><Input type="number" value={form.area_m2} onChange={e => setForm({...form, area_m2: e.target.value})} placeholder="140" /></Field>
            <Field label="Price area">
              <Select value={form.price_area} onValueChange={v => setForm({...form, price_area: v})}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["SE1","SE2","SE3","SE4"].map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Grid company"><Input value={form.grid_company} onChange={e => setForm({...form, grid_company: e.target.value})} placeholder="Ellevio" /></Field>

            <Field label="EV model">
              <Popover open={evPickerOpen} onOpenChange={setEvPickerOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    className="w-full justify-between font-normal"
                  >
                    {selectedEv ? (
                      <span className="flex items-center gap-2 truncate">
                        <span className="truncate">{selectedEv.brand} {selectedEv.model}</span>
                        <span className="text-xs text-muted-foreground">{selectedEv.battery_kwh} kWh</span>
                        {selectedEv.v2x_capable && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 font-semibold">V2X</span>
                        )}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Search brand or model…</span>
                    )}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0 z-50 bg-popover" align="start">
                  <Command
                    filter={(value, search) => {
                      // value is the lowercased text we set on CommandItem
                      return value.includes(search.toLowerCase()) ? 1 : 0;
                    }}
                  >
                    <CommandInput placeholder="Search brand or model..." />
                    <CommandList className="max-h-[300px] overflow-y-auto overscroll-contain">
                      <CommandEmpty>No EV found.</CommandEmpty>
                      <CommandGroup>
                        {evModels.map(ev => {
                          const label = `${ev.brand} ${ev.model}`;
                          return (
                            <CommandItem
                              key={ev.id}
                              value={`${ev.brand} ${ev.model}`.toLowerCase()}
                              onSelect={() => handleSelectEv(ev)}
                              className="flex items-center justify-between gap-2"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <Check className={cn("h-4 w-4", form.ev_model_id === ev.id ? "opacity-100" : "opacity-0")} />
                                <span className="truncate">{label}</span>
                                <span className="text-xs text-muted-foreground shrink-0">{ev.battery_kwh} kWh</span>
                              </div>
                              {ev.v2x_capable && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 font-semibold shrink-0">V2X</span>
                              )}
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </Field>

            <Field label="Battery capacity kWh"><Input type="number" value={form.battery_kwh} onChange={e => setForm({...form, battery_kwh: e.target.value})} placeholder="75" /></Field>
            <Field label="Daily km"><Input type="number" value={form.daily_km} onChange={e => setForm({...form, daily_km: e.target.value})} placeholder="40" /></Field>
            <Field label="Commuter type">
              <Select value={form.commuter_type} onValueChange={v => setForm({...form, commuter_type: v})}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pendlare">Pendlare</SelectItem>
                  <SelectItem value="hemarbetare">Hemarbetare</SelectItem>
                  <SelectItem value="blandat">Blandat</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            <Button type="submit" disabled={saving} className="w-full rounded-full bg-primary hover:bg-primary/90 text-primary-foreground mt-6">
              {saving ? "Saving..." : "Save household"}
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
