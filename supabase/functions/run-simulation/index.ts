import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// --- Engine constants ---
const ARC_MAX_KW = 11;            // Arc hardware max (DC, both directions)
const TARGET_CHARGE_HOURS = 8;    // hours/day to charge in basic mode
const KM_PER_PCT = 5;             // km per % battery (rough)
const PEAK_HOURS = new Set([17, 18, 19, 20]); // V2H window 17-21 (4 hours) for level 2
const DEFAULT_HARD_MAX_PRICE = 2.0;
const TOO_CHEAP_PRICE = 0.20;
const DEFAULT_SOC_EMERGENCY = 20;
const SOC_PROTECT = 95;           // never charge above this (legacy modes)
const SOC_HEALTH_MAX = 90;        // smart_v2x: never charge above 90 (battery health)
const SOC_PREFERRED_MAX = 80;     // smart_v2x: stop here unless tomorrow needs more
const SOC_V2H_FLOOR = 20;         // smart_v2x: never V2H below 20
const KM_PER_KWH_BASELINE = 6;    // ~6 km per kWh
const ENERGY_TAX_SEK = 0.549;     // 2025 Swedish energy tax SEK/kWh
const VAT_MULTIPLIER = 1.25;      // 25% moms
const DEFAULT_GRID_TARIFF = 0.30; // fallback SEK/kWh when no tariff configured
const DEFAULT_PEAK_TARIFF = 55;   // SEK/kW/month fallback
const DC_EFFICIENCY = 0.95;       // both directions

// V2H aktiveringströsklar per prisområde (SEK/kWh)
// SE1/SE2 har lägre snittpriser → lägre tröskel så V2H faktiskt används
const V2H_THRESHOLDS: Record<string, number> = {
  SE1: 0.25,
  SE2: 0.50,
  SE3: 0.80,
  SE4: 0.65,
};
// V2H kräver också att aktuellt pris ligger minst X% över dagens snittpris
const V2H_DAILY_SPREAD_MULTIPLIER = 1.3;

// Default consumption weights (pendlare style) if profile missing
const DEFAULT_WEIGHTS = [
  0.3,0.3,0.3,0.3,0.3,0.3,
  1.0,2.0,1.2,1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.2,
  2.2,2.4,2.2,2.0,1.5,1.0,0.6,
];

interface SpotPrice { hour: string; price_sek_kwh: number }
interface DayHour { iso: string; hourOfDay: number; price: number; weight: number }

type Mode = "smart_charge_basic" | "smart_charge" | "smart_v2x";

