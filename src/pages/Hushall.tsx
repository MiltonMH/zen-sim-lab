import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Pencil, Trash2, Home, Car, Zap, FolderOpen, ChevronLeft, ChevronRight } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { householdTypeMeta, type HouseholdType } from "@/lib/householdTypes";

interface EvModel {
  id: string;
  brand: string;
  model: string;
  battery_kwh: number;
  ccs2_port: boolean | null;
}

interface Household {
  id: string;
  name: string;
  house_type: string | null;
  area_m2: number | null;
  build_year: number | null;
  price_area: string | null;
  grid_company: string | null;
  fuse_amps: number | null;
  heating_type: string | null;
  insulation_quality: string | null;
  annual_kwh: number | null;
  adults: number | null;
  children: number | null;
  routine_type: string | null;
  home_during_day: boolean | null;
  wake_time: number | null;
  leave_time: number | null;
  return_time: number | null;
  sleep_time: number | null;
  ev_model_id: string | null;
  battery_kwh: number | null;
  daily_km: number | null;
  commuter_type: string | null;
  min_soc_pct: number | null;
  max_soc_pct: number | null;
  household_type: HouseholdType | string | null;
  data_quality: string | null;
  notes: string | null;
  created_by: string | null;
}

const empty: Partial<Household> = {
  name: "",
  house_type: "villa",
  area_m2: 140,
  build_year: 2000,
  price_area: "SE3",
  grid_company: "",
  fuse_amps: 20,
  heating_type: "varmepump",
  insulation_quality: "medium",
  annual_kwh: 18000,
  adults: 2,
  children: 0,
  routine_type: "pendlare",
  home_during_day: false,
  wake_time: 6,
  leave_time: 7,
  return_time: 17,
  sleep_time: 23,
  ev_model_id: null,
  battery_kwh: null,
  daily_km: 40,
  commuter_type: "pendlare",
  household_type: "seed",
  data_quality: "verified",
  notes: "",
  created_by: "manual",
};

const HOUSE_TYPES = ["villa", "radhus", "lagenhet", "fritidshus"];
const PRICE_AREAS = ["SE1", "SE2", "SE3", "SE4"];
const HEATING = ["varmepump", "fjarrvarme", "direktel", "ved", "vattenburet_el"];
const INSULATION = ["bra", "medium", "daligt"];
const ROUTINE = ["pendlare", "hemma", "skiftarbete", "deltid"];
const FUSE_OPTIONS = [16, 20, 25, 35, 50, 63];

// Nätbolag per prisområde — används för att filtrera dropdown
const GRID_COMPANIES_BY_AREA: Record<string, string[]> = {
  SE1: ["Luleå Energi Elnät", "Skellefteå Kraft Elnät", "Umeå Energi Elnät"],
  SE2: ["Tekniska Verken Linköping", "Jämtkraft Elnät"],
  SE3: ["Göteborg Energi Nät", "Vattenfall Eldistribution", "E.ON Energidistribution", "Ellevio"],
  SE4: ["Kraftringen Nät"],
};

// Folder definitions for the root view
const FOLDERS: Array<{ key: HouseholdType; label: string; description: string; accent: string }> = [
  { key: "seed",     label: "Seed Testing",   description: "Manuellt skapade referenshushåll", accent: "text-muted-foreground" },
  { key: "training", label: "Training Data",  description: "Genererade hushåll för ML-träning", accent: "text-sky-700 dark:text-sky-400" },
  { key: "real",     label: "Real Customers", description: "Riktiga kundhushåll i drift",       accent: "text-emerald-700 dark:text-emerald-400" },
];

