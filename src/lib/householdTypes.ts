// Klassificering av hushåll i ZenOS Lab
// Används för att hålla isär tränings-, referens- och kund-data.

export type HouseholdType = "seed" | "training" | "real";

export const HOUSEHOLD_TYPE_FILTERS: Array<{ value: "all" | HouseholdType; label: string }> = [
  { value: "all", label: "Alla" },
  { value: "seed", label: "Referens" },
  { value: "training", label: "Träning" },
  { value: "real", label: "Kunder" },
];

export interface HouseholdTypeMeta {
  label: string;
  className: string;
}

export function householdTypeMeta(type: string | null | undefined): HouseholdTypeMeta {
  switch (type) {
    case "seed":
      return {
        label: "Referens",
        className: "bg-muted text-muted-foreground border-transparent",
      };
    case "real":
      return {
        label: "Kund",
        className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-transparent",
      };
    case "training":
    default:
      return {
        label: "Träning",
        className: "bg-sky-500/15 text-sky-700 dark:text-sky-400 border-transparent",
      };
  }
}
