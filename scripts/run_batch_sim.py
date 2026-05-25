"""Batch simulation runner for ZenOS.

Examples:
    # Helår, alla hushåll
    python scripts/run_batch_sim.py --year 2024

    # Kvartal, alla hushåll, alla lägen
    python scripts/run_batch_sim.py --quarter 2024-Q3 --all-modes

    # Enskild månad, enskilt hushåll
    python scripts/run_batch_sim.py --month 2024-11 --household-name "Familjen Nilsson - Lund"

    # Eget intervall, dry-run
    python scripts/run_batch_sim.py --from-date 2024-01-01 --to-date 2024-03-31 --dry-run

    # Helår 2025, alla hushåll, summering
    python scripts/run_batch_sim.py --year 2025 --summary-only

    # Med scenario-params override
    python scripts/run_batch_sim.py --year 2024 --scenario-params '{"min_soc": 20}'
"""
from __future__ import annotations

import argparse
import calendar
import json
import os
import sys
import uuid
from datetime import date, datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from db import get_client
from engine.simulator import run_simulation

# ── Konstanter ───────────────────────────────────────────────────────────────

QUARTER_RANGES: dict[str, tuple[str, str]] = {
    "Q1": ("01-01", "03-31"),
    "Q2": ("04-01", "06-30"),
    "Q3": ("07-01", "09-30"),
    "Q4": ("10-01", "12-31"),
}
ALL_MODES = ["smart_charge_basic", "smart_charge", "smart_v2x"]


# ── Hjälpfunktioner ──────────────────────────────────────────────────────────

def _build_date_range(args: argparse.Namespace, parser: argparse.ArgumentParser) -> tuple[str, str, str]:
    """Parsar period-argument och returnerar (label, from_str, to_str)."""
    if args.year:
        try:
            y = int(args.year)
        except ValueError:
            parser.error(f"--year måste vara ett heltal, fick '{args.year}'")
        return str(y), f"{y}-01-01", f"{y}-12-31"

    if args.quarter:
        parts = args.quarter.upper().split("-Q")
        if len(parts) != 2 or not parts[0].isdigit() or len(parts[0]) != 4 or parts[1] not in ("1","2","3","4"):
            parser.error(f"Ogiltigt kvartal '{args.quarter}' — använd YYYY-Q1 … YYYY-Q4")
        y   = parts[0]
        qk  = f"Q{parts[1]}"
        start, end = QUARTER_RANGES[qk]
        label = f"{y}-{qk}"
        return label, f"{y}-{start}", f"{y}-{end}"

    if args.month:
        try:
            y, m = args.month.split("-")
            year, month = int(y), int(m)
            if not (1 <= month <= 12):
                raise ValueError
        except ValueError:
            parser.error(f"Ogiltigt månadsformat '{args.month}' — använd YYYY-MM")
        last = calendar.monthrange(year, month)[1]
        label = f"{year}-{month:02d}"
        return label, f"{year}-{month:02d}-01", f"{year}-{month:02d}-{last:02d}"

    if args.from_date:
        return f"{args.from_date}→{args.to_date}", args.from_date, args.to_date

    # Default: innevarande år
    y = date.today().year
    return f"{y}", f"{y}-01-01", f"{y}-12-31"


def _get_households(args: argparse.Namespace, db) -> list[dict]:
    """Hämtar hushåll från DB baserat på val-argument."""
    cols = "id, name, price_area, car_model"

    if args.household_id:
        rows = (
            db.table("household_profiles")
            .select(cols)
            .eq("id", args.household_id)
            .limit(1)
            .execute()
            .data or []
        )
        if not rows:
            sys.exit(f"ERROR: Inget hushåll med id={args.household_id}")
        return rows

    if args.household_name:
        rows = (
            db.table("household_profiles")
            .select(cols)
            .eq("name", args.household_name)
            .limit(1)
            .execute()
            .data or []
        )
        if not rows:
            sys.exit(f"ERROR: Inget hushåll med namn='{args.household_name}'")
        return rows

    # --all-households eller default
    rows = (
        db.table("household_profiles")
        .select(cols)
        .order("name")
        .execute()
        .data or []
    )
    if not rows:
        sys.exit("ERROR: Inga rader i household_profiles")
    return rows


