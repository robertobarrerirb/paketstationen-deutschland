"""
Fetch all FedEx locations (FedEx OnSite shops, Authorized ShipCenters,
stations) in Germany.

API: GET https://local.fedex.com/en/search?q=<lat>,<lon>&r=<km>&per=50&offset=N
     The Yext search behind FedEx's location pages; answers JSON with
     "Accept: application/json", no key. The search is worldwide (the
     country only follows from each result). At most 50 per page, and a
     query counts at most 10,000 results.

Strategy: circles of 100 km on a 140 km grid (so they overlap and cover the
bbox), each paged until its count; dedupe on id, keep this country's points.

Usage:
    python scripts/fetch_fedex.py
"""

import math
import re
import sys
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import GERMANY_BOUNDS, ISO2, USER_AGENT, CLOSED, land_filter, make_record, save  # noqa: E402

SEARCH_URL = "https://local.fedex.com/en/search"
RADIUS_KM = 100
SPACING_KM = 140
PAGE_SIZE = 50
QUERY_CAP = 10_000
# Three parallel callers drew HTTP 429 after ~1,000 calls and a block of
# several minutes; one at a time with a pause stays under the limit
WORKERS = 1
REQUEST_DELAY = 1.0
MAX_ATTEMPTS = 6

HEADERS = {"Accept": "application/json", "User-Agent": USER_AGENT}
DAYS = {"MONDAY": "mon", "TUESDAY": "tue", "WEDNESDAY": "wed", "THURSDAY": "thu", "FRIDAY": "fri", "SATURDAY": "sat", "SUNDAY": "sun"}
# Not a place to hand in or collect a parcel
SKIP_NAMES = ("Air Freight", "Freight Center")


def search(lat, lon, offset):
    params = {"q": f"{lat:.4f},{lon:.4f}", "r": RADIUS_KM, "per": PAGE_SIZE, "offset": offset}
    for attempt in range(MAX_ATTEMPTS):
        time.sleep(REQUEST_DELAY)
        try:
            resp = requests.get(SEARCH_URL, params=params, headers=HEADERS, timeout=30)
            resp.raise_for_status()
            return resp.json()["response"]
        except (requests.RequestException, ValueError, KeyError) as e:
            if attempt == MAX_ATTEMPTS - 1:
                raise RuntimeError(f"{lat:.2f},{lon:.2f} offset {offset}: {e}")
            # 30 s up to 8 min: a 429 blocks the whole IP for minutes
            time.sleep(30 * 2 ** attempt)


def fetch_circle(center):
    lat, lon = center
    first = search(lat, lon, 0)
    count = first.get("count", 0)
    if count >= QUERY_CAP:
        raise RuntimeError(f"{lat:.2f},{lon:.2f}: {count} results, above the query cap; lower RADIUS_KM")
    entities = list(first.get("entities") or [])
    for offset in range(PAGE_SIZE, count, PAGE_SIZE):
        entities += search(lat, lon, offset).get("entities") or []
    return entities


def circle_centers():
    south, west, north, east = GERMANY_BOUNDS
    near_land = land_filter()
    dlat = SPACING_KM / 111.32
    centers = []
    lat = south + dlat / 2
    while lat - dlat / 2 < north:
        dlon = SPACING_KM / (111.32 * math.cos(math.radians(lat)))
        lon = west + dlon / 2
        while lon - dlon / 2 < east:
            if near_land(lat, lon, RADIUS_KM):
                centers.append((lat, lon))
            lon += dlon
        lat += dlat
    return centers


def opening_hours(profile):
    week = {}
    for day in (profile.get("hours") or {}).get("normalHours") or []:
        key = DAYS.get(day.get("day"))
        if not key:
            continue
        if day.get("isClosed") or not day.get("intervals"):
            week[key] = CLOSED
            continue
        week[key] = ", ".join(
            f"{i['start'] // 100:02d}:{i['start'] % 100:02d} - {i['end'] // 100:02d}:{i['end'] % 100:02d}"
            for i in day["intervals"]
        )
    return week or None


def always_open(week):
    """Open 24 hours every day: a "FedEx OnSite" point open round the clock is a parcel
    locker (in Germany mostly myflexbox stations, e.g. "myflexbox Paketstation (Lidl …)"),
    not a shop."""
    if not week or len(week) < 7:
        return False
    return all(v in ("00:00 - 23:59", "00:00 - 24:00") for v in week.values())


def normalize(entity):
    profile = entity["profile"]
    coords = profile.get("yextDisplayCoordinate") or profile.get("displayCoordinate")
    address = profile.get("address") or {}
    if address.get("countryCode") != ISO2:
        return None
    hours = opening_hours(profile)
    return make_record(
        id=f"fedex-{profile['meta']['id']}",
        name=profile.get("c_locationName") or profile.get("name", ""),
        lat=coords["lat"],
        lon=coords["long"],
        punt_type="locker" if (always_open(hours) or re.search(r"paketstation|locker|flexbox", str(profile.get("c_locationName") or profile.get("name", "")), re.I)) else "pickup_point",
        street=address.get("line1") or "",
        cap=address.get("postalCode", ""),
        city=address.get("city", ""),
        hours=hours,
    )


def main():
    print("=" * 80)
    print("FEDEX COMPLETE LOCATION FETCH")
    print("=" * 80)
    print(f"Time: {datetime.now():%Y-%m-%d %H:%M:%S}")

    centers = circle_centers()
    print(f"📍 {len(centers)} circles of {RADIUS_KM} km, {WORKERS} parallel\n")

    found = {}
    try:
        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            for entities in pool.map(fetch_circle, centers):
                for entity in entities:
                    found[entity["profile"]["meta"]["id"]] = entity
    except RuntimeError as e:
        print(f"❌ Search failed ({e}); cache not updated")
        return 1

    locations = []
    for entity in found.values():
        try:
            loc = normalize(entity)
        except (KeyError, TypeError, ValueError):
            continue
        if loc is None or any(s in loc["locatieNaam"] for s in SKIP_NAMES):
            continue
        locations.append(loc)

    print(f"✅ {len(locations)} FedEx locations")
    for name, count in Counter(loc["locatieNaam"] for loc in locations).most_common(6):
        print(f"   {name:35s}: {count:6d}")

    if not locations:
        print("❌ No locations fetched")
        return 1

    save("FedEx", "fedex", locations, SEARCH_URL, "griglia-raggio")
    return 0


if __name__ == "__main__":
    sys.exit(main())
