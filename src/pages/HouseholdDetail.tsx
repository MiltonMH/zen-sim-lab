import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronRight, Pencil, Trash2, Zap, MapPin, Car, Battery } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { HEATING_LABELS, ROUTINE_LABELS, SEASONAL_FACTOR } from "@/lib/householdCalc";

interface Household {
  id: string;
  name: string;
  house_type: string;
  area_m2: number | null;
  build_year: number | null;
  price_area: string | null;
  grid_company: string | null;
  heating_type: string | null;
  insulation_quality: string | null;
  has_solar_panels: boolean | null;
  solar_kwh_per_year: number | null;
  adults: number | null;
  children: number | null;
  children_ages: string | null;
  home_during_day: boolean | null;
  routine_type: string | null;
  wake_time: number | null;
  leave_time: number | null;
  return_time: number | null;
  sleep_time: number | null;
  ev_model_id: string | null;
  car_model: string | null;
  battery_kwh: number | null;
  daily_km: number | null;
  annual_kwh: number | null;
}

interface EvModel { id: string; brand: string; model: string; v2x_capable: boolean }
interface SimRun {
  id: string; started_at: string | null; period_from: string; period_to: string;
  optimization_mode: string; total_saved_sek: number | null; status: string | null;
  total_v2h_saving_sek: number | null; peak_hours_avoided: number | null;
}

const fmtNum = (n: number | null | undefined) => n == null ? "—" : new Intl.NumberFormat("sv-SE").format(n);
const seasonLabel = () => {
  const m = new Date().getMonth() + 1;
  const f = SEASONAL_FACTOR[m] ?? 1;
  if (f >= 2) return { name: "Vinter", f };
  if (f >= 1.4) return { name: "Höst/Vår", f };
  if (f >= 1) return { name: "Vår/Höst", f };
  return { name: "Sommar", f };
};

