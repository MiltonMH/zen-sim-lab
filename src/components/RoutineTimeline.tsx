import { buildRoutineTimeline, type RoutineDef, type HourState } from "@/lib/routineTypes";

const COLORS: Record<HourState, string> = {
  sleep: "bg-muted-foreground/30",
  home: "bg-emerald-500",
  away: "bg-zinc-700 dark:bg-zinc-500",
  night_charge: "bg-blue-500",
};

const LABELS: Record<HourState, string> = {
  sleep: "Sover",
  home: "Hemma (V2H möjligt)",
  away: "Bilen borta",
  night_charge: "Nattladdning",
};

export function RoutineTimeline({ routine, compact = false }: { routine: RoutineDef; compact?: boolean }) {
  const states = buildRoutineTimeline(routine);
  return (
    <div className="space-y-2">
      <div className="flex w-full overflow-hidden rounded-md border border-border/60">
        {states.map((s, i) => (
          <div
            key={i}
            className={`${COLORS[s]} h-6 flex-1 ${i > 0 ? "border-l border-background/40" : ""}`}
            title={`${String(i).padStart(2, "0")}:00 — ${LABELS[s]}`}
          />
        ))}
      </div>
      <div className="flex justify-between text-[10px] tabular-nums text-muted-foreground px-0.5">
        <span>00</span><span>06</span><span>12</span><span>18</span><span>24</span>
      </div>
      {!compact && (
        <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
          {(["sleep", "home", "away", "night_charge"] as HourState[]).map(s => (
            <div key={s} className="flex items-center gap-1.5">
              <span className={`inline-block h-2.5 w-2.5 rounded-sm ${COLORS[s]}`} />
              {LABELS[s]}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
