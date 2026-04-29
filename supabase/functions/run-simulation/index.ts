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
const BASELINE_HOURS = [20, 21, 22, 23, 0, 1, 2, 3]; // unoptimized fixed window 20-04
const PRICE_THRESHOLDS = [1.5, 2.0, 2.5];

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

    // 4. Group by local day
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
    let totalV2hKwh = 0;
    let totalV2hSavingSek = 0;
    let peakHoursAvoided = 0;
    let decisionsLogged = 0;
    let soc = startingSoc;

    const logsBatch: Array<Record<string, unknown>> = [];
    const sortedDays = Array.from(byDay.keys()).sort();

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

      // Baseline: fixed-window charge regardless of price
      const baselineHours = scored.filter(h => BASELINE_HOURS.includes(h.hourOfDay));
      const baselineAvgPrice = baselineHours.length > 0
        ? baselineHours.reduce((s, h) => s + h.price, 0) / baselineHours.length
        : dayHours.reduce((s, h) => s + h.price, 0) / dayHours.length;
      const dayBaselineCost = dailyKwhNeeded * baselineAvgPrice;
      totalCostBaseline += dayBaselineCost;

      // Walk hours chronologically
      let dayKwhCharged = 0;
      let dayChargeCost = 0;

      for (const h of scored) {
        const hourConsKw = avgHouseKw * (h.weight / (sumWeights / 24));
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
          gridDrawKw = CHARGE_KW + hourConsKw;
        } else if (decision === "v2h") {
          soc = Math.max(0, soc - (V2H_KW / batteryKwh) * 100);
        } else {
          // passive driving consumption spread
          const drivePerHour = dailyKwhNeeded / 24;
          soc = Math.max(0, soc - (drivePerHour / batteryKwh) * 100);
        }

        logsBatch.push({
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
        });
        decisionsLogged++;
      }

      totalKwhCharged += dayKwhCharged;
      totalCostOptimized += dayChargeCost;
    }

    // Only the first scenario clears prior logs in the window;
    // subsequent scenarios append so the household's full distribution is visible.
    if ((sim.scenario_number ?? 1) === 1) {
      await supabase.from("optimization_logs").delete()
        .eq("household_id", sim.household_id)
        .gte("logged_at", fromIso).lte("logged_at", toIso);
    }

    for (let i = 0; i < logsBatch.length; i += 500) {
      const chunk = logsBatch.slice(i, i + 500);
      const { error: lErr } = await supabase.from("optimization_logs").insert(chunk);
      if (lErr) console.error("log insert error", lErr.message);
    }

    const priceSavings = totalCostBaseline - totalCostOptimized;
    const totalSaved = priceSavings + totalV2hSavingSek;
    const avgPricePaid = totalKwhCharged > 0 ? totalCostOptimized / totalKwhCharged : 0;

    await supabase.from("simulation_runs").update({
      status: "completed",
      total_saved_sek: round2(totalSaved),
      price_savings_sek: round2(priceSavings),
      total_v2h_kwh: round2(totalV2hKwh),
      total_v2h_saving_sek: round2(totalV2hSavingSek),
      peak_hours_avoided: peakHoursAvoided,
      avg_price_paid: Number(avgPricePaid.toFixed(4)),
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
      v2x_capable: v2xCapable,
      decisions_logged: decisionsLogged,
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
