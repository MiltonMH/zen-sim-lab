import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const CHARGE_KW = 11;          // Arc max charging power
const CHEAPEST_HOURS = 8;      // Charge during the 8 cheapest hours each day
const KM_PER_PCT = 5;          // Rough estimate: 5 km per % battery

interface SpotPrice { hour: string; price_sek_kwh: number }

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

    // 1. Fetch simulation
    const { data: sim, error: simErr } = await supabase
      .from("simulation_runs").select("*").eq("id", simulation_id).maybeSingle();
    if (simErr || !sim) return json({ error: simErr?.message ?? "Simulation not found" }, 404);

    // Mark running
    await supabase.from("simulation_runs").update({ status: "running" }).eq("id", simulation_id);

    // 2. Fetch household
    const { data: hh, error: hErr } = await supabase
      .from("household_profiles").select("*").eq("id", sim.household_id).maybeSingle();
    if (hErr || !hh) return failSim(supabase, simulation_id, "Household not found", 404);

    const batteryKwh = Number(hh.battery_kwh) || 60;
    const dailyKm = Number(hh.daily_km) || 30;
    const priceArea = hh.price_area || "SE3";

    // Energy needed per day (kWh): daily_km / 5 * battery_kwh / 100
    const dailyKwhNeeded = (dailyKm / KM_PER_PCT) * batteryKwh / 100;

    // 3. Fetch spot prices for the period
    const fromIso = `${sim.period_from}T00:00:00+00:00`;
    const toIso = `${sim.period_to}T23:59:59+00:00`;
    const { data: prices, error: pErr } = await supabase
      .from("spot_prices")
      .select("hour, price_sek_kwh")
      .eq("price_area", priceArea)
      .gte("hour", fromIso)
      .lte("hour", toIso)
      .order("hour", { ascending: true });
    if (pErr) return failSim(supabase, simulation_id, pErr.message, 500);
    if (!prices || prices.length === 0) {
      return failSim(supabase, simulation_id, `No spot prices found for ${priceArea} in period`, 400);
    }

    // 4. Group by local day (Europe/Stockholm)
    const byDay = new Map<string, SpotPrice[]>();
    for (const row of prices as SpotPrice[]) {
      const day = stockholmDay(row.hour);
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day)!.push(row);
    }

    // 5. Process each day
    let totalKwhCharged = 0;
    let totalCostOptimized = 0;
    let totalCostBaseline = 0;
    let decisionsLogged = 0;
    let soc = 50; // start at 50%

    const logsBatch: Array<{
      household_id: string; logged_at: string; decision: string;
      spot_price_sek: number; soc_pct: number; reason: string;
    }> = [];

    const sortedDays = Array.from(byDay.keys()).sort();

    for (const day of sortedDays) {
      const dayPrices = byDay.get(day)!;
      if (dayPrices.length === 0) continue;

      // Sort by price, mark cheapest N as charge
      const ranked = [...dayPrices]
        .map((p, idx) => ({ ...p, idx }))
        .sort((a, b) => Number(a.price_sek_kwh) - Number(b.price_sek_kwh));
      const chargeIdx = new Set(ranked.slice(0, CHEAPEST_HOURS).map(r => r.idx));

      // Average daily price for baseline
      const avgPrice =
        dayPrices.reduce((s, p) => s + Number(p.price_sek_kwh), 0) / dayPrices.length;

      // Average price across the cheapest charge hours
      const cheapPrices = ranked.slice(0, CHEAPEST_HOURS).map(r => Number(r.price_sek_kwh));
      const avgCheapPrice = cheapPrices.reduce((s, p) => s + p, 0) / Math.max(1, cheapPrices.length);

      // Cost for the day = same energy need, charged at optimized vs baseline price
      const dayOptimized = dailyKwhNeeded * avgCheapPrice;
      const dayBaseline = dailyKwhNeeded * avgPrice;
      totalCostOptimized += dayOptimized;
      totalCostBaseline += dayBaseline;
      totalKwhCharged += dailyKwhNeeded;

      // SoC simulation: charge during cheap hours, discharge spread over the rest
      const chargePerHour = dailyKwhNeeded / CHEAPEST_HOURS;
      const dischargePerHour = dailyKwhNeeded / (24 - CHEAPEST_HOURS);
      const socStepCharge = (chargePerHour / batteryKwh) * 100;
      const socStepDischarge = (dischargePerHour / batteryKwh) * 100;

      for (let i = 0; i < dayPrices.length; i++) {
        const p = dayPrices[i];
        const price = Number(p.price_sek_kwh);
        const isCharge = chargeIdx.has(i);

        if (isCharge) soc = Math.min(100, soc + socStepCharge);
        else soc = Math.max(0, soc - socStepDischarge);

        logsBatch.push({
          household_id: sim.household_id,
          logged_at: p.hour,
          decision: isCharge ? "charge" : "pause",
          spot_price_sek: price,
          soc_pct: Number(soc.toFixed(2)),
          reason: isCharge ? "cheap_hour" : "expensive_hour",
        });
        decisionsLogged++;
      }
    }

    // Replace any prior logs for this household within the period
    await supabase
      .from("optimization_logs")
      .delete()
      .eq("household_id", sim.household_id)
      .gte("logged_at", fromIso)
      .lte("logged_at", toIso);

    // Insert in chunks
    for (let i = 0; i < logsBatch.length; i += 500) {
      const chunk = logsBatch.slice(i, i + 500);
      const { error: lErr } = await supabase.from("optimization_logs").insert(chunk);
      if (lErr) console.error("log insert error", lErr.message);
    }

    const totalSaved = totalCostBaseline - totalCostOptimized;
    const avgPricePaid = totalKwhCharged > 0 ? totalCostOptimized / totalKwhCharged : 0;
    const baselineAvgPrice =
      sortedDays.reduce((sum, d) => {
        const dp = byDay.get(d)!;
        return sum + dp.reduce((s, p) => s + Number(p.price_sek_kwh), 0) / dp.length;
      }, 0) / Math.max(1, sortedDays.length);

    await supabase.from("simulation_runs").update({
      status: "completed",
      total_saved_sek: Number(totalSaved.toFixed(2)),
      avg_price_paid: Number(avgPricePaid.toFixed(4)),
      ended_at: new Date().toISOString(),
    }).eq("id", simulation_id);

    return json({
      days_processed: sortedDays.length,
      total_kwh_charged: Number(totalKwhCharged.toFixed(2)),
      total_saved_sek: Number(totalSaved.toFixed(2)),
      avg_price_paid: Number(avgPricePaid.toFixed(4)),
      baseline_avg_price: Number(baselineAvgPrice.toFixed(4)),
      decisions_logged: decisionsLogged,
    }, 200);
  } catch (err) {
    console.error("run-simulation error", err);
    return json({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function failSim(supabase: any, id: string, msg: string, status: number) {
  await supabase.from("simulation_runs").update({ status: "failed", ended_at: new Date().toISOString() }).eq("id", id);
  return json({ error: msg }, status);
}

// Returns YYYY-MM-DD in Europe/Stockholm for a given UTC ISO timestamp
function stockholmDay(iso: string): string {
  const d = new Date(iso);
  const fmt = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  return fmt.format(d); // sv-SE returns YYYY-MM-DD
}
