"""CLI entry point for the ZenOS Python simulation engine.

Usage:
    # Run an existing simulation_run row by ID:
    python scripts/run_simulation.py --simulation-id <uuid>

    # Create a new simulation_run and run it immediately:
    python scripts/run_simulation.py \\
        --household-id <uuid> \\
        --from-date 2024-01-01 \\
        --to-date   2024-12-31 \\
        --mode      smart_v2x

Prints a JSON result dict to stdout.
"""
from __future__ import annotations

import argparse
import json
import sys
import uuid
from datetime import date

# Allow running from repo root: `python scripts/run_simulation.py`
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from engine.simulator import run_simulation


def _create_simulation_run(
    household_id: str,
    from_date: str,
    to_date: str,
    mode: str,
) -> str:
    """Insert a new simulation_runs row and return its id."""
    from db import get_client
    db = get_client()
    row = {
        "id": str(uuid.uuid4()),
        "household_id": household_id,
        "period_from": from_date,
        "period_to": to_date,
        "optimization_mode": mode,
        "status": "pending",
        "scenario_number": 1,
    }
    db.table("simulation_runs").insert(row).execute()
    return row["id"]


def main() -> None:
    parser = argparse.ArgumentParser(
        description="ZenOS Python simulation engine",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )

    mode_group = parser.add_mutually_exclusive_group(required=True)
    mode_group.add_argument(
        "--simulation-id",
        metavar="UUID",
        help="Run an existing simulation_runs row by id.",
    )
    mode_group.add_argument(
        "--household-id",
        metavar="UUID",
        help="Create a new simulation_run for this household.",
    )

    parser.add_argument("--from-date", metavar="YYYY-MM-DD", help="Start date (inclusive).")
    parser.add_argument("--to-date",   metavar="YYYY-MM-DD", help="End date (inclusive).")
    parser.add_argument(
        "--mode",
        choices=["smart_charge_basic", "smart_charge", "smart_v2x"],
        default="smart_v2x",
        help="Optimization mode (default: smart_v2x).",
    )

    args = parser.parse_args()

    if args.household_id:
        if not args.from_date or not args.to_date:
            parser.error("--from-date and --to-date are required with --household-id")
        # basic date validation
        try:
            date.fromisoformat(args.from_date)
            date.fromisoformat(args.to_date)
        except ValueError as exc:
            parser.error(f"Invalid date: {exc}")

        simulation_id = _create_simulation_run(
            args.household_id, args.from_date, args.to_date, args.mode
        )
        print(f"Created simulation_run {simulation_id}", file=sys.stderr)
    else:
        simulation_id = args.simulation_id

    try:
        result = run_simulation(simulation_id)
        print(json.dumps(result, indent=2, default=str))
    except Exception as exc:
        print(json.dumps({"error": str(exc), "simulation_id": simulation_id}), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