export default function HouseholdDetail({
  householdId, onBack, onEdit, onDeleted, onStartSim,
}: {
  householdId: string;
  onBack: () => void;
  onEdit: (h: Household) => void;
  onDeleted: () => void;
  onStartSim: (id: string) => void;
}) {
  const [h, setH] = useState<Household | null>(null);
  const [ev, setEv] = useState<EvModel | null>(null);
  const [weights, setWeights] = useState<number[]>([]);
  const [runs, setRuns] = useState<SimRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      const { data: hh } = await supabase.from("household_profiles").select("*").eq("id", householdId).maybeSingle();
      if (!active) return;
      setH(hh as Household | null);
      const [{ data: cps }, { data: sims }] = await Promise.all([
        supabase.from("consumption_profiles").select("hour,weight").eq("household_id", householdId),
        supabase.from("simulation_runs").select("id,started_at,period_from,period_to,optimization_mode,total_saved_sek,status,total_v2h_saving_sek,peak_hours_avoided").eq("household_id", householdId).order("started_at", { ascending: false }),
      ]);
      if (!active) return;
      const w = new Array(24).fill(0);
      (cps as { hour: number; weight: number }[] | null)?.forEach(r => { w[r.hour] = Number(r.weight); });
      setWeights(w);
      setRuns((sims as SimRun[]) ?? []);
      if (hh && (hh as Household).ev_model_id) {
        const { data: e } = await supabase.from("ev_models").select("id,brand,model,v2x_capable").eq("id", (hh as Household).ev_model_id!).maybeSingle();
        if (active) setEv(e as EvModel | null);
      } else {
        setEv(null);
      }
      setLoading(false);
    })();
    return () => { active = false; };
  }, [householdId]);

  const avgKw = useMemo(() => (h?.annual_kwh ?? 0) / 8760, [h?.annual_kwh]);
  const season = seasonLabel();
  const v2x = !!ev?.v2x_capable;

  const handleDelete = async () => {
    if (!h) return;
    await supabase.from("consumption_profiles").delete().eq("household_id", h.id);
    await supabase.from("simulation_runs").delete().eq("household_id", h.id);
    await supabase.from("household_profiles").delete().eq("id", h.id);
    setConfirmDelete(false);
    onDeleted();
  };

  if (loading || !h) {
    return <div className="space-y-6"><div className="h-6 w-64 bg-muted animate-pulse rounded" /><Card className="rounded-2xl h-40 animate-pulse bg-muted/40" /></div>;
  }

  return (
    <div className="space-y-8">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <button onClick={onBack} className="hover:text-foreground transition-colors">Households</button>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="text-foreground font-medium">{h.name}</span>
      </nav>

      {/* Header */}
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{h.name}</h1>
          <p className="text-sm text-muted-foreground mt-1.5 capitalize">{h.house_type} · {h.price_area ?? "—"}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="rounded-full gap-2" onClick={() => onEdit(h)}>
            <Pencil className="h-3.5 w-3.5" /> Redigera
          </Button>
          <Button variant="outline" size="sm" className="rounded-full gap-2 text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="h-3.5 w-3.5" /> Ta bort
          </Button>
        </div>
      </header>

      {/* Stat cards */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard icon={<Zap className="h-4 w-4" />} label="Årsförbrukning" value={`${fmtNum(h.annual_kwh)} kWh`} sub={`≈ ${avgKw.toFixed(2)} kW snitt`} />
        <StatCard icon={<MapPin className="h-4 w-4" />} label="Prisområde" value={h.price_area ?? "—"} />
        <StatCard icon={<Car className="h-4 w-4" />} label="Bilmodell" value={h.car_model ?? "—"} />
        <StatCard icon={<Battery className="h-4 w-4" />} label="V2X kapabel" value={
          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${v2x ? "bg-emerald-500/15 text-emerald-600" : "bg-muted text-muted-foreground"}`}>
            {v2x ? "Ja" : "Nej"}
          </span>
        } />
      </div>

      {/* Profile */}
      <Card className="rounded-2xl border-border/60 shadow-card p-6 space-y-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">Dygnsprofil</h2>
          <span className="text-xs text-muted-foreground">Justerat för: {season.name} (×{season.f})</span>
        </div>
        <ProfileChart weights={weights} avgKw={avgKw * season.f} />
      </Card>

      {/* Details */}
      <Card className="rounded-2xl border-border/60 shadow-card p-6">
        <h2 className="text-lg font-semibold mb-5">Hushållsdetaljer</h2>
        <div className="grid grid-cols-2 gap-x-10 gap-y-3 text-sm">
          <Detail label="Hustyp" value={<span className="capitalize">{h.house_type}</span>} />
          <Detail label="Antal vuxna" value={h.adults ?? "—"} />
          <Detail label="Yta" value={h.area_m2 ? `${h.area_m2} m²` : "—"} />
          <Detail label="Antal barn" value={`${h.children ?? 0}${h.children_ages ? ` (${h.children_ages})` : ""}`} />
          <Detail label="Byggår" value={h.build_year ?? "—"} />
          <Detail label="Rutin" value={h.routine_type ? ROUTINE_LABELS[h.routine_type] ?? h.routine_type : "—"} />
          <Detail label="Prisområde" value={h.price_area ?? "—"} />
          <Detail label="Vaknar" value={h.wake_time != null ? `${String(h.wake_time).padStart(2,"0")}:00` : "—"} />
          <Detail label="Uppvärmning" value={h.heating_type ? HEATING_LABELS[h.heating_type] ?? h.heating_type : "—"} />
          <Detail label="Lämnar" value={h.leave_time != null ? `${String(h.leave_time).padStart(2,"0")}:00` : "—"} />
          <Detail label="Isolering" value={<span className="capitalize">{h.insulation_quality ?? "—"}</span>} />
          <Detail label="Kommer hem" value={h.return_time != null ? `${String(h.return_time).padStart(2,"0")}:00` : "—"} />
          <Detail label="Solceller" value={h.has_solar_panels ? `Ja${h.solar_kwh_per_year ? ` · ${fmtNum(h.solar_kwh_per_year)} kWh/år` : ""}` : "Nej"} />
          <Detail label="Bil" value={h.car_model ?? "—"} />
          <Detail label="Elnätsbolag" value={h.grid_company ?? "—"} />
          <Detail label="Batteri" value={h.battery_kwh ? `${h.battery_kwh} kWh` : "—"} />
          <Detail label="Hemma dagtid" value={h.home_during_day ? "Ja" : "Nej"} />
          <Detail label="Daglig körsträcka" value={h.daily_km ? `${h.daily_km} km` : "—"} />
          <Detail label="" value="" />
          <Detail label="V2X kapabel" value={
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${v2x ? "bg-emerald-500/15 text-emerald-600" : "bg-muted text-muted-foreground"}`}>
              {v2x ? "Ja" : "Nej"}
            </span>
          } />
        </div>
      </Card>

      {/* Sim history */}
      <Card className="rounded-2xl border-border/60 shadow-card p-6">
        <h2 className="text-lg font-semibold mb-5">Simuleringshistorik</h2>
        {runs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <p className="text-sm text-muted-foreground">Inga simuleringar körda ännu</p>
            <Button onClick={() => onStartSim(h.id)} className="rounded-full bg-primary hover:bg-primary/90 text-primary-foreground mt-5">
              Kör första simulering
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground uppercase tracking-wider">
                  <th className="pb-3 font-medium">Datum</th>
                  <th className="pb-3 font-medium">Period</th>
                  <th className="pb-3 font-medium">Läge</th>
                  <th className="pb-3 font-medium text-right">Sparat (SEK)</th>
                  <th className="pb-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {runs.map(r => (
                  <tr key={r.id}>
                    <td className="py-3">{r.started_at ? new Date(r.started_at).toLocaleDateString("sv-SE") : "—"}</td>
                    <td className="py-3 text-muted-foreground">{r.period_from} → {r.period_to}</td>
                    <td className="py-3 capitalize">{r.optimization_mode}</td>
                    <td className="py-3 text-right font-medium">{fmtNum(r.total_saved_sek != null ? Math.round(Number(r.total_saved_sek)) : null)}</td>
                    <td className="py-3"><span className="text-xs px-2 py-0.5 rounded-full bg-muted capitalize">{r.status ?? "—"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm" onClick={() => setConfirmDelete(false)}>
          <Card className="rounded-2xl p-6 max-w-md w-full mx-4 space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold">Ta bort hushåll?</h3>
            <p className="text-sm text-muted-foreground">
              Är du säker på att du vill ta bort <strong className="text-foreground">{h.name}</strong>?
              Detta tar även bort all simuleringsdata för detta hushåll.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" className="rounded-full" onClick={() => setConfirmDelete(false)}>Avbryt</Button>
              <Button className="rounded-full bg-destructive hover:bg-destructive/90 text-destructive-foreground" onClick={handleDelete}>Ta bort</Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

function StatCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: React.ReactNode; sub?: string }) {
  return (
    <Card className="rounded-2xl border-border/60 shadow-card p-5 space-y-2">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        {icon}{label}
      </div>
      <div className="text-xl font-semibold truncate">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </Card>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  if (!label) return <div />;
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/40 pb-2">
      <span className="text-xs text-muted-foreground uppercase tracking-wider">{label}</span>
      <span className="font-medium text-right">{value}</span>
    </div>
  );
}

function ProfileChart({ weights, avgKw }: { weights: number[]; avgKw: number }) {
  if (!weights.length) return <p className="text-sm text-muted-foreground">Ingen profil sparad.</p>;
  const kwh = weights.map(w => w * avgKw);
  const max = Math.max(...kwh, 0.001);
  return (
    <div>
      <div className="flex items-end gap-1 h-48">
        {kwh.map((v, i) => (
          <div key={i} className="flex-1 flex flex-col items-center justify-end group relative">
            <div
              className="w-full rounded-t-sm transition-opacity group-hover:opacity-100"
              style={{ height: `${Math.max(2, (v / max) * 100)}%`, background: "hsl(172, 66%, 34%)", opacity: 0.85 }}
            />
            <div className="absolute bottom-full mb-1 hidden group-hover:block bg-popover border rounded-md px-2 py-1 text-[11px] whitespace-nowrap shadow-md z-10">
              {String(i).padStart(2,"0")}:00 · {v.toFixed(2)} kW
            </div>
          </div>
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground mt-2">
        <span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>23:00</span>
      </div>
      <div className="text-xs text-muted-foreground mt-1">kW förbrukning per timme</div>
    </div>
  );
}
