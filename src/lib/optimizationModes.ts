// Single source of truth for optimization-mode labels & metadata.
// Old level1/2/3 values are mapped on read so legacy rows still display correctly.

export type OptimizationMode = "smart_charge_basic" | "smart_charge" | "smart_v2x";

export interface ModeMeta {
  id: OptimizationMode;
  label: string;       // short label (used in tables/badges)
  longLabel: string;   // dropdown title
  description: string; // tooltip / helper text
  requiresCcs2: boolean;
}

export const OPTIMIZATION_MODES: ModeMeta[] = [
  {
    id: "smart_charge_basic",
    label: "Nivå 1",
    longLabel: "Nivå 1 — Grundläggande",
    description:
      "Laddar under de 8 billigaste timmarna per dag. Ingen V2X.",
    requiresCcs2: false,
  },
  {
    id: "smart_charge",
    label: "Nivå 2",
    longLabel: "Nivå 2 — Smart laddning",
    description:
      "Smart laddning baserat på spotpris och hushållets förbrukningsprofil. Undviker dyra topptimmar. Ingen V2X — passar alla bilar.",
    requiresCcs2: false,
  },
  {
    id: "smart_v2x",
    label: "Nivå 3",
    longLabel: "Nivå 3 — Full V2X",
    description:
      "Full ZenOS-optimering med V2X. Smart laddning + V2H under toppar + effekttariffskydd + batterihälsa. Kräver V2X-kapabel bil med CCS2-port.",
    requiresCcs2: true,
  },
];

const LEGACY_MAP: Record<string, OptimizationMode> = {
  level1: "smart_charge_basic",
  level2: "smart_charge",
  level3: "smart_v2x",
};

export function normalizeMode(value: string | null | undefined): OptimizationMode {
  if (!value) return "smart_charge";
  if (value in LEGACY_MAP) return LEGACY_MAP[value];
  if (OPTIMIZATION_MODES.some((m) => m.id === value)) return value as OptimizationMode;
  return "smart_charge";
}

export function modeLabel(value: string | null | undefined): string {
  const id = normalizeMode(value);
  return OPTIMIZATION_MODES.find((m) => m.id === id)?.label ?? id;
}

export function modeLongLabel(value: string | null | undefined): string {
  const id = normalizeMode(value);
  return OPTIMIZATION_MODES.find((m) => m.id === id)?.longLabel ?? id;
}
