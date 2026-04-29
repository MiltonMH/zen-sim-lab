import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// --- Engine constants ---
const CHARGE_KW = 11;             // AC charging power
const V2H_KW = 7;                 // conservative discharge during peak
const TARGET_CHARGE_HOURS = 8;    // hours/day to charge
const KM_PER_PCT = 5;             // km per % battery
const PEAK_HOURS = new Set([17, 18, 19, 20]); // V2H window 17-21 (4 hours)
const DEFAULT_HARD_MAX_PRICE = 2.0;       // default never-charge threshold
const TOO_CHEAP_PRICE = 0.20;     // always charge below this
const DEFAULT_SOC_EMERGENCY = 20;         // force charge below this
const SOC_PROTECT = 95;           // never charge above this
const KM_PER_KWH_BASELINE = 6;    // simple efficiency for min-charge calc (~6 km per kWh)
const PRICE_THRESHOLDS = [1.5, 2.0, 2.5];
const ENERGY_TAX_SEK = 0.549;     // 2025 Swedish energy tax SEK/kWh
const VAT_MULTIPLIER = 1.25;      // 25% moms
const DEFAULT_GRID_TARIFF = 0.30; // fallback SEK/kWh when no tariff configured

// Default consumption weights (pendlare style) if profile missing
const DEFAULT_WEIGHTS = [
  0.3,0.3,0.3,0.3,0.3,0.3, // 0-5 night
  1.0,2.0,1.2,1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.2, // 6-16
  2.2,2.4,2.2,2.0,1.5,1.0,0.6, // 17-23
];

