import { Car, Laptop, Clock, Home, Sunrise, Moon, type LucideIcon } from "lucide-react";
import { ROUTINES, resolveRoutine, type RoutineKey } from "@/lib/routineTypes";
import { RoutineTimeline } from "@/components/RoutineTimeline";
import { cn } from "@/lib/utils";

const ICONS: Record<RoutineKey, LucideIcon> = {
  pendlare: Car,
  hemarbetare: Laptop,
  deltid: Clock,
  pensionar: Home,
  skift_tidig: Sunrise,
  skift_sen: Moon,
};

interface Props {
  value: string | null | undefined;
  onChange: (key: RoutineKey) => void;
}

export function RoutineCardPicker({ value, onChange }: Props) {
  const selected = resolveRoutine(value);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {ROUTINES.map(r => {
          const Icon = ICONS[r.key];
          const isActive = r.key === selected.key;
          return (
            <button
              key={r.key}
              type="button"
              onClick={() => onChange(r.key)}
              className={cn(
                "text-left rounded-xl border-2 p-4 transition-all",
                isActive
                  ? "border-emerald-500 bg-emerald-500/10 shadow-sm"
                  : "border-border bg-card hover:border-emerald-500/40 hover:bg-muted/40",
              )}
            >
              <div className="flex items-start gap-3">
                <div
                  className={cn(
                    "rounded-lg p-2 shrink-0",
                    isActive ? "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground",
                  )}
                >
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="font-semibold text-sm leading-tight">{r.label}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">{r.description}</div>
                  <div className="text-[11px] font-medium text-foreground/80 mt-1 tabular-nums">{r.summary}</div>
                </div>
              </div>
            </button>
          );
        })}
      </div>
      <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
        <RoutineTimeline routine={selected} />
      </div>
    </div>
  );
}
