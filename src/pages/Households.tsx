import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Plus, Home, Car, Check, ChevronsUpDown, Flame, Clock, Zap, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import {
  HEATING_KWH_PER_M2, HEATING_LABELS, ROUTINE_LABELS,
  calcAnnualKwh, buildHourlyWeights,
} from "@/lib/householdCalc";
import HouseholdDetail from "@/pages/HouseholdDetail";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

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
  heating_type: string | null;
  routine_type: string | null;
  annual_kwh: number | null;
  build_year?: number | null;
  insulation_quality?: string | null;
  has_solar_panels?: boolean | null;
  solar_kwh_per_year?: number | null;
  adults?: number | null;
  children?: number | null;
  children_ages?: string | null;
  home_during_day?: boolean | null;
  wake_time?: number | null;
  leave_time?: number | null;
  return_time?: number | null;
  sleep_time?: number | null;
}

interface EvModel {
  id: string;
  brand: string;
  model: string;
  battery_kwh: number;
  v2x_capable: boolean;
}

interface CProfile { household_id: string; hour: number; weight: number }

const fmtNum = (n: number) => new Intl.NumberFormat("sv-SE").format(n);

export default function Households() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Household[]>([]);
  const [evModels, setEvModels] = useState<EvModel[]>([]);
  const [profiles, setProfiles] = useState<Record<string, number[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [evPickerOpen, setEvPickerOpen] = useState(false);
  const [annualOverride, setAnnualOverride] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Household | null>(null);

  const [form, setForm] = useState({
    name: "",
    house_type: "villa",
    area_m2: "140",
    price_area: "SE3",
    grid_company: "",
    build_year: "1990",
    insulation_quality: "normal",
    heating_type: "värmepump_luft",
    has_solar_panels: false,
    solar_kwh_per_year: "",

    adults: 2,
    children: 0,
    children_ages: "",
    home_during_day: false,

    routine_type: "pendlare",
    wake_time: 6,
    leave_time: 7,
    return_time: 17,
    sleep_time: 23,

    ev_model_id: "",
    car_model: "",
    battery_kwh: "",
    daily_km: "40",
    commuter_type: "pendlare",

    annual_kwh: "",
  });

  const fetchData = async () => {
    setLoading(true);
    const [{ data: hh, error: hErr }, { data: evs, error: eErr }, { data: cps }] = await Promise.all([
      supabase.from("household_profiles").select("*").order("created_at", { ascending: false }),
      supabase.from("ev_models").select("id,brand,model,battery_kwh,v2x_capable").order("brand").order("model"),
      supabase.from("consumption_profiles").select("household_id,hour,weight"),
    ]);
    if (hErr || eErr) setError((hErr || eErr)!.message);
    else {
      setItems(hh as Household[]);
      setEvModels(evs as EvModel[]);
      const map: Record<string, number[]> = {};
      (cps as CProfile[] | null)?.forEach(r => {
        if (!map[r.household_id]) map[r.household_id] = new Array(24).fill(0);
        map[r.household_id][r.hour] = Number(r.weight);
      });
      setProfiles(map);
      setError(null);
    }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const selectedEv = useMemo(
    () => evModels.find(e => e.id === form.ev_model_id) || null,
    [evModels, form.ev_model_id]
  );

  const calculatedAnnual = useMemo(() => calcAnnualKwh({
    area_m2: Number(form.area_m2),
    heating_type: form.heating_type,
    adults: form.adults,
    children: form.children,
    build_year: Number(form.build_year),
    solar_kwh_per_year: Number(form.solar_kwh_per_year),
  }), [form.area_m2, form.heating_type, form.adults, form.children, form.build_year, form.solar_kwh_per_year]);

  useEffect(() => {
    if (!annualOverride) setForm(f => ({ ...f, annual_kwh: String(calculatedAnnual) }));
  }, [calculatedAnnual, annualOverride]);

  const avgKw = useMemo(() => (Number(form.annual_kwh) || 0) / 8760, [form.annual_kwh]);
  const showLeaveReturn = form.routine_type === "pendlare" || form.routine_type === "blandat";

  const handleSelectEv = (ev: EvModel) => {
    setForm(f => ({
      ...f,
      ev_model_id: ev.id,
      car_model: `${ev.brand} ${ev.model}`,
      battery_kwh: String(ev.battery_kwh),
    }));
    setEvPickerOpen(false);
  };

  const resetForm = () => {
    setForm({
      name: "", house_type: "villa", area_m2: "140", price_area: "SE3", grid_company: "",
      build_year: "1990", insulation_quality: "normal", heating_type: "värmepump_luft",
      has_solar_panels: false, solar_kwh_per_year: "",
      adults: 2, children: 0, children_ages: "", home_during_day: false,
      routine_type: "pendlare", wake_time: 6, leave_time: 7, return_time: 17, sleep_time: 23,
      ev_model_id: "", car_model: "", battery_kwh: "", daily_km: "40", commuter_type: "pendlare",
      annual_kwh: "",
    });
    setAnnualOverride(false);
    setEditId(null);
  };

  const handleEdit = (h: Household) => {
    setEditId(h.id);
    setAnnualOverride(true);
    setForm({
      name: h.name ?? "",
      house_type: h.house_type ?? "villa",
      area_m2: h.area_m2?.toString() ?? "",
      price_area: h.price_area ?? "SE3",
      grid_company: h.grid_company ?? "",
      build_year: (h as any).build_year?.toString() ?? "",
      insulation_quality: (h as any).insulation_quality ?? "normal",
      heating_type: h.heating_type ?? "värmepump_luft",
      has_solar_panels: !!(h as any).has_solar_panels,
      solar_kwh_per_year: (h as any).solar_kwh_per_year?.toString() ?? "",
      adults: (h as any).adults ?? 2,
      children: (h as any).children ?? 0,
      children_ages: (h as any).children_ages ?? "",
      home_during_day: !!(h as any).home_during_day,
      routine_type: h.routine_type ?? "pendlare",
      wake_time: (h as any).wake_time ?? 6,
      leave_time: (h as any).leave_time ?? 7,
      return_time: (h as any).return_time ?? 17,
      sleep_time: (h as any).sleep_time ?? 23,
      ev_model_id: h.ev_model_id ?? "",
      car_model: h.car_model ?? "",
      battery_kwh: h.battery_kwh?.toString() ?? "",
      daily_km: h.daily_km?.toString() ?? "40",
      commuter_type: h.commuter_type ?? "pendlare",
      annual_kwh: h.annual_kwh?.toString() ?? "",
    });
    setOpen(true);
  };

  const handleDelete = async (h: Household) => {
    await supabase.from("consumption_profiles").delete().eq("household_id", h.id);
    await supabase.from("simulation_runs").delete().eq("household_id", h.id);
    const { error } = await supabase.from("household_profiles").delete().eq("id", h.id);
    if (error) { toast.error(error.message); return; }
    toast.success(`${h.name} borttagen`);
    setDeleteTarget(null);
    if (selectedId === h.id) setSelectedId(null);
    fetchData();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const payload = {
      name: form.name,
      house_type: form.house_type,
      area_m2: form.area_m2 ? Number(form.area_m2) : null,
      price_area: form.price_area,
      grid_company: form.grid_company || null,
      build_year: form.build_year ? Number(form.build_year) : null,
      insulation_quality: form.insulation_quality,
      heating_type: form.heating_type,
      has_solar_panels: form.has_solar_panels,
      solar_kwh_per_year: form.solar_kwh_per_year ? Number(form.solar_kwh_per_year) : null,
      adults: form.adults,
      children: form.children,
      children_ages: form.children_ages || null,
      home_during_day: form.home_during_day,
      routine_type: form.routine_type,
      wake_time: form.wake_time,
      leave_time: form.leave_time,
      return_time: form.return_time,
      sleep_time: form.sleep_time,
      ev_model_id: form.ev_model_id || null,
      car_model: form.car_model || null,
      battery_kwh: form.battery_kwh ? Number(form.battery_kwh) : null,
      daily_km: form.daily_km ? Number(form.daily_km) : null,
      commuter_type: form.commuter_type,
      annual_kwh: form.annual_kwh ? Number(form.annual_kwh) : null,
    };

    let id = editId;
    if (editId) {
      const { error } = await supabase.from("household_profiles").update(payload).eq("id", editId);
      if (error) { setSaving(false); toast.error(error.message); return; }
    } else {
      const { data, error } = await supabase.from("household_profiles").insert(payload).select("id").single();
      if (error || !data) { setSaving(false); toast.error(error?.message || "Failed to save"); return; }
      id = data.id;
    }

    // Replace consumption profile
    const weights = buildHourlyWeights(form.routine_type, form.leave_time, form.return_time);
    await supabase.from("consumption_profiles").delete().eq("household_id", id!);
    const rows = weights.map((w, h) => ({ household_id: id!, hour: h, weight: w }));
    const { error: cpErr } = await supabase.from("consumption_profiles").insert(rows);
    if (cpErr) toast.warning(`Profile not saved: ${cpErr.message}`);

    setSaving(false);
    toast.success(editId ? "Hushåll uppdaterat" : "Hushåll sparat");
    setOpen(false);
    resetForm();
    fetchData();
  };

  if (selectedId) {
    return (
      <HouseholdDetail
        householdId={selectedId}
        onBack={() => setSelectedId(null)}
        onEdit={(h) => handleEdit(h as Household)}
        onDeleted={() => { setSelectedId(null); fetchData(); }}
        onStartSim={() => { /* TODO: navigate to runner with preselected household */ }}
      />
    );
  }

  return (
    <div className="space-y-10">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Virtual Households</h1>
          <p className="text-muted-foreground mt-1.5 text-sm">Define households used as inputs to simulations.</p>
        </div>
        <Button onClick={() => { resetForm(); setOpen(true); }} className="rounded-full bg-primary hover:bg-primary/90 text-primary-foreground gap-2">
          <Plus className="h-4 w-4" /> New household
        </Button>
      </header>

      {loading ? (
        <div className="grid grid-cols-3 gap-4">
          {[1,2,3].map(i => <Card key={i} className="rounded-2xl h-56 animate-pulse bg-muted/40 border-border/60" />)}
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
          <Button onClick={() => { resetForm(); setOpen(true); }} className="rounded-full bg-primary hover:bg-primary/90 text-primary-foreground mt-6 gap-2">
            <Plus className="h-4 w-4" /> Create first household
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {items.map((h) => (
            <Card
              key={h.id}
              onClick={() => setSelectedId(h.id)}
              className="group relative rounded-2xl border-border/60 shadow-card p-6 space-y-4 cursor-pointer hover:border-primary/40 hover:shadow-md transition-all"
            >
              <div className="absolute top-3 right-3 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); handleEdit(h); }}
                  className="h-7 w-7 rounded-full bg-background/80 backdrop-blur border flex items-center justify-center hover:bg-accent"
                  aria-label="Redigera"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setDeleteTarget(h); }}
                  className="h-7 w-7 rounded-full bg-background/80 backdrop-blur border flex items-center justify-center hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30"
                  aria-label="Ta bort"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="flex items-start justify-between pr-16">
                <div>
                  <h3 className="font-semibold text-base">{h.name}</h3>
                  <p className="text-xs text-muted-foreground capitalize mt-0.5">{h.house_type}</p>
                </div>
                <span className="text-xs px-2.5 py-1 rounded-full bg-primary-muted text-primary font-medium">{h.price_area ?? "—"}</span>
              </div>
              <div className="space-y-1.5 text-xs text-muted-foreground">
                {h.heating_type && <div className="flex items-center gap-2"><Flame className="h-3.5 w-3.5" /> {HEATING_LABELS[h.heating_type] ?? h.heating_type}</div>}
                {h.car_model && <div className="flex items-center gap-2"><Car className="h-3.5 w-3.5" /> {h.car_model}</div>}
                {h.annual_kwh != null && <div className="flex items-center gap-2"><Zap className="h-3.5 w-3.5" /> {fmtNum(h.annual_kwh)} kWh/år</div>}
                {h.routine_type && <div className="flex items-center gap-2"><Clock className="h-3.5 w-3.5" /> {ROUTINE_LABELS[h.routine_type] ?? h.routine_type}</div>}
              </div>
              <ProfileBars weights={profiles[h.id]} />
            </Card>
          ))}
        </div>
      )}

      <Sheet open={open} onOpenChange={(o) => { setOpen(o); if (!o) resetForm(); }}>
        <SheetContent className="sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{editId ? "Redigera hushåll" : "New household"}</SheetTitle>
            <SheetDescription>{editId ? "Uppdatera hushållsprofilen." : "Define a virtual household profile."}</SheetDescription>
          </SheetHeader>

          <form onSubmit={handleSubmit} className="space-y-5 mt-6 pb-10">
            <Field label="Namn"><Input required value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="Familjen Andersson" /></Field>

            <Accordion type="multiple" defaultValue={["bostaden","familjen","rutiner","elbil"]} className="space-y-2">
              <AccordionItem value="bostaden" className="border rounded-xl px-4">
                <AccordionTrigger className="text-sm font-medium">🏠 Bostaden</AccordionTrigger>
                <AccordionContent className="space-y-3 pt-2">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Hustyp">
                      <Select value={form.house_type} onValueChange={v => setForm({...form, house_type: v})}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="villa">Villa</SelectItem>
                          <SelectItem value="lägenhet">Lägenhet</SelectItem>
                          <SelectItem value="radhus">Radhus</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Area m²"><Input type="number" value={form.area_m2} onChange={e => setForm({...form, area_m2: e.target.value})} /></Field>
                    <Field label="Byggår"><Input type="number" value={form.build_year} onChange={e => setForm({...form, build_year: e.target.value})} /></Field>
                    <Field label="Prisområde">
                      <Select value={form.price_area} onValueChange={v => setForm({...form, price_area: v})}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{["SE1","SE2","SE3","SE4"].map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
                      </Select>
                    </Field>
                  </div>
                  <Field label="Värmesystem">
                    <Select value={form.heating_type} onValueChange={v => setForm({...form, heating_type: v})}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(HEATING_LABELS).map(([k,v]) => (
                          <SelectItem key={k} value={k}>🔥 {v} <span className="text-xs text-muted-foreground ml-1">({HEATING_KWH_PER_M2[k]} kWh/m²)</span></SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Isolering">
                    <Select value={form.insulation_quality} onValueChange={v => setForm({...form, insulation_quality: v})}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {["dålig","normal","bra","passivhus"].map(a => <SelectItem key={a} value={a} className="capitalize">{a}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Elnätsbolag"><Input value={form.grid_company} onChange={e => setForm({...form, grid_company: e.target.value})} placeholder="Ellevio" /></Field>
                  <div className="flex items-center justify-between rounded-lg border p-3">
                    <Label className="text-sm">Solpaneler</Label>
                    <Switch checked={form.has_solar_panels} onCheckedChange={v => setForm({...form, has_solar_panels: v})} />
                  </div>
                  {form.has_solar_panels && (
                    <Field label="Solproduktion kWh/år"><Input type="number" value={form.solar_kwh_per_year} onChange={e => setForm({...form, solar_kwh_per_year: e.target.value})} placeholder="6000" /></Field>
                  )}
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="familjen" className="border rounded-xl px-4">
                <AccordionTrigger className="text-sm font-medium">👨‍👩‍👧 Familjen</AccordionTrigger>
                <AccordionContent className="space-y-3 pt-2">
                  <Stepper label="Vuxna" value={form.adults} min={1} max={4} onChange={v => setForm({...form, adults: v})} />
                  <Stepper label="Barn" value={form.children} min={0} max={5} onChange={v => setForm({...form, children: v})} />
                  {form.children > 0 && (
                    <Field label="Barnens åldrar (kommaseparerat)"><Input value={form.children_ages} onChange={e => setForm({...form, children_ages: e.target.value})} placeholder="3, 7, 14" /></Field>
                  )}
                  <div className="flex items-center justify-between rounded-lg border p-3">
                    <Label className="text-sm">Någon hemma dagtid</Label>
                    <Switch checked={form.home_during_day} onCheckedChange={v => setForm({...form, home_during_day: v})} />
                  </div>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="rutiner" className="border rounded-xl px-4">
                <AccordionTrigger className="text-sm font-medium">⏰ Rutiner</AccordionTrigger>
                <AccordionContent className="space-y-3 pt-2">
                  <Field label="Rutintyp">
                    <Select value={form.routine_type} onValueChange={v => setForm({...form, routine_type: v})}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(ROUTINE_LABELS).map(([k,v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Vakna (h)"><Input type="number" min={0} max={23} value={form.wake_time} onChange={e => setForm({...form, wake_time: Number(e.target.value)})} /></Field>
                    <Field label="Sova (h)"><Input type="number" min={0} max={23} value={form.sleep_time} onChange={e => setForm({...form, sleep_time: Number(e.target.value)})} /></Field>
                    {showLeaveReturn && (
                      <>
                        <Field label="Lämnar (h)"><Input type="number" min={0} max={23} value={form.leave_time} onChange={e => setForm({...form, leave_time: Number(e.target.value)})} /></Field>
                        <Field label="Hem (h)"><Input type="number" min={0} max={23} value={form.return_time} onChange={e => setForm({...form, return_time: Number(e.target.value)})} /></Field>
                      </>
                    )}
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>

            {/* Annual estimate banner */}
            <Card className="rounded-xl border-primary/30 bg-primary/5 p-4 space-y-2">
              <div className="flex items-baseline justify-between">
                <span className="text-xs uppercase tracking-wider text-muted-foreground">Beräknad årsförbrukning</span>
                <button type="button" onClick={() => { setAnnualOverride(false); setForm(f => ({...f, annual_kwh: String(calculatedAnnual)})); }} className="text-xs text-primary hover:underline">Återställ</button>
              </div>
              <div className="flex items-end gap-3">
                <Input
                  type="number"
                  value={form.annual_kwh}
                  onChange={e => { setAnnualOverride(true); setForm({...form, annual_kwh: e.target.value}); }}
                  className="text-2xl font-semibold h-12 max-w-[180px]"
                />
                <span className="text-sm text-muted-foreground pb-3">kWh/år · ≈ {avgKw.toFixed(2)} kW snitt</span>
              </div>
              <p className="text-[11px] text-muted-foreground">Beräknat enligt svenska genomsnitt (SCB / Energimyndigheten)</p>
            </Card>

            <Accordion type="multiple" defaultValue={["elbil"]}>
              <AccordionItem value="elbil" className="border rounded-xl px-4">
                <AccordionTrigger className="text-sm font-medium">🚗 Elbil</AccordionTrigger>
                <AccordionContent className="space-y-3 pt-2">
                  <Field label="Elbilsmodell">
                    <Popover open={evPickerOpen} onOpenChange={setEvPickerOpen}>
                      <PopoverTrigger asChild>
                        <Button type="button" variant="outline" role="combobox" className="w-full justify-between font-normal">
                          {selectedEv ? (
                            <span className="flex items-center gap-2 truncate">
                              <span className="truncate">{selectedEv.brand} {selectedEv.model}</span>
                              <span className="text-xs text-muted-foreground">{selectedEv.battery_kwh} kWh</span>
                              {selectedEv.v2x_capable && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 font-semibold">V2X</span>}
                            </span>
                          ) : <span className="text-muted-foreground">Sök märke eller modell…</span>}
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[--radix-popover-trigger-width] p-0 z-50 bg-popover" align="start">
                        <Command filter={(value, search) => value.includes(search.toLowerCase()) ? 1 : 0}>
                          <CommandInput placeholder="Sök märke eller modell..." />
                          <CommandList className="max-h-[300px] overflow-y-auto overscroll-contain">
                            <CommandEmpty>Ingen elbil hittad.</CommandEmpty>
                            <CommandGroup>
                              {evModels.map(ev => (
                                <CommandItem key={ev.id} value={`${ev.brand} ${ev.model}`.toLowerCase()} onSelect={() => handleSelectEv(ev)} className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <Check className={cn("h-4 w-4", form.ev_model_id === ev.id ? "opacity-100" : "opacity-0")} />
                                    <span className="truncate">{ev.brand} {ev.model}</span>
                                    <span className="text-xs text-muted-foreground shrink-0">{ev.battery_kwh} kWh</span>
                                  </div>
                                  {ev.v2x_capable && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 font-semibold shrink-0">V2X</span>}
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Batteri kWh"><Input type="number" value={form.battery_kwh} onChange={e => setForm({...form, battery_kwh: e.target.value})} /></Field>
                    <Field label="Daglig km"><Input type="number" value={form.daily_km} onChange={e => setForm({...form, daily_km: e.target.value})} /></Field>
                  </div>
                  <Field label="Pendlingstyp">
                    <Select value={form.commuter_type} onValueChange={v => setForm({...form, commuter_type: v})}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pendlare">Pendlare</SelectItem>
                        <SelectItem value="hemarbetare">Hemarbetare</SelectItem>
                        <SelectItem value="blandat">Blandat</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                </AccordionContent>
              </AccordionItem>
            </Accordion>

            <Button type="submit" disabled={saving} className="w-full rounded-full bg-primary hover:bg-primary/90 text-primary-foreground">
              {saving ? "Sparar..." : "Spara hushåll"}
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

function Stepper({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (n: number) => void }) {
  return (
    <div className="flex items-center justify-between rounded-lg border p-3">
      <Label className="text-sm">{label}</Label>
      <div className="flex items-center gap-3">
        <Button type="button" size="sm" variant="outline" className="h-7 w-7 p-0 rounded-full" onClick={() => onChange(Math.max(min, value - 1))}>−</Button>
        <span className="w-6 text-center text-sm font-medium">{value}</span>
        <Button type="button" size="sm" variant="outline" className="h-7 w-7 p-0 rounded-full" onClick={() => onChange(Math.min(max, value + 1))}>+</Button>
      </div>
    </div>
  );
}

function ProfileBars({ weights }: { weights?: number[] }) {
  if (!weights || weights.length === 0) return null;
  const max = Math.max(...weights, 0.001);
  return (
    <div>
      <div className="flex items-end gap-[2px] h-12">
        {weights.map((w, i) => (
          <div
            key={i}
            className="flex-1 rounded-sm"
            style={{
              height: `${Math.max(6, (w / max) * 100)}%`,
              background: "hsl(172, 66%, 34%)",
              opacity: 0.85,
            }}
            title={`${i.toString().padStart(2,"0")}:00 — vikt ${w.toFixed(2)}`}
          />
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
        <span>00</span><span>06</span><span>12</span><span>18</span><span>23</span>
      </div>
    </div>
  );
}