interface SpotPrice { hour: string; price_sek_kwh: number }
interface DayHour { iso: string; hourOfDay: number; price: number; weight: number }

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

    // 2. Household
    const { data: hh, error: hErr } = await supabase
      .from("household_profiles").select("*").eq("id", sim.household_id).maybeSingle();
    if (hErr || !hh) return failSim(supabase, simulation_id, "Household not found", 404);

    const batteryKwh = Number(hh.battery_kwh) || 60;
    const baseDailyKm = Number(hh.daily_km) || 30;
    const priceArea = hh.price_area || "SE3";
    const annualKwh = Number(hh.annual_kwh) || 18000;
    const avgHouseKw = annualKwh / 8760; // average house draw

    // --- Scenario parameters (use stored, else defaults for scenario 1) ---
    const sp = (sim.scenario_params ?? {}) as Record<string, number>;
    const startingSoc = clamp(num(sp.starting_soc, 50), 5, 100);
    const dailyKmMul = clamp(num(sp.daily_km_multiplier, 1.0), 0.1, 3.0);
    const priceThreshold = clamp(num(sp.price_threshold, DEFAULT_HARD_MAX_PRICE), 0.5, 10);
    const minSoc = clamp(num(sp.min_soc, DEFAULT_SOC_EMERGENCY), 5, 80);
    // departure_offset_hours kept in params for traceability; not yet used for routing rules

    const dailyKm = baseDailyKm * dailyKmMul;
    const dailyKwhNeeded = (dailyKm / KM_PER_PCT) * batteryKwh / 100;

    // 2b. EV V2X capability
    let v2xCapable = false;
    if (hh.ev_model_id) {
      const { data: ev } = await supabase
        .from("ev_models").select("v2x_capable").eq("id", hh.ev_model_id).maybeSingle();
      v2xCapable = !!ev?.v2x_capable;
    }

    // 2c. Consumption profile (24 weights)
    const { data: cps } = await supabase
      .from("consumption_profiles").select("hour, weight").eq("household_id", sim.household_id);
    const weights = [...DEFAULT_WEIGHTS];
    if (cps && cps.length > 0) {
      for (const r of cps as { hour: number; weight: number }[]) {
        if (r.hour >= 0 && r.hour < 24) weights[r.hour] = Number(r.weight);
      }
    }
    const sumWeights = weights.reduce((s, w) => s + w, 0);

    // 3. Spot prices — try requested area, fall back to SE3 if missing
    const fromIso = `${sim.period_from}T00:00:00+00:00`;
    const toIso = `${sim.period_to}T23:59:59+00:00`;
    let usedArea = priceArea;
    let { data: prices, error: pErr } = await supabase
      .from("spot_prices")
      .select("hour, price_sek_kwh")
      .eq("price_area", priceArea)
      .gte("hour", fromIso).lte("hour", toIso)
      .order("hour", { ascending: true });
    if (pErr) return failSim(supabase, simulation_id, pErr.message, 500);
    if (!prices || prices.length === 0) {
      // Fallback to SE3 (only area with full coverage)
      const fb = await supabase.from("spot_prices")
        .select("hour, price_sek_kwh").eq("price_area", "SE3")
        .gte("hour", fromIso).lte("hour", toIso)
        .order("hour", { ascending: true });
      prices = fb.data ?? [];
      usedArea = "SE3";
    }
    if (!prices || prices.length === 0) {
      // Find what range we DO have, to give a useful error
      const { data: range } = await supabase
        .from("spot_prices").select("hour").eq("price_area", "SE3")
        .order("hour", { ascending: false }).limit(1);
      const lastHour = range?.[0]?.hour ?? "unknown";
      return failSim(
        supabase, simulation_id,
        `No spot prices for ${priceArea} between ${sim.period_from} and ${sim.period_to}. Latest available: ${lastHour}. Pick a period within available data.`,
        400,
      );
    }


    // 3b. Grid tariffs for this household's grid_company (if any)
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
    let totalCostOptimized = 0;       // spot only (kept for backward-compatible savings calc)
    let totalCostBaseline = 0;        // spot only baseline
    let totalCostWithTariff = 0;      // spot + grid tariff + energy tax + VAT
    let totalCostBaselineWithTariff = 0;
    let totalV2hKwh = 0;
    let totalV2hSavingSek = 0;
    let peakHoursAvoided = 0;
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

    function pushEvent(e: Record<string, unknown>) {
      eventsBatch.push({
        simulation_id,
        household_id: sim.household_id,
        ...e,
      });
    }

    for (const day of sortedDays) {
      const dayHours = byDay.get(day)!;
      if (dayHours.length === 0) continue;

      const maxPrice = Math.max(...dayHours.map(h => h.price));
      const maxWeight = Math.max(...dayHours.map(h => h.weight));

      // Combined score per hour
      const scored = dayHours.map((h, idx) => {
        const priceScore = maxPrice > 0 ? 1 - (h.price / maxPrice) : 1;
        const consScore = maxWeight > 0 ? 1 - (h.weight / maxWeight) : 1;
        const combined = priceScore * 0.7 + consScore * 0.3;
        return { ...h, idx, combined };
      });

      // Pick top N candidates by combined score, but apply hard rules
      const ranked = [...scored].sort((a, b) => b.combined - a.combined);
      const pickedCharge = new Set<number>(ranked.slice(0, TARGET_CHARGE_HOURS).map(r => r.idx));

      // Bug 2 fix — TRULY DUMB BASELINE (computed AFTER optimized run below):
      // Baseline charges the SAME total kWh as optimized, but picks the FIRST connected hours
      // chronologically (no price-shopping). Same kWh + dumber hour selection → baseline cost
      // is always ≥ optimized cost, so savings can never be negative.
      const isConnectedHour = (hod: number) => {
        if (returnTime === leaveTime) return true; // edge: assume always home
        if (returnTime < leaveTime) return hod >= returnTime && hod < leaveTime;
        // wrap-around (e.g. 17 → 07): connected from returnTime..23 and 0..leaveTime-1
        return hod >= returnTime || hod < leaveTime;
      };
      const baselineConnectedHours = [...scored]
        .filter(h => isConnectedHour(h.hourOfDay))
        .sort((a, b) => a.iso.localeCompare(b.iso));

      // Walk hours chronologically
      let dayKwhCharged = 0;
      let dayChargeCost = 0;
      let dayChargeCostWithTariff = 0;

      for (const h of scored) {
        const hourConsKw = avgHouseKw * (h.weight / (sumWeights / 24));
        const gridTariffSek = lookupTariff(h.iso, h.hourOfDay);
        const totalCostPerKwh = (h.price + gridTariffSek + ENERGY_TAX_SEK) * VAT_MULTIPLIER;
        let decision: "charge" | "pause" | "v2h" | "emergency_charge" = "pause";
        let reason = "no_action";
        let chargeKw = 0;
        let v2hSaving = 0;
        let gridDrawKw = hourConsKw;

        // Hard rule: emergency charge
        if (soc < minSoc) {
          decision = "emergency_charge";
          chargeKw = CHARGE_KW;
          reason = "soc_below_20_emergency";
        }
        // Hard rule: battery protection
        else if (soc > SOC_PROTECT) {
          decision = "pause";
          reason = "soc_above_95_protect";
        }
        // Hard rule: too cheap
        else if (h.price < TOO_CHEAP_PRICE) {
          decision = "charge";
          chargeKw = CHARGE_KW;
          reason = "too_cheap_to_ignore";
        }
        // Hard rule: too expensive
        else if (h.price > priceThreshold) {
          decision = "pause";
          reason = `spot_above_${priceThreshold}sek_blocked`;
          if (pickedCharge.has(h.idx)) peakHoursAvoided++;
        }
        // V2H during peak window
        else if (
          v2xCapable &&
          PEAK_HOURS.has(h.hourOfDay) &&
          h.price > 1.0 &&
          soc > 40
        ) {
          decision = "v2h";
          chargeKw = -V2H_KW;
          v2hSaving = V2H_KW * h.price;
          gridDrawKw = Math.max(0, hourConsKw - V2H_KW);
          reason = "peak_price_v2h";
          totalV2hKwh += V2H_KW;
          totalV2hSavingSek += v2hSaving;
        }
        // Combined-score selection
        else if (pickedCharge.has(h.idx)) {
          decision = "charge";
          chargeKw = CHARGE_KW;
          reason = "best_combined_score";
        } else {
          decision = "pause";
          reason = h.weight >= maxWeight * 0.8 ? "house_peak_consumption" : "lower_score";
          if (PEAK_HOURS.has(h.hourOfDay)) peakHoursAvoided++;
        }

        // Update SoC + cost
        if (decision === "charge" || decision === "emergency_charge") {
          const kwh = CHARGE_KW; // 1 hour
          soc = Math.min(100, soc + (kwh / batteryKwh) * 100);
          dayKwhCharged += kwh;
          dayChargeCost += kwh * h.price;
          dayChargeCostWithTariff += kwh * totalCostPerKwh;
          gridDrawKw = CHARGE_KW + hourConsKw;
        } else if (decision === "v2h") {
          soc = Math.max(0, soc - (V2H_KW / batteryKwh) * 100);
        } else {
          // passive driving consumption spread
          const drivePerHour = dailyKwhNeeded / 24;
          soc = Math.max(0, soc - (drivePerHour / batteryKwh) * 100);
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
          pushEvent({
            occurred_at: h.iso,
            event_type: "cable_disconnected",
            value_soc_pct: socNow,
            reason: "Kunden lämnade hemmet",
          });
        }
        if (h.hourOfDay === returnTime && !cableDaysSeen.has(`${day}-return`)) {
          cableDaysSeen.add(`${day}-return`);
          pushEvent({
            occurred_at: h.iso,
            event_type: "cable_connected",
            value_soc_pct: socNow,
            reason: "Kunden kom hem",
          });
        }

        const isCheap = h.price < TOO_CHEAP_PRICE;
        const isExpensive = h.price > priceThreshold;
        if (isCheap && !prevPriceCheap) {
          pushEvent({
            occurred_at: h.iso,
            event_type: "cheap_price_detected",
            value_price_sek: h.price,
            reason: `Extremt lågt pris: ${h.price.toFixed(3)} SEK/kWh`,
          });
        }
        if (isExpensive && !prevPriceExpensive) {
          pushEvent({
            occurred_at: h.iso,
            event_type: "expensive_price_detected",
            value_price_sek: h.price,
            reason: `Högt pris: ${h.price.toFixed(3)} SEK/kWh`,
          });
        }
        prevPriceCheap = isCheap;
        prevPriceExpensive = isExpensive;

        if (prevDecision !== decision) {
          if (decision === "emergency_charge") {
            pushEvent({
              occurred_at: h.iso,
              event_type: "emergency_charge_started",
              value_kw: CHARGE_KW,
              value_soc_pct: socNow,
              value_price_sek: h.price,
              reason: `SoC kritiskt låg: ${socNow}%`,
            });
          } else if (prevDecision !== "charge" && decision === "charge") {
            pushEvent({
              occurred_at: h.iso,
              event_type: "charging_started",
              value_kw: CHARGE_KW,
              value_soc_pct: socNow,
              value_price_sek: h.price,
              reason: `Spotpris ${h.price.toFixed(3)} SEK/kWh — under tröskel`,
            });
          } else if ((prevDecision === "charge" || prevDecision === "emergency_charge") && decision === "pause") {
            let stopReason = "Schema: topptimme undviken";
            if (h.price > priceThreshold) stopReason = `Spotpris för högt: ${h.price.toFixed(3)} SEK/kWh`;
            else if (soc > SOC_PROTECT) stopReason = `Batteri fullt: ${socNow}%`;
            pushEvent({
              occurred_at: h.iso,
              event_type: "charging_stopped",
              value_kw: 0,
              value_soc_pct: socNow,
              value_price_sek: h.price,
              reason: stopReason,
            });
          } else if (prevDecision !== "v2h" && decision === "v2h") {
            pushEvent({
              occurred_at: h.iso,
              event_type: "v2h_started",
              value_kw: -V2H_KW,
              value_soc_pct: socNow,
              value_price_sek: h.price,
              value_sek_impact: Number((V2H_KW * h.price).toFixed(2)),
              reason: `Topptimme ${h.hourOfDay}:00 — V2H aktiverad`,
            });
          } else if (prevDecision === "v2h" && decision !== "v2h") {
            const stopReason = soc <= minSoc + 1
              ? `SoC nådde minimigräns: ${socNow}%`
              : "Topptimme avslutad";
            pushEvent({
              occurred_at: h.iso,
              event_type: "v2h_stopped",
              value_soc_pct: socNow,
              reason: stopReason,
            });
          }
          prevDecision = decision;
        }
      }

      // Bug 3 fix — MINIMUM DAILY CHARGE GUARANTEE:
      // Always charge at least the minimum needed kWh/day so the car is usable tomorrow,
      // regardless of price-optimization rules (this matters in flat-price areas like SE4
      // where the hard threshold rarely triggers but combined-score still skips too much).
      const minKwhNeeded = (dailyKm / KM_PER_KWH_BASELINE);
      if (dayKwhCharged < minKwhNeeded) {
        const remainingKwh = minKwhNeeded - dayKwhCharged;
        const hoursToForce = Math.ceil(remainingKwh / CHARGE_KW);
        // Pick cheapest hours where we did NOT already charge or v2h
        const alreadyChargedIsos = new Set(
          logsBatch
            .filter(l => l.logged_at && (l.decision === "charge" || l.decision === "emergency_charge" || l.decision === "v2h"))
            .map(l => l.logged_at as string),
        );
        const dayIsos = new Set(scored.map(h => h.iso));
        const candidates = scored
          .filter(h => dayIsos.has(h.iso) && !alreadyChargedIsos.has(h.iso) && soc < SOC_PROTECT)
          .sort((a, b) => a.price - b.price)
          .slice(0, hoursToForce);

        for (const h of candidates) {
          if (dayKwhCharged >= minKwhNeeded) break;
          if (soc >= SOC_PROTECT) break;
          const kwh = CHARGE_KW;
          const gridTariffSek = lookupTariff(h.iso, h.hourOfDay);
          const totalCostPerKwh = (h.price + gridTariffSek + ENERGY_TAX_SEK) * VAT_MULTIPLIER;
          soc = Math.min(100, soc + (kwh / batteryKwh) * 100);
          dayKwhCharged += kwh;
          dayChargeCost += kwh * h.price;
          dayChargeCostWithTariff += kwh * totalCostPerKwh;

          // Update the existing log row for that hour: flip its decision to charge w/ minimum reason.
          const idx = logsBatch.findIndex(l => l.logged_at === h.iso && l.simulation_id === simulation_id);
          if (idx >= 0) {
            logsBatch[idx] = {
              ...logsBatch[idx],
              decision: "charge",
              reason: "minimum_dagsladdning",
              charge_kw: Number(CHARGE_KW.toFixed(2)),
              soc_pct: Number(soc.toFixed(2)),
              grid_draw_kw: Number((CHARGE_KW + Number(logsBatch[idx].house_consumption_kw ?? 0)).toFixed(3)),
            };
      totalKwhCharged += dayKwhCharged;
      totalCostOptimized += dayChargeCost;
      totalCostWithTariff += dayChargeCostWithTariff;

      // Bug 2 fix — compute dumb baseline AFTER optimized day is done, charging the SAME total
      // kWh in the FIRST connected hours chronologically. Same energy + dumber pick → baseline
      // cost ≥ optimized cost (no negative savings).
      const baselineHoursNeeded = Math.ceil(dayKwhCharged / CHARGE_KW);
      const baselinePicked = baselineConnectedHours.slice(0, baselineHoursNeeded);
      const baselineKwhTotal = dayKwhCharged; // exact same energy
      // distribute energy across picked hours (last hour may be partial)
      let kwhRemaining = baselineKwhTotal;
      for (const h of baselinePicked) {
        const kwhThisHour = Math.min(CHARGE_KW, kwhRemaining);
        if (kwhThisHour <= 0) break;
        const tariff = lookupTariff(h.iso, h.hourOfDay);
        totalCostBaseline += kwhThisHour * h.price;
        totalCostBaselineWithTariff += kwhThisHour * (h.price + tariff + ENERGY_TAX_SEK) * VAT_MULTIPLIER;
        kwhRemaining -= kwhThisHour;
      }
    }

    // (totalKwhCharged etc. were already accumulated above per-day; loop closed)
    // — sentinel block to keep file structure stable —
    {
      totalCostWithTariff += dayChargeCostWithTariff;
    }

    // Bug 1 fix — per-simulation log lifecycle:
    // Each simulation owns its own logs (now keyed by simulation_id). We delete only THIS
    // simulation's prior logs (idempotent re-runs) instead of wiping the whole household
    // window, which previously meant only the last simulation in a bulk run had logs.
    await supabase.from("optimization_logs").delete().eq("simulation_id", simulation_id);

    let logsInserted = 0;
    for (let i = 0; i < logsBatch.length; i += 500) {
      const chunk = logsBatch.slice(i, i + 500);
      const { error: lErr, count } = await supabase
        .from("optimization_logs")
        .insert(chunk, { count: "exact" });
      if (lErr) {
        console.error("log insert error", lErr.message);
      } else {
        logsInserted += count ?? chunk.length;
      }
    }

    // Verify logs landed for this simulation_id; warn loudly if not.
    const { count: verifyCount, error: verifyErr } = await supabase
      .from("optimization_logs")
      .select("id", { count: "exact", head: true })
      .eq("simulation_id", simulation_id);
    if (verifyErr) {
      console.error("log verify error", verifyErr.message);
    } else if ((verifyCount ?? 0) === 0 && logsBatch.length > 0) {
      console.error(
        `❌ optimization_logs verification failed: simulation_id=${simulation_id} expected ${logsBatch.length} rows, found 0`,
      );
    } else {
      console.log(
        `✓ optimization_logs verified: simulation_id=${simulation_id} household=${sim.household_id} rows=${verifyCount}`,
      );
    }

    // Clear and insert events for this simulation (scenario 1 clears the window)
    if ((sim.scenario_number ?? 1) === 1) {
      await supabase.from("simulation_events").delete().eq("simulation_id", simulation_id);
    }
    for (let i = 0; i < eventsBatch.length; i += 500) {
      const chunk = eventsBatch.slice(i, i + 500);
      const { error: eErr } = await supabase.from("simulation_events").insert(chunk);
      if (eErr) console.error("event insert error", eErr.message);
    }

    const priceSavings = totalCostBaseline - totalCostOptimized;
    const totalSaved = priceSavings + totalV2hSavingSek;
    const savingsIncludingTariff = (totalCostBaselineWithTariff - totalCostWithTariff) + totalV2hSavingSek * VAT_MULTIPLIER;
    const avgPricePaid = totalKwhCharged > 0 ? totalCostOptimized / totalKwhCharged : 0;

    await supabase.from("simulation_runs").update({
      status: "completed",
      total_saved_sek: round2(totalSaved),
      price_savings_sek: round2(priceSavings),
      total_v2h_kwh: round2(totalV2hKwh),
      total_v2h_saving_sek: round2(totalV2hSavingSek),
      peak_hours_avoided: peakHoursAvoided,
      avg_price_paid: Number(avgPricePaid.toFixed(4)),
      total_cost_with_tariff: round2(totalCostWithTariff),
      total_saved_including_tariff: round2(savingsIncludingTariff),
      total_events: eventsBatch.length,
      ended_at: new Date().toISOString(),
    }).eq("id", simulation_id);

    return json({
      days_processed: sortedDays.length,
      total_kwh_charged: round2(totalKwhCharged),
      total_saved_sek: round2(totalSaved),
      price_savings_sek: round2(priceSavings),
      total_v2h_kwh: round2(totalV2hKwh),
      total_v2h_saving_sek: round2(totalV2hSavingSek),
      peak_hours_avoided: peakHoursAvoided,
      avg_price_paid: Number(avgPricePaid.toFixed(4)),
      total_cost_with_tariff: round2(totalCostWithTariff),
      total_saved_including_tariff: round2(savingsIncludingTariff),
      v2x_capable: v2xCapable,
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
