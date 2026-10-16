"""
Fail the build when a carrier cache has gone stale.

The cache guard is deliberately conservative: it would rather serve last week's
data than overwrite good data with a bad fetch. The failure mode is that a
carrier quietly stops updating and nobody notices -- Amazon sat at eight weeks
and Budbee at five before anyone looked, because a guarded run still reports
green.

This is the tripwire for that. It reads metadata.fetched_at from every carrier
cache and fails if any of them is older than --max-age-days, whatever the
reason: a blocked guard, a broken scraper, or a workflow that stopped firing.

Run it last in the workflow, after the commit and push. A stale carrier must
never stop the fresh data for the other carriers from being published.

Usage:
    python scripts/check_cache_freshness.py [--max-age-days 21]

Exit codes:
    0 = every cache is within the age limit
    1 = at least one cache is stale (or unreadable)
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

DATA_DIR = Path(__file__).parent.parent / "data"

# Three missed weekly runs. Tight enough to catch a stuck carrier in the month
# it breaks, loose enough that one skipped Monday is not an incident.
DEFAULT_MAX_AGE_DAYS = 45

# Cache filename stem -> the carrier name used everywhere else (CARRIERS in
# build_data.py, CARRIER_ORDER in webapp/lib/carriers.ts).
CARRIER_NAMES = {
    "dhl": "DHL",
    "hermes": "Hermes",
    "dpd": "DPD",
    "gls": "GLS",
    "ups": "UPS",
    "amazon": "Amazon",
    "fedex": "FedEx",
    "myflexbox": "myflexbox",
    "deinfach": "DeinFach",
    "mbe": "MBE",
    "novapost": "NovaPost",
    "parcelly": "Parcelly",
}


def carrier_name(path: Path) -> str:
    """Map data/<stem>_all_locations.json to a carrier name."""
    stem = path.name.removesuffix("_all_locations.json")
    return CARRIER_NAMES.get(stem, stem)


def cache_age_days(path: Path) -> tuple[float | None, int | None, str | None]:
    """
    Return (age_in_days, location_count, error) for one cache file.

    age_in_days is None when the file cannot be read or carries no usable
    fetched_at, in which case error explains why.
    """
    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except Exception as exc:
        return None, None, f"unreadable: {exc}"

    metadata = data.get("metadata") or {}
    count = len(data.get("locations") or [])

    raw = metadata.get("fetched_at")
    if not raw:
        return None, count, "no metadata.fetched_at"

    try:
        fetched = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except ValueError:
        return None, count, f"unparseable fetched_at: {raw!r}"

    if fetched.tzinfo is None:
        fetched = fetched.replace(tzinfo=timezone.utc)

    age = (datetime.now(timezone.utc) - fetched).total_seconds() / 86400
    return age, count, None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--max-age-days",
        type=float,
        default=DEFAULT_MAX_AGE_DAYS,
        help=f"fail when a cache is older than this (default: {DEFAULT_MAX_AGE_DAYS})",
    )
    args = parser.parse_args()

    caches = sorted(DATA_DIR.glob("*_all_locations.json"))
    if not caches:
        print(f"No carrier caches found in {DATA_DIR}")
        return 1

    rows = []
    stale = []

    for path in caches:
        name = carrier_name(path)
        age, count, error = cache_age_days(path)

        if age is None:
            rows.append((name, count, "—", f"❌ {error}"))
            stale.append(f"{name} ({error})")
        elif age > args.max_age_days:
            rows.append((name, count, f"{age:.0f} d", "❌ stale"))
            stale.append(f"{name} ({age:.0f} days old)")
        else:
            rows.append((name, count, f"{age:.0f} d", "✅ fresh"))

    width = max(len(row[0]) for row in rows)
    print(f"Cache freshness (limit: {args.max_age_days:.0f} days)")
    print()
    for name, count, age, status in rows:
        shown = f"{count:>6,}" if count is not None else "     ?"
        print(f"  {name:<{width}}  {shown} locations  {age:>6}  {status}")

    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        lines = [
            "## Cache freshness",
            "",
            f"Limit: {args.max_age_days:.0f} days.",
            "",
            "| Carrier | Locations | Age | Status |",
            "| --- | --: | --: | --- |",
        ]
        for name, count, age, status in rows:
            shown = f"{count:,}" if count is not None else "?"
            lines.append(f"| {name} | {shown} | {age} | {status} |")
        if stale:
            lines += [
                "",
                f"**{len(stale)} stale cache(s):** " + ", ".join(stale),
                "",
                "A stale cache usually means the guard blocked the save. Check that run's log,",
                "then either let the two-run confirmation accept the new baseline next week or",
                "re-run the carrier's workflow with `force_save` enabled.",
            ]
        try:
            with open(summary_path, "a", encoding="utf-8") as handle:
                handle.write("\n".join(lines) + "\n")
        except Exception as exc:
            print(f"  WARNING: could not write step summary: {exc}")

    if stale:
        print()
        print(f"::error::{len(stale)} stale carrier cache(s): {', '.join(stale)}")
        return 1

    print()
    print(f"All {len(rows)} carrier caches are within {args.max_age_days:.0f} days.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