def _print_summary(results: list[dict], errors: list[str], dry_run: bool) -> None:
    W = 96
    print()
    print("=" * W)
    print("  BATCH SIMULATION SUMMARY")
    print("=" * W)

    if dry_run:
        n = len(results)   # dry-run fyller results med "planerade" poster
        print(f"  [DRY-RUN] {n} simulationer planerade — ingenting kördes.")
        print("=" * W)
        return

    if not results:
        print("  Inga resultat.")
    else:
        hdr = (
            f"  {'Hushåll':<35s}  {'Period':<16s}  {'Läge':<18s}"
            f"  {'Total SEK':>10s}  {'V2H SEK':>9s}  {'Peak SEK':>9s}  {'V2H kWh':>8s}  {'Dagar':>5s}"
        )
        print(hdr)
        print("  " + "─" * (W - 2))

        for r in sorted(results, key=lambda x: x["total_saved_sek"], reverse=True):
            name = r["household"]
            if len(name) > 35:
                name = name[:33] + ".."
            print(
                f"  {name:<35s}  {r['period']:<16s}  {r['mode']:<18s}"
                f"  {r['total_saved_sek']:>10,.0f}  {r['v2h_saving_sek']:>9,.0f}"
                f"  {r['peak_demand_sek']:>9,.0f}  {r['v2h_kwh']:>8,.0f}  {r['days']:>5d}"
            )

        print()
        print(f"  Körda simulationer : {len(results)}")
        if len(results) > 1:
            print(f"  Summa total SEK    : {sum(r['total_saved_sek'] for r in results):,.0f}")

    if errors:
        print()
        print(f"  FEL ({len(errors)}):")
        for e in errors:
            print(f"    {e}")
    else:
        print(f"  Fel                : 0")

    print("=" * W)


# ── CLI-definition ────────────────────────────────────────────────────────────

