"""
Shared helpers for the nationwide carrier fetchers.

Every fetcher writes data/<carrier>_all_locations.json with the same record
shape, so scripts/build_data.py can treat all carriers alike:

    {
      "id":            carrier-specific id (string),
      "locatieNaam":   name of the point (shop name, locker name),
      "straatNaam":    street (may already include the number),
      "straatNr":      house number, or "",
      "cap":           postcode, or "",
      "citta":         town as the carrier spells it, or "",
      "latitude":      float (WGS84),
      "longitude":     float (WGS84),
      "puntType":      "locker" | "pickup_point" | "post_office",
      "canPickup":     bool,
      "canDropoff":    bool,
      "openingstijden": {"mon": "09:00 - 19:30", ...} | str | None
    }

The property names are kept from the Dutch original (pakketpunten.nl) and the
Italian port (cap, citta) so the webapp and the public API stay compatible.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"

sys.path.insert(0, str(Path(__file__).resolve().parent))
from cache_guard import safe_save  # noqa: E402

ISO2 = "DE"
ISO_NUMERIC = 276

# (south, west, north, east): Germany incl. the North Sea and Baltic islands.
# Border strips of the neighbours fall inside; build_data.py drops every point
# that does not land in a German Gemeinde.
GERMANY_BOUNDS = (47.20, 5.80, 55.10, 15.10)

# Day keys, Monday first. Mirrors DAY_KEYS in webapp/utils/openingHoursUtils.ts
# (the UI translates them).
DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
CLOSED = "closed"

USER_AGENT = "paketstationen-deutschland/1.0 (oeffentliche Karte der Paketabholstellen)"

POINT_TYPES = ("locker", "pickup_point", "post_office")


def in_germany_bbox(lat: Optional[float], lon: Optional[float]) -> bool:
    if lat is None or lon is None:
        return False
    south, west, north, east = GERMANY_BOUNDS
    return south <= lat <= north and west <= lon <= east


def minutes_to_hhmm(value: Any) -> Optional[str]:
    """480 -> '08:00'. Accepts ints (minutes) or 'HH:MM[:SS...]' strings."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        minutes = int(value)
        if minutes >= 1439:
            minutes = 1440
        return f"{minutes // 60:02d}:{minutes % 60:02d}"
    text = str(value).strip()
    if len(text) >= 5 and text[2] == ":":
        return text[:5]
    return None


def windows_to_text(windows: Iterable[tuple]) -> str:
    """[('09:00','13:00'), ('15:00','19:00')] -> '09:00 - 13:00, 15:00 - 19:00'."""
    parts = [f"{start} - {end}" for start, end in windows if start and end]
    return ", ".join(parts) if parts else CLOSED


def make_record(
    *,
    id: Any,
    name: str,
    lat: Any,
    lon: Any,
    punt_type: str,
    street: str = "",
    number: str = "",
    cap: str = "",
    city: str = "",
    can_pickup: bool = True,
    can_dropoff: bool = True,
    hours: Any = None,
) -> Optional[Dict[str, Any]]:
    """Build one normalised record, or None when the coordinates are unusable."""
    try:
        lat_f = round(float(lat), 7)
        lon_f = round(float(lon), 7)
    except (TypeError, ValueError):
        return None
    if not in_germany_bbox(lat_f, lon_f):
        return None
    if punt_type not in POINT_TYPES:
        raise ValueError(f"unknown puntType {punt_type!r}")

    return {
        "id": str(id) if id is not None else "",
        "locatieNaam": (name or "").strip(),
        "straatNaam": (street or "").strip(),
        "straatNr": (str(number) if number is not None else "").strip(),
        "cap": (str(cap) if cap is not None else "").strip(),
        "citta": (city or "").strip(),
        "latitude": lat_f,
        "longitude": lon_f,
        "puntType": punt_type,
        "canPickup": bool(can_pickup),
        "canDropoff": bool(can_dropoff),
        "openingstijden": hours or None,
    }


