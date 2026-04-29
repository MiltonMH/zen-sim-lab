// Swedish consumption averages (SCB / Energimyndigheten)

export const HEATING_KWH_PER_M2: Record<string, number> = {
  elvärme: 130,
  värmepump_luft: 65,
  värmepump_berg: 55,
  fjärrvärme: 33,
  pellets: 33,
};

export const HEATING_LABELS: Record<string, string> = {
  elvärme: "Elvärme",
  värmepump_luft: "Luft/luft-värmepump",
  värmepump_berg: "Bergvärmepump",
  fjärrvärme: "Fjärrvärme",
  pellets: "Pellets",
};

export const ROUTINE_LABELS: Record<string, string> = {
  pendlare: "Pendlare",
  hemarbetare: "Hemarbetare",
  pensionär: "Pensionär",
  blandat: "Blandat",
};

export function buildYearMultiplier(year?: number | null): number {
  if (!year) return 1.0;
  if (year < 1960) return 1.25;
  if (year <= 1985) return 1.15;
  if (year <= 2000) return 1.05;
  if (year <= 2015) return 1.0;
  return 0.9;
}

export function calcAnnualKwh(opts: {
  area_m2?: number | null;
  heating_type?: string | null;
  adults?: number | null;
  children?: number | null;
  build_year?: number | null;
  solar_kwh_per_year?: number | null;
}): number {
  const area = Number(opts.area_m2) || 0;
  const perM2 = opts.heating_type ? HEATING_KWH_PER_M2[opts.heating_type] ?? 0 : 0;
  const adults = Math.max(1, Number(opts.adults) || 1);
  const children = Math.max(0, Number(opts.children) || 0);

  const base = area * perM2;
  const people = (adults - 1) * 2000 + children * 1000 + 2000; // baseline 2000 for first adult
  const total = (base + people) * buildYearMultiplier(opts.build_year);
  const net = total - (Number(opts.solar_kwh_per_year) || 0);
  return Math.max(0, Math.round(net));
}

// 24 hourly weights by routine (must sum to ~24)
const RAW_PROFILES: Record<string, number[]> = {
  pendlare: [
    0.3,0.3,0.3,0.3,0.3,0.3, // 0-5
    1.8,1.8,                  // 6-7
    0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4, // 8-16 wait, need 07-17 = 0.4
    2.2,2.2,                  // 17-18
    1.4,1.4,1.4,              // 19-21
    0.8,0.8,                  // 22-23
  ],
  hemarbetare: [
    0.3,0.3,0.3,0.3,0.3,0.3,  // 0-5
    1.6,1.6,1.6,              // 6-8
    1.0,1.0,1.0,1.0,          // 8-11 -> we'll re-do below
    1.4,                      // 12
    0.9,0.9,0.9,0.9,          // 13-16
    2.0,2.0,                  // 17-18
    1.3,1.3,1.3,              // 19-21
    0.7,0.7,                  // 22-23
  ],
  pensionär: [
    0.3,0.3,0.3,0.3,0.3,
    1.2,1.2,
    1.8,1.8,
    1.0,1.0,1.0,
    1.6,
    0.9,0.9,0.9,
    1.8,1.8,
    1.2,1.2,1.2,
    0.7,0.7,0.7,
  ],
};

// Build clean per-hour arrays per spec
function pendlareProfile(leave = 7, ret = 17): number[] {
  const w = new Array(24).fill(0);
  for (let h = 0; h < 24; h++) {
    if (h <= 5) w[h] = 0.3;
    else if (h === 6 || h === 7) w[h] = 1.8;
    else if (h >= 8 && h < ret) w[h] = 0.4;
    else if (h === ret || h === ret + 1) w[h] = 2.2;
    else if (h >= ret + 2 && h <= 21) w[h] = 1.4;
    else if (h >= 22) w[h] = 0.8;
  }
  return w;
}

function hemarbetareProfile(): number[] {
  const w = new Array(24).fill(0);
  for (let h = 0; h < 24; h++) {
    if (h <= 5) w[h] = 0.3;
    else if (h >= 6 && h <= 8) w[h] = 1.6;
    else if (h >= 9 && h <= 11) w[h] = 1.0;
    else if (h === 12) w[h] = 1.4;
    else if (h >= 13 && h <= 16) w[h] = 0.9;
    else if (h === 17 || h === 18) w[h] = 2.0;
    else if (h >= 19 && h <= 21) w[h] = 1.3;
    else w[h] = 0.7;
  }
  return w;
}

function pensionarProfile(): number[] {
  const w = new Array(24).fill(0);
  for (let h = 0; h < 24; h++) {
    if (h <= 4) w[h] = 0.3;
    else if (h === 5 || h === 6) w[h] = 1.2;
    else if (h === 7 || h === 8) w[h] = 1.8;
    else if (h >= 9 && h <= 11) w[h] = 1.0;
    else if (h === 12) w[h] = 1.6;
    else if (h >= 13 && h <= 15) w[h] = 0.9;
    else if (h === 16 || h === 17) w[h] = 1.8;
    else if (h >= 18 && h <= 20) w[h] = 1.2;
    else w[h] = 0.7;
  }
  return w;
}

export function buildHourlyWeights(
  routine: string,
  leave?: number,
  ret?: number
): number[] {
  let raw: number[];
  switch (routine) {
    case "hemarbetare": raw = hemarbetareProfile(); break;
    case "pensionär":   raw = pensionarProfile(); break;
    case "blandat":     raw = pendlareProfile(leave ?? 9, ret ?? 15).map((v, i) => (v + hemarbetareProfile()[i]) / 2); break;
    default:            raw = pendlareProfile(leave, ret);
  }
  // normalise so sum = 24
  const sum = raw.reduce((a, b) => a + b, 0) || 1;
  return raw.map(v => +(v * 24 / sum).toFixed(4));
}

export const SEASONAL_FACTOR: Record<number, number> = {
  1: 2.5, 2: 2.5, 12: 2.5,
  3: 1.5, 11: 1.5,
  4: 1.1, 10: 1.1,
  5: 0.7, 6: 0.7, 7: 0.7, 8: 0.7, 9: 0.7,
};
