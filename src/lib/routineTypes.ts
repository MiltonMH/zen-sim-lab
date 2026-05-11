// Hushållets rutiner — styr när bilen är hemma, sover etc.

export type RoutineKey =
  | "pendlare"
  | "hemarbetare"
  | "deltid"
  | "pensionar"
  | "skift_tidig"
  | "skift_sen";

export interface RoutineDef {
  key: RoutineKey;
  label: string;
  description: string;
  summary: string;
  wake_time: number;
  leave_time: number;
  return_time: number;
  sleep_time: number;
  badgeClass: string; // tailwind classes
}

export const ROUTINES: RoutineDef[] = [
  {
    key: "pendlare",
    label: "Pendlare",
    description: "Jobbar utanför hemmet",
    summary: "Borta 08:00–17:00",
    wake_time: 6, leave_time: 8, return_time: 17, sleep_time: 23,
    badgeClass: "bg-muted text-muted-foreground border-transparent",
  },
  {
    key: "hemarbetare",
    label: "Hemarbetare",
    description: "Jobbar hemifrån hela dagen",
    summary: "Bilen hemma dygnet runt",
    wake_time: 7, leave_time: 23, return_time: 7, sleep_time: 23,
    badgeClass: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-transparent",
  },
  {
    key: "deltid",
    label: "Deltid",
    description: "Kortare arbetsdagar",
    summary: "Borta 09:00–14:00",
    wake_time: 7, leave_time: 9, return_time: 14, sleep_time: 23,
    badgeClass: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-transparent",
  },
  {
    key: "pensionar",
    label: "Pensionär",
    description: "Mestadels hemma",
    summary: "Korta ärenden 10:00–13:00",
    wake_time: 7, leave_time: 10, return_time: 13, sleep_time: 21,
    badgeClass: "bg-sky-500/15 text-sky-700 dark:text-sky-400 border-transparent",
  },
  {
    key: "skift_tidig",
    label: "Tidig skift",
    description: "Tidigt skift",
    summary: "06:00–14:00",
    wake_time: 5, leave_time: 6, return_time: 14, sleep_time: 22,
    badgeClass: "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-transparent",
  },
  {
    key: "skift_sen",
    label: "Sen skift",
    description: "Sent skift",
    summary: "14:00–22:00",
    wake_time: 8, leave_time: 13, return_time: 22, sleep_time: 23,
    badgeClass: "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-transparent",
  },
];

// Bakåtkompatibla aliaser för gamla värden i databasen
const LEGACY_ALIAS: Record<string, RoutineKey> = {
  pendlare: "pendlare",
  hemma: "hemarbetare",
  hemarbetare: "hemarbetare",
  deltid: "deltid",
  pensionar: "pensionar",
  pensionär: "pensionar",
  skiftarbete: "skift_tidig",
  skift_tidig: "skift_tidig",
  skift_sen: "skift_sen",
};

export function resolveRoutine(key: string | null | undefined): RoutineDef {
  const k = (key ?? "").toLowerCase();
  const alias = LEGACY_ALIAS[k] ?? "pendlare";
  return ROUTINES.find(r => r.key === alias) ?? ROUTINES[0];
}

export type HourState = "sleep" | "home" | "away" | "night_charge";

// Bygg 24h tidslinje. Nattladdning markeras 01–05 om bilen är hemma och man sover.
export function buildRoutineTimeline(r: RoutineDef): HourState[] {
  const out: HourState[] = [];
  const isAwake = (h: number) => {
    // sover från sleep_time till wake_time (modulo 24)
    if (r.sleep_time === r.wake_time) return true;
    if (r.sleep_time > r.wake_time) {
      // sover sleep_time..23 och 0..wake_time-1
      return !(h >= r.sleep_time || h < r.wake_time);
    }
    return h >= r.wake_time && h < r.sleep_time;
  };
  const isAway = (h: number) => {
    if (r.leave_time === r.return_time) return false;
    if (r.leave_time < r.return_time) {
      return h >= r.leave_time && h < r.return_time;
    }
    // borta över midnatt (t.ex. sent skift) — sällsynt
    return h >= r.leave_time || h < r.return_time;
  };
  for (let h = 0; h < 24; h++) {
    if (!isAwake(h)) {
      // nattladdning 01-05 när bilen är hemma och vi sover
      if (h >= 1 && h <= 5 && !isAway(h)) out.push("night_charge");
      else out.push("sleep");
    } else if (isAway(h)) out.push("away");
    else out.push("home");
  }
  return out;
}