def dedupe(records: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Drop repeated ids (grid searches overlap), keeping the first."""
    seen = set()
    unique = []
    for record in records:
        key = record["id"] or (record["latitude"], record["longitude"], record["locatieNaam"])
        if key in seen:
            continue
        seen.add(key)
        unique.append(record)
    return unique


def summarise(carrier: str, records: List[Dict[str, Any]]) -> None:
    by_type: Dict[str, int] = {}
    for record in records:
        by_type[record["puntType"]] = by_type.get(record["puntType"], 0) + 1
    print(f"\n📦 {carrier}: {len(records)} points")
    for punt_type, count in sorted(by_type.items(), key=lambda item: -item[1]):
        print(f"   {punt_type:16s} {count:6d}")


def save(carrier: str, cache_stem: str, records: List[Dict[str, Any]], source: str, method: str) -> None:
    """Save through the cache guard (exits 2 on an anomalous drop)."""
    summarise(carrier, records)
    safe_save(
        carrier=carrier,
        new_locations=records,
        output_path=DATA_DIR / f"{cache_stem}_all_locations.json",
        metadata={"carrier": carrier, "country": ISO2, "source": source, "method": method},
    )


def grid_cells(spacing_km: float, bounds=GERMANY_BOUNDS):
    """Centre points of a regular grid over `bounds`, `spacing_km` apart."""
    import math

    south, west, north, east = bounds
    lat_step = spacing_km / 111.0
    lat = south + lat_step / 2
    while lat < north:
        lon_step = spacing_km / (111.320 * math.cos(math.radians(lat)))
        lon = west + lon_step / 2
        while lon < east:
            yield round(lat, 5), round(lon, 5)
            lon += lon_step
        lat += lat_step


def land_filter():
    """
    Predicate: is a (lat, lon) grid cell centre within ~radius of German land?

    Uses data/territorium/deutschland_outline.geojson (scripts/prepare_territorium.py)
    so grid fetchers skip the part of the bounding box that is sea or abroad.
    Falls back to "everything" when the outline is not there yet.
    """
    import json

    outline_file = DATA_DIR / "territorium" / "deutschland_outline.geojson"
    if not outline_file.exists():
        print("   ⚠️  deutschland_outline.geojson missing: grid over the whole bounding box")
        return lambda lat, lon, radius_km=0: True

    from shapely.geometry import Point, shape
    from shapely.prepared import prep

    with open(outline_file, encoding="utf-8") as handle:
        geometry = shape(json.load(handle)["features"][0]["geometry"])
    prepared = prep(geometry)
    cache: Dict[float, Any] = {}

    def near_land(lat: float, lon: float, radius_km: float = 0) -> bool:
        if radius_km <= 0:
            return prepared.contains(Point(lon, lat))
        degrees = round(radius_km / 111.0, 3)
        if degrees not in cache:
            cache[degrees] = prep(geometry.buffer(degrees))
        return cache[degrees].contains(Point(lon, lat))

    return near_land


def week_from(windows_by_day: Dict[int, List[tuple]]) -> Optional[Dict[str, str]]:
    """
    {0: [('09:00','13:00')], ...} (0 = Monday) -> {'mon': '09:00 - 13:00', ...}.

    Days without windows read 'closed'. None when no day has any window,
    because "closed all week" is far more often missing data than a fact.
    """
    if not any(windows_by_day.values()):
        return None
    return {key: windows_to_text(windows_by_day.get(i, [])) for i, key in enumerate(DAY_KEYS)}


def crawl_cells(search, start_km: float, cap: int, min_km: float = 0.5,
                workers: int = 1, label: str = "", full=None) -> List[Dict[str, Any]]:
    """
    Adaptive square-cell crawl for "nearest N points" style APIs.

    Each cell of side s is searched from its centre with radius 0.75·s, which
    reaches its corners (0.707·s). When a search returns `cap` results the cell
    may hide more, so it is split in four. `search(lat, lon, radius_m)` returns
    a list of raw items; duplicates across cells are removed by the caller.
    `full(items, radius_m)` overrides the "may hide more" test, for APIs that
    always return the nearest N whatever the radius (split only when the N-th
    is still inside the cell's reach).
    """
    import math
    from concurrent.futures import ThreadPoolExecutor

    near_land = land_filter()
    queue = [
        (lat, lon, start_km)
        for lat, lon in grid_cells(start_km)
        if near_land(lat, lon, start_km * 0.75)
    ]
    print(f"   {label}: {len(queue)} initial cells of {start_km:g} km")
    results: List[Dict[str, Any]] = []
    calls = 0

    def run(cell):
        lat, lon, side = cell
        return cell, search(lat, lon, int(side * 0.75 * 1000))

    with ThreadPoolExecutor(max_workers=workers) as pool:
        while queue:
            batch, queue = queue, []
            for (lat, lon, side), items in pool.map(run, batch):
                calls += 1
                results.extend(items)
                hides_more = full(items, side * 0.75 * 1000) if full else len(items) >= cap
                if hides_more and side / 2 >= min_km:
                    half = side / 2
                    dlat = half / 2 / 111.0
                    dlon = half / 2 / (111.320 * math.cos(math.radians(lat)))
                    queue += [(lat + a * dlat, lon + b * dlon, half) for a in (-1, 1) for b in (-1, 1)]
            if queue:
                print(f"   {label}: {calls} calls, {len(results)} raw results, {len(queue)} cells split")
    print(f"   {label}: {calls} calls in total")
    return results


def get_json(session, url: str, params=None, attempts: int = 4, delay: float = 0.0, **kwargs):
    """GET with retries and exponential backoff; None after the last failure."""
    import time

    timeout = kwargs.pop("timeout", 40)
    for attempt in range(attempts):
        if delay:
            time.sleep(delay)
        try:
            response = session.get(url, params=params, timeout=timeout, **kwargs)
            if response.status_code in (429, 500, 502, 503, 504):
                raise RuntimeError(f"HTTP {response.status_code}")
            response.raise_for_status()
            return response.json()
        except Exception as error:  # noqa: BLE001 - network code, retried
            wait = 2 ** attempt * 2
            if attempt == attempts - 1:
                print(f"   ⚠️  {url} {params}: {error}")
                return None
            time.sleep(wait)
    return None
