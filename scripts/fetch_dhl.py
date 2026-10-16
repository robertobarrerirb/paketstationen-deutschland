"""
Deutsche Post / DHL in Germany: Packstationen and Poststationen (lockers), Postfilialen
and DHL Paketshops, with an adaptive grid. Two sources, tried in order:

1. DHL Parcel's public API, no key:
       GET https://api-gw.dhlparcel.nl/parcel-shop-locations/DE/by-geo
           ?latitude=..&longitude=..&radius=<m>&limit=50
   It answers for France (fetch_dhl.py of the French version); for Germany it is
   probed first on Bonn and used only if it returns German points.
2. DHL Location Finder - Unified API (developer.dhl.com), with a free key in the
   environment variable DHL_API_KEY (GitHub secret of the same name):
       GET https://api.dhl.com/location-finder/v1/find-by-geo
           ?countryCode=DE&latitude=..&longitude=..&radius=<m, max 25000>&limit=50
   location.type: locker (Packstation / Poststation), postoffice / postbank
   (Postfiliale), servicepoint (Paketshop).

Without either, the step fails and DHL keeps its OpenStreetMap cache (fetch_osm.py).

    python scripts/fetch_dhl.py
"""

import os
import sys
import time
from collections import Counter

import requests

from common import USER_AGENT, crawl_cells, dedupe, get_json, make_record, save, week_from

PARCEL_URL = "https://api-gw.dhlparcel.nl/parcel-shop-locations/DE/by-geo"
UNIFIED_URL = "https://api.dhl.com/location-finder/v1/find-by-geo"
API_KEY = os.environ.get("DHL_API_KEY", "").strip()
LIMIT = 50
DAYS = {"monday": 0, "tuesday": 1, "wednesday": 2, "thursday": 3, "friday": 4, "saturday": 5, "sunday": 6}
LOCKER_WORDS = ("packstation", "poststation", "locker")


# --------------------------------------------------------------------- DHL Parcel API

def parcel_hours(opening_times):
    """[{weekDay: 1=Mon..7=Sun, timeFrom, timeTo}]"""
    by_day = {i: [] for i in range(7)}
    for entry in opening_times or []:
        day = entry.get("weekDay")
        if isinstance(day, int) and 1 <= day <= 7 and entry.get("timeFrom") and entry.get("timeTo"):
            by_day[day - 1].append((entry["timeFrom"][:5], entry["timeTo"][:5]))
    return week_from(by_day)


def parcel_search(session):
    def search(lat, lon, radius_m):
        data = get_json(session, PARCEL_URL, params={"latitude": lat, "longitude": lon,
                                                     "radius": radius_m, "limit": LIMIT}, delay=0.25)
        if isinstance(data, dict):
            data = data.get("results") or data.get("items") or []
        return data or []
    return search


def parcel_record(item):
    address = item.get("address") or {}
    geo = item.get("geoLocation") or {}
    if (address.get("countryCode") or "DE") != "DE":
        return None
    shop_type = str(item.get("shopType") or "").lower()
    name = (item.get("name") or item.get("keyword") or "").strip()
    if any(w in shop_type or w in name.lower() for w in LOCKER_WORDS):
        kind = "locker"
    elif "postoffice" in shop_type or "filiale" in name.lower():
        kind = "post_office"
    else:
        kind = "pickup_point"
    services = item.get("serviceTypes") or []
    return make_record(
        id=item.get("id"),
        name=name or "DHL Paketshop",
        lat=geo.get("latitude"),
        lon=geo.get("longitude"),
        punt_type=kind,
        street=address.get("street", ""),
        number=address.get("number", ""),
        cap=address.get("zipCode") or address.get("postalCode") or "",
        city=address.get("city") or "",
        can_pickup=True,
        can_dropoff=(not services) or any("first-mile" in s or "return" in s for s in services),
        hours=parcel_hours(item.get("openingTimes")),
    )


# ------------------------------------------------------------- Location Finder (key)

class QuotaExceeded(RuntimeError):
    pass


