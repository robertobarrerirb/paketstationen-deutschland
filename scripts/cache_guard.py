"""
Cache guard utility for carrier data fetches.

Compares newly fetched location counts against the existing cache. A drop
beyond THRESHOLD_PCT is not trusted on sight: the existing cache is preserved
and the script exits with EXIT_CODE_ANOMALY so the workflow can flag it.

The guard is self-healing. Blocking forever would freeze a cache whenever a
carrier genuinely shrinks -- which is exactly what happened to Amazon, stuck
for eight weeks against a 2180 baseline while every run since fetched ~1200.
So each run's count is appended to data/fetch_history.json, and a large drop
that *repeats* on the next run (within CONFIRM_TOLERANCE_PCT) is accepted as
the new baseline. One-off blips stay blocked; sustained change gets through
after two runs.

Set CACHE_GUARD_FORCE=1 to accept a new baseline immediately, for when you
have already investigated and want to skip the two-run wait.

Usage in fetch scripts:
    from cache_guard import safe_save

    safe_save(
        carrier="DHL",
        new_locations=locations_list,
        output_path=output_path,
        metadata={...},
    )

Exit codes:
    0 = success (data saved)
    2 = data anomaly detected, existing cache preserved
"""

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

# Exit code that signals "anomaly detected, cache preserved"
EXIT_CODE_ANOMALY = 2

# A fetch may shrink this much before the guard wants a second opinion.
THRESHOLD_PCT = 20

# Two consecutive blocked runs this close together mean the drop is real
# rather than a blip, so the lower count becomes the new baseline. Weekly
# runs normally drift 1-3%, so 5% confirms without rubber-stamping a slide.
CONFIRM_TOLERANCE_PCT = 5

# Per-carrier count history, committed to the repo so it survives the runner.
HISTORY_PATH = Path(__file__).parent.parent / "data" / "fetch_history.json"

# Entries kept per carrier. Only the last one drives a decision; the rest are
# there to make a stuck cache obvious when reading the file by hand.
MAX_HISTORY = 8



def write_cache(f, output):
    """{"metadata": ..., "locations": [...]} with one location per line."""
    f.write('{"metadata": ' + json.dumps(output["metadata"], ensure_ascii=False) + ',\n"locations": [\n')
    f.write(",\n".join(json.dumps(loc, ensure_ascii=False, separators=(",", ":")) for loc in output["locations"]))
    f.write("\n]}\n")

def _is_forced() -> bool:
    """True when CACHE_GUARD_FORCE asks the guard to stand down."""
    return os.environ.get("CACHE_GUARD_FORCE", "").strip().lower() in {"1", "true", "yes"}