def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="ZenOS batch simulation runner",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )

    # Period (mutually exclusive)
    period = parser.add_mutually_exclusive_group()
    period.add_argument("--year",      metavar="YYYY",      help="Helår, t.ex. 2024")
    period.add_argument("--quarter",   metavar="YYYY-Qn",   help="Kvartal, t.ex. 2024-Q3")
    period.add_argument("--month",     metavar="YYYY-MM",   help="Månad, t.ex. 2024-11")
    period.add_argument("--from-date", metavar="YYYY-MM-DD",help="Eget startdatum (kräver --to-date)")
    parser.add_argument("--to-date",   metavar="YYYY-MM-DD",help="Eget slutdatum (kräver --from-date)")

    # Hushåll (mutually exclusive)
    hh = parser.add_mutually_exclusive_group()
    hh.add_argument("--household-id",   metavar="UUID", help="Enskilt hushåll via ID")
    hh.add_argument("--household-name", metavar="NAME", help="Enskilt hushåll via namn")
    hh.add_argument("--all-households", action="store_true",
                    help="Alla hushåll i household_profiles (default)")

    # Läge
    parser.add_argument(
        "--mode",
        choices=ALL_MODES,
        default="smart_v2x",
        help="Optimeringsläge (default: smart_v2x)",
    )
    parser.add_argument(
        "--all-modes", action="store_true",
        help="Kör alla 3 lägen per hushåll/period-kombination",
    )

    # Övrigt
    parser.add_argument("--dry-run",      action="store_true", help="Visa plan, kör inget")
    parser.add_argument("--summary-only", action="store_true", help="Dölj per-sim-output")
    parser.add_argument(
        "--scenario-params", metavar="JSON",
        help='Scenario-overrides som JSON, t.ex. \'{"min_soc": 20}\'',
    )

    return parser


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = _build_parser()
    args   = parser.parse_args()

    # Validera --from-date / --to-date parning
    if bool(args.from_date) != bool(args.to_date):
        parser.error("--from-date och --to-date måste anges tillsammans")
    if args.from_date and args.to_date:
        try:
            fd = date.fromisoformat(args.from_date)
            td = date.fromisoformat(args.to_date)
        except ValueError as e:
            parser.error(f"Ogiltigt datumformat: {e}")
        if fd > td:
            parser.error("--from-date måste vara före eller samma som --to-date")

    # Validera --scenario-params
    scenario_params: dict | None = None
    if args.scenario_params:
        try:
            scenario_params = json.loads(args.scenario_params)
            if not isinstance(scenario_params, dict):
                raise ValueError("Måste vara ett JSON-objekt")
        except (json.JSONDecodeError, ValueError) as e:
            parser.error(f"Ogiltigt --scenario-params: {e}")

    # Bygg period och hämta hushåll
    label, from_str, to_str = _build_date_range(args, parser)
    db         = get_client()
    households = _get_households(args, db)
    modes      = ALL_MODES if args.all_modes else [args.mode]

    combos = [
        (hh, mode)
        for hh in households
        for mode in modes
    ]
    total = len(combos)

    print(f"\nZenOS Batch Simulation")
    print(f"  Period     : {label}  ({from_str} → {to_str})")
    print(f"  Hushåll    : {len(households)}")
    print(f"  Lägen      : {', '.join(modes)}")
    print(f"  Simulationer: {total}")
    if scenario_params:
        print(f"  Scenario   : {scenario_params}")
    if args.dry_run:
        print("  [DRY-RUN]")
    print()

    results: list[dict] = []
    errors:  list[str]  = []

    for i, (hh, mode) in enumerate(combos, 1):
        name = hh["name"]
        area = hh.get("price_area") or ""
        prefix = f"[{i}/{total}]"
        line   = f"{prefix}  {name}  {label}  {mode}"

        if args.dry_run:
            print(f"{line}  [DRY-RUN]")
            results.append({
                "household":       name,
                "period":          label,
                "mode":            mode,
                "total_saved_sek": 0,
                "v2h_saving_sek":  0,
                "peak_demand_sek": 0,
                "price_savings_sek": 0,
                "v2h_kwh":         0,
                "days":            0,
            })
            continue

        if args.summary_only:
            print(f"{line}  ...", end="", flush=True)
        else:
            print(f"{line}")

        sim_id = str(uuid.uuid4())
        row: dict = {
            "id":                sim_id,
            "household_id":      hh["id"],
            "period_from":       from_str,
            "period_to":         to_str,
            "optimization_mode": mode,
            "status":            "pending",
            "scenario_number":   1,
            "created_at":        datetime.now(timezone.utc).isoformat(),
        }
        if scenario_params:
            row["scenario_params"] = scenario_params

        try:
            db.table("simulation_runs").insert(row).execute()
            result = run_simulation(sim_id)

            total_sek = result["total_saved_sek"]
            days      = result["days_processed"]
            v2h_kwh   = result["total_v2h_kwh"]

            if args.summary_only:
                print(f"  ✅ {total_sek:,.0f} SEK  ({days} dagar)")
            else:
                print(f"  ✅ {total_sek:,.0f} SEK  |  V2H {v2h_kwh:,.0f} kWh  |  {days} dagar  |  sim_id={sim_id}")

            results.append({
                "household":         name,
                "period":            label,
                "mode":              mode,
                "total_saved_sek":   total_sek,
                "v2h_saving_sek":    result["total_v2h_saving_sek"],
                "peak_demand_sek":   result["peak_demand_saving_sek"],
                "price_savings_sek": result["price_savings_sek"],
                "v2h_kwh":           v2h_kwh,
                "days":              days,
            })

        except Exception as exc:
            msg = f"[{i}/{total}] MISSLYCKADES: {name} / {label} / {mode}: {exc}"
            if args.summary_only:
                print(f"  ❌ {exc}", file=sys.stderr)
            else:
                print(f"  ❌ {exc}", file=sys.stderr)
            errors.append(msg)

    _print_summary(results, errors, args.dry_run)


if __name__ == "__main__":
    main()