function normalizeMode(m: string | null | undefined): Mode {
  if (m === "smart_charge_basic" || m === "level1") return "smart_charge_basic";
  if (m === "smart_v2x" || m === "level3") return "smart_v2x";
  return "smart_charge"; // default = level 2
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { simulation_id } = await req.json().catch(() => ({}));
    if (!simulation_id || typeof simulation_id !== "string") {
      return json({ error: "simulation_id required" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1. Simulation
    const { data: sim, error: simErr } = await supabase
      .from("simulation_runs").select("*").eq("id", simulation_id).maybeSingle();
    if (simErr || !sim) return json({ error: simErr?.message ?? "Simulation not found" }, 404);
    await supabase.from("simulation_runs").update({ status: "running" }).eq("id", simulation_id);

    const mode: Mode = normalizeMode(sim.optimization_mode);

    // 2. Household
    const { data: hh, error: hErr } = await supabase
      .from("household_profiles").select("*").eq("id", sim.household_id).maybeSingle();
    if (hErr || !hh) return failSim(supabase, simulation_id, "Household not found", 404);

    const batteryKwh = Number(hh.battery_kwh) || 60;
    const baseDailyKm = Number(hh.daily_km) || 30;
    const priceArea = hh.price_area || "SE3";
    const annualKwh = Number(hh.annual_kwh) || 18000;
    const avgHouseKw = annualKwh / 8760;
    const fuseAmps = Number(hh.fuse_amps) || 20;
    // 3-phase Swedish residential: kW = A * 0.23 * 3
    const fuseMaxKw = fuseAmps * 0.23 * 3;

    // --- Scenario parameters ---
    const sp = (sim.scenario_params ?? {}) as Record<string, number>;
    const startingSoc = clamp(num(sp.starting_soc, 50), 5, 100);
    const dailyKmMul = clamp(num(sp.daily_km_multiplier, 1.0), 0.1, 3.0);
    const priceThreshold = clamp(num(sp.price_threshold, DEFAULT_HARD_MAX_PRICE), 0.5, 10);
    const minSoc = clamp(num(sp.min_soc, DEFAULT_SOC_EMERGENCY), 5, 80);
    const dailyKm = baseDailyKm * dailyKmMul;
    const dailyKwhNeeded = (dailyKm / KM_PER_PCT) * batteryKwh / 100;

    // 2b. EV — CCS2 gating + DC limits
    let ccs2Port = true;
    let maxDcChargeKw = ARC_MAX_KW;
    let maxV2xDischargeKw = ARC_MAX_KW;
    if (hh.ev_model_id) {
      const { data: ev } = await supabase
        .from("ev_models")
        .select("ccs2_port, max_dc_charge_kw, max_v2x_discharge_kw")
        .eq("id", hh.ev_model_id).maybeSingle();
      if (ev) {
        ccs2Port = ev.ccs2_port !== false; // default true
        if (ev.max_dc_charge_kw != null) maxDcChargeKw = Number(ev.max_dc_charge_kw);
        if (ev.max_v2x_discharge_kw != null) maxV2xDischargeKw = Number(ev.max_v2x_discharge_kw);
      }
    }

    // CCS2 gating — only smart_v2x requires it (charge-only modes work on AC too via Arc)
    if (mode === "smart_v2x" && !ccs2Port) {
      await supabase.from("simulation_runs").update({
        status: "failed",
        ended_at: new Date().toISOString(),
      }).eq("id", simulation_id);
      return json({
        error: "Denna bil saknar CCS2-port och är inte kompatibel med Arc laddbox.",
      }, 400);
    }

    const chargeMaxKw = Math.min(ARC_MAX_KW, maxDcChargeKw);
    const v2hMaxKw = Math.min(ARC_MAX_KW, maxV2xDischargeKw);

    // 2c. Consumption profile
    const { data: cps } = await supabase
      .from("consumption_profiles").select("hour, weight").eq("household_id", sim.household_id);
    const weights = [...DEFAULT_WEIGHTS];
    if (cps && cps.length > 0) {
      for (const r of cps as { hour: number; weight: number }[]) {
        if (r.hour >= 0 && r.hour < 24) weights[r.hour] = Number(r.weight);
      }
    }
    const sumWeights = weights.reduce((s, w) => s + w, 0);

    // 3. Spot prices
    const fromIso = `${sim.period_from}T00:00:00+00:00`;
    const toIso = `${sim.period_to}T23:59:59+00:00`;
    let { data: prices, error: pErr } = await supabase
      .from("spot_prices")
      .select("hour, price_sek_kwh")
      .eq("price_area", priceArea)
      .gte("hour", fromIso).lte("hour", toIso)
      .order("hour", { ascending: true });
    if (pErr) return failSim(supabase, simulation_id, pErr.message, 500);
    if (!prices || prices.length === 0) {
      const fb = await supabase.from("spot_prices")
        .select("hour, price_sek_kwh").eq("price_area", "SE3")
        .gte("hour", fromIso).lte("hour", toIso)
        .order("hour", { ascending: true });
      prices = fb.data ?? [];
    }
    if (!prices || prices.length === 0) {
      const { data: range } = await supabase
        .from("spot_prices").select("hour").eq("price_area", "SE3")
        .order("hour", { ascending: false }).limit(1);
      const lastHour = range?.[0]?.hour ?? "unknown";
      return failSim(
        supabase, simulation_id,
        `No spot prices for ${priceArea} between ${sim.period_from} and ${sim.period_to}. Latest: ${lastHour}.`,
        400,
      );
    }

    // 3b. Energy grid tariffs (SEK/kWh)
    type Tariff = { hour_of_day: number; is_weekend: boolean; tariff_sek_kwh: number; month_from: number | null; month_to: number | null };
    let tariffs: Tariff[] = [];
    if (hh.grid_company) {
      const { data: t } = await supabase
        .from("grid_tariffs")
        .select("hour_of_day, is_weekend, tariff_sek_kwh, month_from, month_to")
        .eq("grid_company", hh.grid_company);
      tariffs = (t ?? []) as Tariff[];
    }
    function lookupTariff(iso: string, hourOfDay: number): number {
      if (tariffs.length === 0) return DEFAULT_GRID_TARIFF;
      const d = new Date(iso);
      const month = Number(new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", month: "numeric" }).format(d));
      const dow = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Stockholm", weekday: "short" }).format(d);
      const isWeekend = dow === "Sat" || dow === "Sun";
      const match = tariffs.find(r =>
        r.hour_of_day === hourOfDay &&
        r.is_weekend === isWeekend &&
        (r.month_from == null || r.month_to == null || (month >= r.month_from && month <= r.month_to))
      );
      return match ? Number(match.tariff_sek_kwh) : DEFAULT_GRID_TARIFF;
    }

    // 3c. Peak tariff (SEK/kW/month) for this grid company
    let peakTariffPerKw = DEFAULT_PEAK_TARIFF;
    let hasPeakTariff = true;
    let peakTariffMissing = false;
    const warnings: Record<string, string> = {};
    if (hh.grid_company) {
      const { data: gcs } = await supabase
        .from("grid_company_settings")
        .select("peak_tariff_sek_per_kw, has_peak_tariff")
        .eq("grid_company", hh.grid_company).maybeSingle();
      if (gcs) {
        peakTariffPerKw = Number(gcs.peak_tariff_sek_per_kw) || DEFAULT_PEAK_TARIFF;
        hasPeakTariff = gcs.has_peak_tariff !== false;
      } else {
        peakTariffMissing = true;
        warnings.grid_tariff_warning = `${hh.grid_company} ej funnen i grid_company_settings — standardvärde ${DEFAULT_PEAK_TARIFF} SEK/kW används`;
        console.warn(`[run-simulation] grid_company "${hh.grid_company}" not found, using default peak tariff`);
      }
    } else {
      peakTariffMissing = true;
      warnings.grid_tariff_warning = "Inget elnätsbolag valt — standardvärde 55 SEK/kW används";
    }

    const byDay = new Map<string, DayHour[]>();
    for (const row of prices as SpotPrice[]) {
      const day = stockholmDay(row.hour);
      const hod = stockholmHour(row.hour);
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day)!.push({
        iso: row.hour,
        hourOfDay: hod,
        price: Number(row.price_sek_kwh),
        weight: weights[hod] ?? 1.0,
      });
    }

    // 5. Per-day optimization
    let totalKwhCharged = 0;
    let totalCostOptimized = 0;
    let totalCostBaseline = 0;
    let totalCostWithTariff = 0;
    let totalCostBaselineWithTariff = 0;
    let totalV2hKwh = 0;
    let totalV2hSavingSek = 0;
    let peakHoursAvoided = 0;
    let peakDemandSavingSek = 0;
    let peaksAvoidedCount = 0;
    let decisionsLogged = 0;
    let soc = startingSoc;

    const logsBatch: Array<Record<string, unknown>> = [];
    const eventsBatch: Array<Record<string, unknown>> = [];
    const sortedDays = Array.from(byDay.keys()).sort();

    const leaveTime = Number(hh.leave_time ?? 7);
    const returnTime = Number(hh.return_time ?? 17);

    let prevDecision: string | null = null;
    let prevPriceCheap = false;
    let prevPriceExpensive = false;
    const cableDaysSeen = new Set<string>();

    // monthly peak tracking (smart_v2x)
    const monthlyPeak = new Map<string, number>(); // YYYY-MM → kW

    function pushEvent(e: Record<string, unknown>) {
      eventsBatch.push({ simulation_id, household_id: sim.household_id, ...e });
    }

    for (const day of sortedDays) {
      const dayHours = byDay.get(day)!;
      if (dayHours.length === 0) continue;
      const monthKey = day.slice(0, 7); // YYYY-MM

      const maxPrice = Math.max(...dayHours.map(h => h.price));
      const maxWeight = Math.max(...dayHours.map(h => h.weight));

      const scored = dayHours.map((h, idx) => {
        const priceScore = maxPrice > 0 ? 1 - (h.price / maxPrice) : 1;
        const consScore = maxWeight > 0 ? 1 - (h.weight / maxWeight) : 1;
        const combined = priceScore * 0.7 + consScore * 0.3;
        return { ...h, idx, combined };
      });

      const isConnectedHour = (hod: number) => {
        if (returnTime === leaveTime) return true;
        if (returnTime < leaveTime) return hod >= returnTime && hod < leaveTime;
        return hod >= returnTime || hod < leaveTime;
      };

      // Pick top N candidates by combined score, restricted to connected hours.
      const ranked = [...scored]
        .filter(h => isConnectedHour(h.hourOfDay))
        .sort((a, b) => b.combined - a.combined);

      // smart_charge_basic: 8 cheapest connected hours by spot price only
      const cheapest = [...scored]
        .filter(h => isConnectedHour(h.hourOfDay))
        .sort((a, b) => a.price - b.price);
      const basicPicks = new Set<number>(cheapest.slice(0, TARGET_CHARGE_HOURS).map(r => r.idx));
      const smartPicks = new Set<number>(ranked.slice(0, TARGET_CHARGE_HOURS).map(r => r.idx));
      const pickedCharge = mode === "smart_charge_basic" ? basicPicks : smartPicks;

      const baselineConnectedHours = [...scored]
        .filter(h => isConnectedHour(h.hourOfDay))
        .sort((a, b) => a.iso.localeCompare(b.iso));

      let dayKwhCharged = 0;
      let dayChargeCost = 0;
      let dayChargeCostWithTariff = 0;

      // V2H allowed for smart_charge (legacy peak window) and smart_v2x (smart logic)
      const v2hAllowed = mode !== "smart_charge_basic" && ccs2Port;

      for (const h of scored) {
        const hourConsKw = avgHouseKw * (h.weight / (sumWeights / 24));
        const gridTariffSek = lookupTariff(h.iso, h.hourOfDay);
        const totalCostPerKwh = (h.price + gridTariffSek + ENERGY_TAX_SEK) * VAT_MULTIPLIER;
        let decision: "charge" | "pause" | "v2h" | "emergency_charge" = "pause";
        let reason = "no_action";
        let chargeKw = 0;
        let v2hSaving = 0;
        let gridDrawKw = hourConsKw;
        const connected = isConnectedHour(h.hourOfDay);

        // Fuse-aware available charging headroom
        const fuseAvailableKw = Math.max(0, fuseMaxKw - hourConsKw);
        const effectiveChargeKw = Math.min(chargeMaxKw, fuseAvailableKw);

        // Battery-health caps (smart_v2x only)
        const upperSocCap = mode === "smart_v2x" ? SOC_PREFERRED_MAX : SOC_PROTECT;
        const v2hSocFloor = mode === "smart_v2x" ? SOC_V2H_FLOOR : Math.max(minSoc, 35);

        // Smart V2H decision: scale power by spot price
        // Tröskel beror på prisområde (SE1 har lägre snittpriser än SE3/SE4)
        const v2hMinPrice = V2H_THRESHOLDS[priceArea] ?? V2H_THRESHOLDS.SE3;
        const smartV2hKw = (() => {
          if (h.price <= v2hMinPrice) return 0;
          // Skala effekt linjärt från låg → hög utöver tröskeln
          const over = h.price - v2hMinPrice;
          if (over > 1.2) return v2hMaxKw;                    // full uteffekt
          if (over > 0.7) return Math.min(9, v2hMaxKw);
          if (over > 0.3) return Math.min(7, v2hMaxKw);
          return Math.min(5, v2hMaxKw);
        })();

        if (!connected) {
          decision = "pause";
          reason = "cable_disconnected";
        } else if (fuseAvailableKw <= 0.1) {
          decision = "pause";
          reason = "fuse_full";
        } else if (soc < minSoc) {
          decision = "emergency_charge";
          chargeKw = effectiveChargeKw;
          reason = "soc_below_min_emergency";
        } else if (soc > upperSocCap) {
          decision = "pause";
          reason = mode === "smart_v2x"
            ? "battery_health_stop_at_80"
            : "soc_above_protect";
        } else if (h.price < TOO_CHEAP_PRICE) {
          decision = "charge";
          chargeKw = effectiveChargeKw;
          reason = "too_cheap_to_ignore";
        } else if (h.price > priceThreshold) {
          decision = "pause";
          reason = `spot_above_${priceThreshold}sek_blocked`;
          if (pickedCharge.has(h.idx)) peakHoursAvoided++;
        }
        // V2H — smart_v2x: scaled by price; smart_charge: legacy fixed window
        else if (
          v2hAllowed && mode === "smart_v2x" &&
          smartV2hKw > 0 &&
          soc > Math.max(35, v2hSocFloor) &&
          h.hourOfDay >= 7 && h.hourOfDay < 22 &&
          hourConsKw > 0.5
        ) {
          const dischargeKw = Math.min(smartV2hKw, hourConsKw, v2hMaxKw);
          decision = "v2h";
          chargeKw = -dischargeKw;
          v2hSaving = dischargeKw * totalCostPerKwh; // saved at full retail cost (incl tariff+tax+VAT)
          gridDrawKw = Math.max(0, hourConsKw - dischargeKw);
          reason = "smart_v2h_price_scaled";
          totalV2hKwh += dischargeKw;
          totalV2hSavingSek += v2hSaving;
        } else if (
          v2hAllowed && mode === "smart_charge" &&
          PEAK_HOURS.has(h.hourOfDay) &&
          h.price > 1.0 &&
          soc > 40
        ) {
          const dischargeKw = Math.min(7, v2hMaxKw, hourConsKw + 7);
          decision = "v2h";
          chargeKw = -dischargeKw;
          v2hSaving = dischargeKw * h.price;
          gridDrawKw = Math.max(0, hourConsKw - dischargeKw);
          reason = "peak_price_v2h";
          totalV2hKwh += dischargeKw;
          totalV2hSavingSek += v2hSaving;
        }
        // Combined-score / cheapest selection
        else if (pickedCharge.has(h.idx)) {
          // Effekttariff guardrail (smart_v2x only)
          if (mode === "smart_v2x" && hasPeakTariff) {
            const projectedGridKw = hourConsKw + effectiveChargeKw;
            const currentMonthlyPeak = monthlyPeak.get(monthKey) ?? 0;
            if (projectedGridKw > currentMonthlyPeak) {
              const extraPeakKw = projectedGridKw - currentMonthlyPeak;
              const extraMonthlyCost = extraPeakKw * peakTariffPerKw;
              // What we save by charging this hour vs not: roughly (priceThreshold - h.price) * kWh
              const priceSaving = Math.max(0, (priceThreshold - h.price) * effectiveChargeKw);
              if (extraMonthlyCost > priceSaving) {
                decision = "pause";
                reason = peakTariffMissing
                  ? "peak_tariff_avoided | Effekttariff: standardvärde använt (bolag ej registrerat)"
                  : "peak_tariff_avoided";
                peaksAvoidedCount++;
                peakDemandSavingSek += extraMonthlyCost - priceSaving;
                pushEvent({
                  occurred_at: h.iso,
                  event_type: "peak_demand_avoided",
                  value_kw: extraPeakKw,
                  value_sek_impact: round2(extraMonthlyCost - priceSaving),
                  reason: `Effekttariff: undvek ny topp +${extraPeakKw.toFixed(1)} kW`,
                });
              } else {
                decision = "charge";
                chargeKw = effectiveChargeKw;
                reason = "best_combined_score";
                monthlyPeak.set(monthKey, projectedGridKw);
              }
            } else {
              decision = "charge";
              chargeKw = effectiveChargeKw;
              reason = "best_combined_score";
            }
          } else {
            decision = "charge";
            chargeKw = effectiveChargeKw;
            reason = mode === "smart_charge_basic" ? "cheapest_8_hours" : "best_combined_score";
          }
        } else {
          decision = "pause";
          reason = h.weight >= maxWeight * 0.8 ? "house_peak_consumption" : "lower_score";
          if (PEAK_HOURS.has(h.hourOfDay)) peakHoursAvoided++;
        }

        // Apply state changes with DC efficiency
        if (decision === "charge" || decision === "emergency_charge") {
          const kwhDrawn = chargeKw; // from grid in 1h
          const kwhStored = kwhDrawn * DC_EFFICIENCY;
          soc = Math.min(100, soc + (kwhStored / batteryKwh) * 100);
          dayKwhCharged += kwhStored;
          dayChargeCost += kwhDrawn * h.price;
          dayChargeCostWithTariff += kwhDrawn * totalCostPerKwh;
          gridDrawKw = chargeKw + hourConsKw;
          if (mode === "smart_v2x" && hasPeakTariff) {
            const cur = monthlyPeak.get(monthKey) ?? 0;
            if (gridDrawKw > cur) monthlyPeak.set(monthKey, gridDrawKw);
          }
        } else if (decision === "v2h") {
          const dischargeKw = Math.abs(chargeKw);
          const kwhFromBattery = dischargeKw / DC_EFFICIENCY; // need more from battery to deliver kWh
          soc = Math.max(0, soc - (kwhFromBattery / batteryKwh) * 100);
        } else {
          const drivePerHour = dailyKwhNeeded / 24;
          soc = Math.max(0, soc - (drivePerHour / batteryKwh) * 100);
          if (mode === "smart_v2x" && hasPeakTariff) {
            const cur = monthlyPeak.get(monthKey) ?? 0;
            if (gridDrawKw > cur) monthlyPeak.set(monthKey, gridDrawKw);
          }
        }

        logsBatch.push({
          simulation_id,
          household_id: sim.household_id,
          logged_at: h.iso,
          decision,
          spot_price_sek: h.price,
          soc_pct: Number(soc.toFixed(2)),
          reason,
          charge_kw: Number(chargeKw.toFixed(2)),
          house_consumption_kw: Number(hourConsKw.toFixed(3)),
          grid_draw_kw: Number(gridDrawKw.toFixed(3)),
          v2h_saving_sek: Number(v2hSaving.toFixed(4)),
          combined_score: Number(h.combined.toFixed(4)),
          grid_tariff_sek: Number(gridTariffSek.toFixed(4)),
          energy_tax_sek: ENERGY_TAX_SEK,
          total_cost_per_kwh: Number(totalCostPerKwh.toFixed(4)),
        });
        decisionsLogged++;

        // ---- Event detection ----
        const socNow = Number(soc.toFixed(2));
        if (h.hourOfDay === leaveTime && !cableDaysSeen.has(`${day}-leave`)) {
          cableDaysSeen.add(`${day}-leave`);
          pushEvent({ occurred_at: h.iso, event_type: "cable_disconnected", value_soc_pct: socNow, reason: "Kunden lämnade hemmet" });
        }
        if (h.hourOfDay === returnTime && !cableDaysSeen.has(`${day}-return`)) {
          cableDaysSeen.add(`${day}-return`);
          pushEvent({ occurred_at: h.iso, event_type: "cable_connected", value_soc_pct: socNow, reason: "Kunden kom hem" });
        }
        const isCheap = h.price < TOO_CHEAP_PRICE;
        const isExpensive = h.price > priceThreshold;
        if (isCheap && !prevPriceCheap) {
          pushEvent({ occurred_at: h.iso, event_type: "cheap_price_detected", value_price_sek: h.price, reason: `Extremt lågt pris: ${h.price.toFixed(3)} SEK/kWh` });
        }
        if (isExpensive && !prevPriceExpensive) {
          pushEvent({ occurred_at: h.iso, event_type: "expensive_price_detected", value_price_sek: h.price, reason: `Högt pris: ${h.price.toFixed(3)} SEK/kWh` });
        }
        prevPriceCheap = isCheap;
        prevPriceExpensive = isExpensive;

        if (prevDecision !== decision) {
          if (decision === "emergency_charge") {
            pushEvent({ occurred_at: h.iso, event_type: "emergency_charge_started", value_kw: chargeKw, value_soc_pct: socNow, value_price_sek: h.price, reason: `SoC kritiskt låg: ${socNow}%` });
          } else if (prevDecision !== "charge" && decision === "charge") {
            pushEvent({ occurred_at: h.iso, event_type: "charging_started", value_kw: chargeKw, value_soc_pct: socNow, value_price_sek: h.price, reason: `Spotpris ${h.price.toFixed(3)} SEK/kWh` });
          } else if ((prevDecision === "charge" || prevDecision === "emergency_charge") && decision === "pause") {
            let stopReason = "Schema: topptimme undviken";
            if (h.price > priceThreshold) stopReason = `Spotpris för högt: ${h.price.toFixed(3)} SEK/kWh`;
            else if (soc > upperSocCap) stopReason = mode === "smart_v2x" ? `Batterihälsa: stannar vid ${SOC_PREFERRED_MAX}%` : `Batteri fullt: ${socNow}%`;
            else if (reason === "fuse_full") stopReason = "Huvudsäkring full";
            else if (reason === "peak_tariff_avoided") stopReason = "Effekttariff: undvek ny topp";
            pushEvent({ occurred_at: h.iso, event_type: "charging_stopped", value_kw: 0, value_soc_pct: socNow, value_price_sek: h.price, reason: stopReason });
          } else if (prevDecision !== "v2h" && decision === "v2h") {
            pushEvent({ occurred_at: h.iso, event_type: "v2h_started", value_kw: chargeKw, value_soc_pct: socNow, value_price_sek: h.price, value_sek_impact: Number((Math.abs(chargeKw) * h.price).toFixed(2)), reason: `Topptimme ${h.hourOfDay}:00 — V2H aktiverad` });
          } else if (prevDecision === "v2h" && decision !== "v2h") {
            const stopReason = soc <= v2hSocFloor + 1 ? `Batterihälsa: V2H stoppad vid ${SOC_V2H_FLOOR}%` : "Topptimme avslutad";
            pushEvent({ occurred_at: h.iso, event_type: "v2h_stopped", value_soc_pct: socNow, reason: stopReason });
          }
          prevDecision = decision;
        }
      }

      // MINIMUM DAILY CHARGE GUARANTEE
      const minKwhNeeded = (dailyKm / KM_PER_KWH_BASELINE);
      if (dayKwhCharged < minKwhNeeded) {
        const remainingKwh = minKwhNeeded - dayKwhCharged;
        const hoursToForce = Math.ceil(remainingKwh / (chargeMaxKw * DC_EFFICIENCY));
        const alreadyChargedIsos = new Set(
          logsBatch
            .filter(l => l.logged_at && (l.decision === "charge" || l.decision === "emergency_charge" || l.decision === "v2h"))
            .map(l => l.logged_at as string),
        );
        const upperCap = mode === "smart_v2x" ? SOC_HEALTH_MAX : SOC_PROTECT;
        const candidates = scored
          .filter(h => isConnectedHour(h.hourOfDay) && !alreadyChargedIsos.has(h.iso) && soc < upperCap)
          .sort((a, b) => a.price - b.price)
          .slice(0, hoursToForce);

        for (const h of candidates) {
          if (dayKwhCharged >= minKwhNeeded) break;
          if (soc >= upperCap) break;
          const hourConsKw = avgHouseKw * (h.weight / (sumWeights / 24));
          const fuseAvailableKw = Math.max(0, fuseMaxKw - hourConsKw);
          const kwDrawn = Math.min(chargeMaxKw, fuseAvailableKw);
          if (kwDrawn <= 0) continue;
          const kwhStored = kwDrawn * DC_EFFICIENCY;
          const gridTariffSek = lookupTariff(h.iso, h.hourOfDay);
          const totalCostPerKwh = (h.price + gridTariffSek + ENERGY_TAX_SEK) * VAT_MULTIPLIER;
          soc = Math.min(100, soc + (kwhStored / batteryKwh) * 100);
          dayKwhCharged += kwhStored;
          dayChargeCost += kwDrawn * h.price;
          dayChargeCostWithTariff += kwDrawn * totalCostPerKwh;

          const idx = logsBatch.findIndex(l => l.logged_at === h.iso && l.simulation_id === simulation_id);
          if (idx >= 0) {
            logsBatch[idx] = {
              ...logsBatch[idx],
              decision: "charge",
              reason: "minimum_dagsladdning",
              charge_kw: Number(kwDrawn.toFixed(2)),
              soc_pct: Number(soc.toFixed(2)),
              grid_draw_kw: Number((kwDrawn + Number(logsBatch[idx].house_consumption_kw ?? 0)).toFixed(3)),
            };
          }
        }
      }

      totalKwhCharged += dayKwhCharged;
      totalCostOptimized += dayChargeCost;
      totalCostWithTariff += dayChargeCostWithTariff;

      // TRULY DUMB BASELINE — charge every connected hour at spot price (with same tariff/tax)
      // until full. This is "plug in and pull power", guaranteeing baseline ≥ optimized cost.
      let baselineSoc = startingSoc;
      baselineSoc = Math.max(0, baselineSoc - (dailyKwhNeeded / batteryKwh) * 100);
      for (const h of baselineConnectedHours) {
        if (baselineSoc >= 100) break;
        const headroomKwh = ((100 - baselineSoc) / 100) * batteryKwh;
        const hourConsKw = avgHouseKw * (h.weight / (sumWeights / 24));
        const fuseAvailableKw = Math.max(0, fuseMaxKw - hourConsKw);
        const kwDrawn = Math.min(chargeMaxKw, fuseAvailableKw, headroomKwh / DC_EFFICIENCY);
        if (kwDrawn <= 0) continue;
        const kwhStored = kwDrawn * DC_EFFICIENCY;
        const tariff = lookupTariff(h.iso, h.hourOfDay);
        totalCostBaseline += kwDrawn * h.price;
        totalCostBaselineWithTariff += kwDrawn * (h.price + tariff + ENERGY_TAX_SEK) * VAT_MULTIPLIER;
        baselineSoc = Math.min(100, baselineSoc + (kwhStored / batteryKwh) * 100);
      }
    }

    // Per-simulation log lifecycle
    await supabase.from("optimization_logs").delete().eq("simulation_id", simulation_id);

    let logsInserted = 0;
    for (let i = 0; i < logsBatch.length; i += 500) {
      const chunk = logsBatch.slice(i, i + 500);
      const { error: lErr, count } = await supabase
        .from("optimization_logs")
        .insert(chunk, { count: "exact" });
      if (lErr) console.error("log insert error", lErr.message);
      else logsInserted += count ?? chunk.length;
    }

    const { count: verifyCount } = await supabase
      .from("optimization_logs")
      .select("id", { count: "exact", head: true })
      .eq("simulation_id", simulation_id);
    if ((verifyCount ?? 0) === 0 && logsBatch.length > 0) {
      console.error(`❌ logs verify failed sim=${simulation_id}`);
    } else {
      console.log(`✓ logs sim=${simulation_id} rows=${verifyCount} mode=${mode}`);
    }

    if ((sim.scenario_number ?? 1) === 1) {
      await supabase.from("simulation_events").delete().eq("simulation_id", simulation_id);
    }
    for (let i = 0; i < eventsBatch.length; i += 500) {
      const chunk = eventsBatch.slice(i, i + 500);
      const { error: eErr } = await supabase.from("simulation_events").insert(chunk);
      if (eErr) console.error("event insert error", eErr.message);
    }

    const priceSavings = Math.max(0, totalCostBaseline - totalCostOptimized);
    const totalSaved = priceSavings + totalV2hSavingSek + peakDemandSavingSek;
    const savingsIncludingTariff = Math.max(0, totalCostBaselineWithTariff - totalCostWithTariff)
      + totalV2hSavingSek
      + peakDemandSavingSek;
    const avgPricePaid = totalKwhCharged > 0 ? totalCostOptimized / totalKwhCharged : 0;

    await supabase.from("simulation_runs").update({
      status: "completed",
      total_saved_sek: round2(totalSaved),
      price_savings_sek: round2(priceSavings),
      total_v2h_kwh: round2(totalV2hKwh),
      total_v2h_saving_sek: round2(totalV2hSavingSek),
      peak_hours_avoided: peakHoursAvoided,
      peak_demand_saving_sek: round2(peakDemandSavingSek),
      peaks_avoided_count: peaksAvoidedCount,
      avg_price_paid: Number(avgPricePaid.toFixed(4)),
      total_cost_with_tariff: round2(totalCostWithTariff),
      total_saved_including_tariff: round2(savingsIncludingTariff),
      total_events: eventsBatch.length,
      warnings: Object.keys(warnings).length > 0 ? warnings : null,
      ended_at: new Date().toISOString(),
    }).eq("id", simulation_id);

    return json({
      mode,
      ccs2_port: ccs2Port,
      days_processed: sortedDays.length,
      total_kwh_charged: round2(totalKwhCharged),
      total_saved_sek: round2(totalSaved),
      price_savings_sek: round2(priceSavings),
      total_v2h_kwh: round2(totalV2hKwh),
      total_v2h_saving_sek: round2(totalV2hSavingSek),
      peak_hours_avoided: peakHoursAvoided,
      peak_demand_saving_sek: round2(peakDemandSavingSek),
      peaks_avoided_count: peaksAvoidedCount,
      avg_price_paid: Number(avgPricePaid.toFixed(4)),
      total_cost_with_tariff: round2(totalCostWithTariff),
      total_saved_including_tariff: round2(savingsIncludingTariff),
      decisions_logged: decisionsLogged,
      events_logged: eventsBatch.length,
    }, 200);
  } catch (err) {
    console.error("run-simulation error", err);
    return json({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
async function failSim(supabase: any, id: string, msg: string, status: number) {
  await supabase.from("simulation_runs").update({ status: "failed", ended_at: new Date().toISOString() }).eq("id", id);
  return json({ error: msg }, status);
}
function round2(n: number) { return Number(n.toFixed(2)); }
function num(v: unknown, d: number) { const n = Number(v); return Number.isFinite(n) ? n : d; }
function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }
function stockholmDay(iso: string): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(iso));
}
function stockholmHour(iso: string): number {
  const s = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm", hour: "2-digit", hour12: false,
  }).format(new Date(iso));
  return parseInt(s, 10);
}