def _load_existing_count(cache_path: Path) -> Optional[int]:
    """Read the location count from an existing cache file."""
    if not cache_path.exists():
        return None
    try:
        with open(cache_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        locations = data.get('locations', [])
        return len(locations)
    except Exception:
        return None


def _load_history() -> Dict[str, Any]:
    """Read the count history, treating any damage as 'no history'."""
    if not HISTORY_PATH.exists():
        return {}
    try:
        with open(HISTORY_PATH, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _record_run(carrier: str, count: int, saved: bool) -> None:
    """
    Append this run to the carrier's history.

    Called on every outcome, including a blocked save -- the blocked entry is
    what the next run confirms against, so losing it would keep the cache
    frozen forever.
    """
    history = _load_history()
    entry = history.setdefault(carrier, {})
    runs = entry.get("runs")
    if not isinstance(runs, list):
        runs = []

    runs.append({
        "at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "count": count,
        "saved": saved,
    })
    entry["runs"] = runs[-MAX_HISTORY:]

    try:
        HISTORY_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(HISTORY_PATH, 'w', encoding='utf-8') as f:
            json.dump(history, f, indent=2, ensure_ascii=False, sort_keys=True)
            f.write("\n")
    except Exception as exc:
        # Bookkeeping must never sink an otherwise good fetch.
        print(f"  WARNING: could not write {HISTORY_PATH.name}: {exc}")


def _blocked_previous_count(carrier: str) -> Optional[int]:
    """
    The count of the immediately preceding run, if that run was blocked.

    Deliberately only the last entry: two *consecutive* blocked runs agreeing
    is the signal. An older blocked count that happens to match would confirm
    across an unrelated recovery.
    """
    runs = _load_history().get(carrier, {}).get("runs") or []
    if not runs:
        return None
    last = runs[-1]
    if last.get("saved"):
        return None
    count = last.get("count")
    return count if isinstance(count, int) and count > 0 else None


def safe_save(
    carrier: str,
    new_locations: List[Dict[str, Any]],
    output_path: Path,
    metadata: Dict[str, Any],
) -> bool:
    """
    Save fetched locations to cache, with a guard against anomalous drops.

    A drop beyond THRESHOLD_PCT is blocked unless the previous run was blocked
    at a comparable count (the drop is confirmed), or CACHE_GUARD_FORCE is set.

    Returns True if data was saved; otherwise exits with EXIT_CODE_ANOMALY.
    """
    output_path = Path(output_path)
    new_count = len(new_locations)
    old_count = _load_existing_count(output_path)

    # Zero results: never overwrite, and never confirmable. A carrier that
    # returns nothing twice is a broken fetch, not a carrier that closed every
    # location, so CACHE_GUARD_FORCE does not override this either.
    if new_count == 0:
        print()
        print(f"WARNING: {carrier} fetched 0 locations.")
        if old_count and old_count > 0:
            print(f"Keeping existing cache ({old_count} locations) to prevent data loss.")
        else:
            print("No existing cache to preserve.")
        print()
        _record_run(carrier, new_count, saved=False)
        sys.exit(EXIT_CODE_ANOMALY)

    drop_pct: Optional[float] = None
    if old_count is not None and old_count > 0:
        drop_pct = ((old_count - new_count) / old_count) * 100

    if drop_pct is not None and drop_pct > THRESHOLD_PCT:
        previous = _blocked_previous_count(carrier)
        delta_pct = (
            abs(new_count - previous) / previous * 100
            if previous is not None
            else None
        )
        confirmed = delta_pct is not None and delta_pct <= CONFIRM_TOLERANCE_PCT

        print()
        print("=" * 80)
        print(f"LARGE DROP: {carrier}")
        print("=" * 80)
        print(f"  Existing cache: {old_count} locations")
        print(f"  New fetch:      {new_count} locations")
        print(f"  Change:         {-drop_pct:.1f}% (threshold: -{THRESHOLD_PCT}%)")

        if _is_forced():
            print()
            print("CACHE_GUARD_FORCE is set: accepting this count as the new baseline.")
            print("=" * 80)
        elif confirmed:
            print()
            print(f"Previous run was blocked at {previous} locations "
                  f"({delta_pct:.1f}% from this run, tolerance {CONFIRM_TOLERANCE_PCT}%).")
            print("Two runs agree, so the drop is real. Accepting as the new baseline.")
            print("=" * 80)
        else:
            print()
            if previous is None:
                print("First run at this level -- not saving yet.")
                print(f"If next week lands within {CONFIRM_TOLERANCE_PCT}% of "
                      f"{new_count}, it will be accepted automatically.")
            else:
                print(f"Previous blocked run was {previous} locations "
                      f"({delta_pct:.1f}% away, tolerance {CONFIRM_TOLERANCE_PCT}%).")
                print("The count is still moving, so this is not a confirmed baseline.")
            print()
            print("Keeping existing cache to prevent data loss.")
            print(f"Investigate the {carrier} source, or re-run with "
                  f"CACHE_GUARD_FORCE=1 to accept {new_count} now.")
            print("=" * 80)
            _record_run(carrier, new_count, saved=False)
            sys.exit(EXIT_CODE_ANOMALY)

    elif drop_pct is not None and abs(drop_pct) > 5:
        # Log the change (informational)
        direction = "decrease" if drop_pct > 0 else "increase"
        print(f"  ℹ️  {carrier}: {abs(drop_pct):.1f}% {direction} ({old_count} → {new_count})")

    # Add standard metadata fields
    metadata["total_locations"] = new_count
    if "fetched_at" not in metadata:
        metadata["fetched_at"] = datetime.now(timezone.utc).isoformat()

    output = {
        "metadata": metadata,
        "locations": new_locations,
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    # One record per line: compact (indent=2 made DHL's cache ~22 MB) but still
    # a readable, line-based git diff
    with open(output_path, 'w', encoding='utf-8') as f:
        write_cache(f, output)

    file_size_kb = output_path.stat().st_size / 1024
    print(f"💾 Saved to: {output_path}")
    print(f"   File size: {file_size_kb:.1f} KB")
    print(f"   Locations: {new_count}")

    _record_run(carrier, new_count, saved=True)

    return True
