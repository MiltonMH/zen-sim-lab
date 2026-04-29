
## Context

The user asks to "call the same edge function `import-spot-prices` with `{ year: 2025 }`" — but no such edge function exists in the project. The current Import Data page (`src/pages/ImportData.tsx`) imports spot prices **client-side**, looping day-by-day against `https://www.elprisetjustnu.se/api/v1/prices/{YYYY}/{MM-DD}_SE3.json` and inserting into `spot_prices` in chunks of 500.

So "the same edge function" doesn't exist yet. Two ways forward — I recommend Option A as the smallest, safest change that delivers what the user actually wants (2025 data in the table).

## Option A (recommended) — Extend the existing client-side import to support 2025

Smallest change, no new infrastructure, matches what's already working.

### Changes to `src/pages/ImportData.tsx`

1. **Add a year selector** (Select component, options: `2024`, `2025`) above the import button. Default: `2025`.
2. **Replace the hardcoded `YEAR = 2024`** with state (`selectedYear`).
3. **Update button label** to reflect chosen year: `Import {selectedYear} ({daysInYear(selectedYear).length} days)`.
4. **Pass `selectedYear`** into `runImport` and `runTest` (test fetches Jan 1 of selected year).
5. **Guard against future days**: when importing 2025, the API only returns days that have been published. Skip 404s gracefully (already handled — keep behavior, just keep the warning log).
6. **Show row count after import** unchanged. Toast on completion.

### UX after change

```text
┌──────────────────────────────────────┐
│ Import spot prices                   │
│ Year: [2025 ▼]                       │
│ [Test API connection]                │
│ [⬇ Import 2025 (365 days)]           │
└──────────────────────────────────────┘
```

### Result

After running for 2025 (and given 2024 was already imported), `spot_prices` will hold ~8,784 (2024, leap year) + ~8,760 (2025, full year if past year-end, otherwise fewer up to today) ≈ **~17,520 rows**.

### Notes / caveats

- No deduplication logic exists today; if the user clicks Import 2024 again, duplicates would be inserted. Not changing this now (out of scope), but worth flagging.
- 2025 days that haven't been published yet by elprisetjustnu.se will be skipped (HTTP 404), which is fine.

---

## Option B — Actually create the `import-spot-prices` edge function

Only worth doing if you want server-side imports (e.g. scheduled, no browser tab needed). More work; not needed to get 2025 data in.

Would create `supabase/functions/import-spot-prices/index.ts` that accepts `{ year: number }`, loops days, fetches from elprisetjustnu, and bulk-inserts using the service role key. Then the page would call `supabase.functions.invoke("import-spot-prices", { body: { year: 2025 } })`.

---

## Recommendation

Go with **Option A**. It's a ~30-line change to one file, reuses the proven client-side path, and gets 2025 data into the table immediately.

Approve and I'll implement Option A. If you'd rather have the edge function (Option B), say so and I'll build that instead.