export default function Hushall() {
  const [items, setItems] = useState<Household[]>([]);
  const [evModels, setEvModels] = useState<EvModel[]>([]);
  const [tariffs, setTariffs] = useState<Record<string, number>>({});
  const [simCounts, setSimCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<Household> | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Household | null>(null);
  const [saving, setSaving] = useState(false);
  const [openFolder, setOpenFolder] = useState<HouseholdType | null>(null);

  const load = async () => {
    setLoading(true);
    const [{ data: hh }, { data: ev }, { data: gcs }, { data: sims }] = await Promise.all([
      supabase.from("household_profiles").select("*").order("name"),
      supabase.from("ev_models").select("id,brand,model,battery_kwh,ccs2_port").order("brand").order("model"),
      supabase.from("grid_company_settings").select("grid_company, peak_tariff_sek_per_kw"),
      supabase.from("simulation_runs").select("household_id"),
    ]);
    setItems((hh ?? []) as Household[]);
    setEvModels((ev ?? []) as EvModel[]);
    const map: Record<string, number> = {};
    for (const r of (gcs ?? []) as { grid_company: string; peak_tariff_sek_per_kw: number }[]) {
      map[r.grid_company] = Number(r.peak_tariff_sek_per_kw);
    }
    setTariffs(map);
    const counts: Record<string, number> = {};
    for (const r of (sims ?? []) as { household_id: string | null }[]) {
      if (r.household_id) counts[r.household_id] = (counts[r.household_id] ?? 0) + 1;
    }
    setSimCounts(counts);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const openCreate = () => {
    setEditing({ ...empty });
    setDialogOpen(true);
  };
  const openEdit = (h: Household) => {
    setEditing({ ...h });
    setDialogOpen(true);
  };

  const save = async () => {
    if (!editing) return;
    if (!editing.name?.trim()) {
      toast({ title: "Namn krävs", variant: "destructive" });
      return;
    }
    if (!editing.grid_company?.trim()) {
      toast({ title: "Nätbolag krävs", description: "Välj ett nätbolag för att kunna beräkna effekttariff.", variant: "destructive" });
      return;
    }
    setSaving(true);
    const payload: any = { ...editing };
    // sync battery_kwh from selected EV
    if (payload.ev_model_id) {
      const ev = evModels.find(e => e.id === payload.ev_model_id);
      if (ev) {
        payload.battery_kwh = ev.battery_kwh;
        payload.car_model = `${ev.brand} ${ev.model}`;
      }
    }
    let error;
    if (payload.id) {
      const { id, ...rest } = payload;
      ({ error } = await supabase.from("household_profiles").update(rest).eq("id", id));
    } else {
      delete payload.id;
      ({ error } = await supabase.from("household_profiles").insert(payload));
    }
    setSaving(false);
    if (error) {
      toast({ title: "Kunde inte spara", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: editing.id ? "Hushåll uppdaterat" : "Hushåll skapat" });
    setDialogOpen(false);
    setEditing(null);
    load();
  };

  const doDelete = async () => {
    if (!confirmDelete) return;
    const { error } = await supabase.from("household_profiles").delete().eq("id", confirmDelete.id);
    if (error) {
      toast({ title: "Kunde inte ta bort", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Hushåll borttaget" });
      load();
    }
    setConfirmDelete(null);
  };

  const set = (k: keyof Household, v: any) => setEditing(prev => ({ ...(prev ?? {}), [k]: v }));

  return (
    <div className="space-y-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Hushåll</h1>
          <p className="text-sm text-muted-foreground mt-1">Skapa och redigera hushållsprofiler</p>
        </div>
        <Button onClick={openCreate} className="gap-2">
          <Plus className="h-4 w-4" /> Nytt hushåll
        </Button>
      </header>

      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <button
          onClick={() => setOpenFolder(null)}
          className={openFolder ? "hover:text-foreground transition-colors" : "text-foreground font-medium"}
        >
          Hushåll
        </button>
        {openFolder && (
          <>
            <ChevronRight className="h-3.5 w-3.5" />
            <span className="text-foreground font-medium">
              {FOLDERS.find(f => f.key === openFolder)?.label ?? openFolder}
            </span>
          </>
        )}
      </div>

      {(() => {
        if (loading) return <div className="text-sm text-muted-foreground">Laddar…</div>;

        // ====== ROOT VIEW: folder cards ======
        if (!openFolder) {
          return (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {FOLDERS.map(f => {
                const inFolder = items.filter(h => (h.household_type ?? "training") === f.key);
                const totalSims = inFolder.reduce((s, h) => s + (simCounts[h.id] ?? 0), 0);
                const meta = householdTypeMeta(f.key);
                return (
                  <button
                    key={f.key}
                    onClick={() => setOpenFolder(f.key)}
                    className="text-left group"
                  >
                    <Card className="p-6 transition-all hover:shadow-md hover:border-primary/30 h-full">
                      <div className="flex items-start justify-between gap-3">
                        <FolderOpen className={`h-10 w-10 ${f.accent}`} />
                        <Badge className={`text-[10px] rounded-full ${meta.className}`}>{meta.label}</Badge>
                      </div>
                      <h3 className="font-semibold text-lg mt-4">{f.label}</h3>
                      <p className="text-xs text-muted-foreground mt-1">{f.description}</p>
                      <div className="flex items-end justify-between mt-5 pt-4 border-t border-border/60">
                        <div>
                          <div className="text-2xl font-semibold tabular-nums">{inFolder.length}</div>
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">hushåll</div>
                        </div>
                        <div className="text-right">
                          <div className="text-2xl font-semibold tabular-nums">{totalSims}</div>
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">simuleringar</div>
                        </div>
                      </div>
                    </Card>
                  </button>
                );
              })}
            </div>
          );
        }

        // ====== FOLDER DETAIL VIEW ======
        const filtered = items.filter(h => (h.household_type ?? "training") === openFolder);
        return (
          <div className="space-y-4">
            <Button variant="ghost" size="sm" className="gap-1 -ml-2" onClick={() => setOpenFolder(null)}>
              <ChevronLeft className="h-4 w-4" /> Tillbaka till mappar
            </Button>

            {filtered.length === 0 ? (
              <Card className="p-10 text-center text-sm text-muted-foreground">
                Inga hushåll i denna mapp ännu.
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filtered.map(h => {
                  const ev = evModels.find(e => e.id === h.ev_model_id);
                  const meta = householdTypeMeta(h.household_type);
                  return (
                    <Card key={h.id} className="p-5 space-y-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-semibold text-lg leading-tight">{h.name}</h3>
                            <Badge className={`text-[10px] rounded-full ${meta.className}`}>{meta.label}</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">
                            {h.grid_company ?? "Inget nätbolag"} · {h.price_area} · {h.house_type ?? "—"} {h.area_m2 ? `${h.area_m2}m²` : ""}
                          </p>
                          {h.grid_company && tariffs[h.grid_company] != null && (
                            <p className="text-[11px] text-muted-foreground mt-0.5">
                              Effekttariff: {tariffs[h.grid_company]} SEK/kW/månad
                            </p>
                          )}
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <Button variant="ghost" size="icon" onClick={() => openEdit(h)} title="Redigera">
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => setConfirmDelete(h)} title="Ta bort">
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </div>

                      <div className="space-y-2 text-sm">
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Zap className="h-3.5 w-3.5" />
                          <span>Säkring {h.fuse_amps ?? 20}A · {h.annual_kwh?.toLocaleString("sv-SE") ?? "—"} kWh/år</span>
                        </div>
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Car className="h-3.5 w-3.5" />
                          <span>{ev ? `${ev.brand} ${ev.model}` : "Ingen bil"}</span>
                          {ev?.ccs2_port && <Badge variant="secondary" className="text-[10px]">CCS2</Badge>}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {simCounts[h.id] ?? 0} simuleringar
                        </div>
                        {h.notes && (
                          <p className="text-[11px] text-muted-foreground/80 italic line-clamp-2 pt-1">{h.notes}</p>
                        )}
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Redigera hushåll" : "Nytt hushåll"}</DialogTitle>
          </DialogHeader>

          {editing && (
            <div className="grid grid-cols-2 gap-4 py-2">
              <div className="col-span-2">
                <Label>Namn</Label>
                <Input value={editing.name ?? ""} onChange={e => set("name", e.target.value)} />
              </div>

              <div>
                <Label>Hustyp</Label>
                <Select value={editing.house_type ?? "villa"} onValueChange={v => set("house_type", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {HOUSE_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Yta (m²)</Label>
                <Input type="number" value={editing.area_m2 ?? ""} onChange={e => set("area_m2", Number(e.target.value) || null)} />
              </div>

              <div>
                <Label>Byggår</Label>
                <Input type="number" value={editing.build_year ?? ""} onChange={e => set("build_year", Number(e.target.value) || null)} />
              </div>
              <div>
                <Label>Prisområde</Label>
                <Select
                  value={editing.price_area ?? "SE3"}
                  onValueChange={v => setEditing(prev => ({ ...(prev ?? {}), price_area: v, grid_company: "" }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PRICE_AREAS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Nätbolag <span className="text-destructive">*</span></Label>
                <Select
                  value={editing.grid_company ?? ""}
                  onValueChange={v => set("grid_company", v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Välj nätbolag" />
                  </SelectTrigger>
                  <SelectContent>
                    {(GRID_COMPANIES_BY_AREA[editing.price_area ?? "SE3"] ?? []).map(c => (
                      <SelectItem key={c} value={c}>
                        {c}{tariffs[c] != null ? ` · ${tariffs[c]} SEK/kW` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!editing.grid_company && (
                  <p className="text-[11px] text-destructive mt-1">Krävs för effekttariff-beräkning</p>
                )}
              </div>
              <div>
                <Label>Huvudsäkring (A)</Label>
                <Select value={String(editing.fuse_amps ?? 20)} onValueChange={v => set("fuse_amps", Number(v))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FUSE_OPTIONS.map(a => <SelectItem key={a} value={String(a)}>{a} A</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Uppvärmning</Label>
                <Select value={editing.heating_type ?? "varmepump"} onValueChange={v => set("heating_type", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {HEATING.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Isolering</Label>
                <Select value={editing.insulation_quality ?? "medium"} onValueChange={v => set("insulation_quality", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {INSULATION.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Årsförbrukning (kWh)</Label>
                <Input type="number" value={editing.annual_kwh ?? ""} onChange={e => set("annual_kwh", Number(e.target.value) || null)} />
              </div>
              <div>
                <Label>Rutin</Label>
                <Select value={editing.routine_type ?? "pendlare"} onValueChange={v => set("routine_type", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ROUTINE.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Vuxna</Label>
                <Input type="number" value={editing.adults ?? 0} onChange={e => set("adults", Number(e.target.value) || 0)} />
              </div>
              <div>
                <Label>Barn</Label>
                <Input type="number" value={editing.children ?? 0} onChange={e => set("children", Number(e.target.value) || 0)} />
              </div>

              <div>
                <Label>Vakna kl</Label>
                <Input type="number" min={0} max={23} value={editing.wake_time ?? 6} onChange={e => set("wake_time", Number(e.target.value))} />
              </div>
              <div>
                <Label>Lämnar hem kl</Label>
                <Input type="number" min={0} max={23} value={editing.leave_time ?? 7} onChange={e => set("leave_time", Number(e.target.value))} />
              </div>
              <div>
                <Label>Hem kl</Label>
                <Input type="number" min={0} max={23} value={editing.return_time ?? 17} onChange={e => set("return_time", Number(e.target.value))} />
              </div>
              <div>
                <Label>Sover kl</Label>
                <Input type="number" min={0} max={23} value={editing.sleep_time ?? 23} onChange={e => set("sleep_time", Number(e.target.value))} />
              </div>

              <div className="col-span-2 border-t pt-4 mt-2">
                <h4 className="font-medium mb-3">Elbil</h4>
              </div>
              <div className="col-span-2">
                <Label>Bilmodell</Label>
                <Select value={editing.ev_model_id ?? "none"} onValueChange={v => set("ev_model_id", v === "none" ? null : v)}>
                  <SelectTrigger><SelectValue placeholder="Välj bil" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— Ingen bil —</SelectItem>
                    {evModels.map(e => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.brand} {e.model} ({e.battery_kwh} kWh){e.ccs2_port ? " · CCS2" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Daglig körsträcka (km)</Label>
                <Input type="number" value={editing.daily_km ?? ""} onChange={e => set("daily_km", Number(e.target.value) || null)} />
              </div>
              <div>
                <Label>Pendlartyp</Label>
                <Select value={editing.commuter_type ?? "pendlare"} onValueChange={v => set("commuter_type", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ROUTINE.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="col-span-2 border-t pt-4 mt-2">
                <h4 className="font-medium mb-3">Klassificering</h4>
              </div>
              <div>
                <Label>Typ</Label>
                <Select
                  value={(editing.household_type as string) ?? "seed"}
                  onValueChange={v => set("household_type", v)}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="seed">Referens (seed)</SelectItem>
                    <SelectItem value="training">Träningsdata</SelectItem>
                    <SelectItem value="real">Riktig kund</SelectItem>
                  </SelectContent>
                </Select>
                {(() => {
                  const t = (editing.household_type as string) ?? "seed";
                  const label =
                    t === "seed" ? "Seed-data"
                    : t === "training" ? "Träningsdata"
                    : "Kunddata";
                  return (
                    <Badge className="mt-2 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-transparent">
                      Taggas som: {label}
                    </Badge>
                  );
                })()}
              </div>
              <div>
                <Label>Datakvalitet</Label>
                <Select
                  value={editing.data_quality ?? "verified"}
                  onValueChange={v => set("data_quality", v)}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="verified">Verifierad</SelectItem>
                    <SelectItem value="generated">Genererad</SelectItem>
                    <SelectItem value="needs_review">Behöver granskas</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <Label>Anteckningar</Label>
                <Input
                  value={editing.notes ?? ""}
                  onChange={e => set("notes", e.target.value)}
                  placeholder="Fri text om hushållet (valfritt)"
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Avbryt</Button>
            <Button onClick={save} disabled={saving}>{saving ? "Sparar…" : "Spara"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmDelete} onOpenChange={o => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ta bort hushåll?</AlertDialogTitle>
            <AlertDialogDescription>
              Detta tar bort "{confirmDelete?.name}" permanent. Tidigare simuleringar behålls
              men kommer inte längre kopplas till ett aktivt hushåll.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction onClick={doDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Ta bort
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