def unified_search(session):
    def search(lat, lon, radius_m):
        params = {"countryCode": "DE", "latitude": f"{lat:.5f}", "longitude": f"{lon:.5f}",
                  "radius": min(radius_m, 25000), "limit": LIMIT}
        for attempt in range(5):
            time.sleep(1.0)
            try:
                response = session.get(UNIFIED_URL, params=params, timeout=40)
                if response.status_code in (401, 403):
                    raise SystemExit(f"❌ HTTP {response.status_code}: DHL_API_KEY non valida")
                if response.status_code == 429:
                    if "day" in response.text.lower() or "quota" in response.text.lower():
                        raise QuotaExceeded(response.text[:200])
                    raise RuntimeError("HTTP 429")
                if response.status_code == 404:
                    return []  # nothing within the radius
                response.raise_for_status()
                return response.json().get("locations") or []
            except (SystemExit, QuotaExceeded):
                raise
            except Exception as error:  # noqa: BLE001 - network code, retried
                if attempt == 4:
                    print(f"   ⚠️  {lat:.4f},{lon:.4f}: {error}")
                    return []
                time.sleep(2 ** attempt * 5)
        return []
    return search


def unified_hours(entries):
    by_day = {i: [] for i in range(7)}
    for entry in entries or []:
        day = DAYS.get(str(entry.get("dayOfWeek") or "").rsplit("/", 1)[-1].lower())
        if day is not None and entry.get("opens") and entry.get("closes"):
            closes = entry["closes"][:5]
            by_day[day].append((entry["opens"][:5], "24:00" if closes == "23:59" else closes))
    return week_from(by_day)


def unified_record(item):
    place = item.get("place") or {}
    address = place.get("address") or {}
    geo = place.get("geo") or {}
    if (address.get("countryCode") or "DE") != "DE":
        return None
    location = item.get("location") or {}
    kind_raw = str(location.get("type") or "").lower()
    name = (item.get("name") or "").strip()
    if kind_raw == "locker" or any(w in name.lower() for w in LOCKER_WORDS):
        kind = "locker"
    elif kind_raw in ("postoffice", "postbank"):
        kind = "post_office"
    else:
        kind = "pickup_point"
    ids = location.get("ids") or [{}]
    services = item.get("serviceTypes") or []
    return make_record(
        id=ids[0].get("locationId") or item.get("url", "").rsplit("/", 1)[-1],
        name=name or ("Packstation" if kind == "locker" else "DHL Paketshop"),
        lat=geo.get("latitude"),
        lon=geo.get("longitude"),
        punt_type=kind,
        street=address.get("streetAddress", ""),
        cap=address.get("postalCode", ""),
        city=address.get("addressLocality", ""),
        can_pickup=(not services) or any("pick-up" in s for s in services),
        can_dropoff=(not services) or any("drop-off" in s or "parcel:drop" in s for s in services),
        hours=unified_hours(item.get("openingHours")),
    )


# ------------------------------------------------------------------------------ main

def main():
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT, "Accept": "application/json"})

    probe = parcel_search(session)(50.7374, 7.0982, 3000)  # Bonn, DHL's home town
    german = [x for x in probe if ((x.get("address") or {}).get("countryCode") or "") == "DE"]
    print(f"🔎 DHL Parcel API su Bonn: {len(probe)} risultati, {len(german)} tedeschi")

    if german:
        print("📡 DHL Germania dall'API pubblica di DHL Parcel (griglia adattiva, max 50 per chiamata)")
        raw = crawl_cells(parcel_search(session), start_km=24, cap=LIMIT, min_km=0.5, workers=3, label="DHL")
        records, source, method = [parcel_record(x) for x in raw], PARCEL_URL, "api-adaptive-grid"
    elif API_KEY:
        print("📡 DHL Germania dal Location Finder Unified API (chiave DHL_API_KEY, una chiamata al secondo)")
        session.headers["DHL-API-Key"] = API_KEY
        try:
            raw = crawl_cells(unified_search(session), start_km=24, cap=LIMIT, min_km=0.5, workers=1, label="DHL")
        except QuotaExceeded as error:
            print(f"❌ quota giornaliera del Location Finder esaurita ({error}): cache invariata")
            return 1
        records, source, method = [unified_record(x) for x in raw], UNIFIED_URL, "location-finder-adaptive-grid"
    else:
        print("❌ L'API di DHL Parcel non dà punti tedeschi e manca DHL_API_KEY "
              "(chiave gratuita su developer.dhl.com, Location Finder - Unified): resta la cache OSM")
        return 1

    records = dedupe([r for r in records if r])
    print("   tipi:", dict(Counter(r["puntType"] for r in records)))
    save("DHL", "dhl", records, source, method)
    return 0


if __name__ == "__main__":
    sys.exit(main())
