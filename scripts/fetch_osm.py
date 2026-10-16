"""
Every network from OpenStreetMap (Overpass API): the fallback for the networks
that have no direct source yet.

Germany is mapped very well in OSM: DHL Packstationen and Poststationen
(amenity=parcel_locker), Postfilialen (amenity=post_office) and the partner shops of
DHL, Hermes, DPD, GLS, UPS (post_office=post_partner with post_office:brand=*),
open lockers (myflexbox, DeinFach, Parcelly), Amazon Lockers, Nova Post and
Mail Boxes Etc. A point is listed under every network found in its brand,
operator or post_office:brand.

A network whose cache came from a direct source (metadata.method other than
"osm-overpass") is never overwritten here; OSM_SKIP=Rete,... skips more.

Data © OpenStreetMap contributors, ODbL: the webapp says so. Coverage depends
on the OSM community: from OSM, a network's count is a minimum, not its size.

    python scripts/fetch_osm.py
"""

from __future__ import annotations

import re
import sys
import time

import requests

from common import CLOSED, DAY_KEYS, USER_AGENT, dedupe, make_record, save

ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]

QUERY = """
[out:json][timeout:900][bbox:47.20,5.80,55.10,15.10];
area["ISO3166-1"="DE"][admin_level=2]->.de;
(
  nwr["amenity"="post_office"](area.de);
  nwr["amenity"="parcel_locker"](area.de);
  nwr["amenity"="post_partner"](area.de);
  nwr["post_office"](area.de);
  nwr["post_office:brand"](area.de);
  nwr["brand"~"Mail Boxes|Nova Post|Nova Poshta|Parcelly|myflexbox|DeinFach",i](area.de);
);
out center tags;
"""

# Order = CARRIERS in build_data.py. Matched on brand / operator / post_office:brand / network
# (and the name for lockers and shops whose name is the network's).
NETWORKS = (
    ("DHL", re.compile(r"\bdhl\b|deutsche\s*post|packstation|poststation|postfiliale", re.I)),
    ("Hermes", re.compile(r"\bhermes\b", re.I)),
    ("DPD", re.compile(r"\bdpd\b", re.I)),
    ("GLS", re.compile(r"\bgls\b", re.I)),
    ("UPS", re.compile(r"\bups\b", re.I)),
    ("Amazon", re.compile(r"\bamazon\b", re.I)),
    ("FedEx", re.compile(r"\bfedex\b", re.I)),
    ("myflexbox", re.compile(r"my\s*flex\s*box", re.I)),
    ("DeinFach", re.compile(r"dein\s*fach", re.I)),
    ("MBE", re.compile(r"mail\s*boxes\s*etc|\bmbe\b", re.I)),
    ("NovaPost", re.compile(r"nova\s*post|nova\s*poshta|нова\s*пошта", re.I)),
    ("Parcelly", re.compile(r"parcelly", re.I)),
)
FILIALE = re.compile(r"filiale|postfiliale|post\s*office|postamt", re.I)

DAYS_OSM = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]

DEFAULT_NAMES = {
    ("DHL", "post_office"): "Postfiliale",
    ("DHL", "pickup_point"): "DHL Paketshop",
    ("DHL", "locker"): "DHL Packstation",
    ("Hermes", "pickup_point"): "Hermes PaketShop",
    ("Hermes", "locker"): "Hermes Paketstation",
    ("DPD", "pickup_point"): "DPD Pickup Paketshop",
    ("DPD", "locker"): "DPD Pickup Station",
    ("GLS", "pickup_point"): "GLS PaketShop",
    ("GLS", "locker"): "GLS Paketstation",
    ("UPS", "pickup_point"): "UPS Access Point",
    ("UPS", "locker"): "UPS Access Point Locker",
    ("Amazon", "pickup_point"): "Amazon Counter",
    ("Amazon", "locker"): "Amazon Locker",
    ("FedEx", "pickup_point"): "FedEx OnSite",
    ("myflexbox", "locker"): "myflexbox Paketstation",
    ("DeinFach", "locker"): "DeinFach Paketstation",
    ("MBE", "pickup_point"): "Mail Boxes Etc.",
    ("NovaPost", "pickup_point"): "Nova Post",
    ("NovaPost", "post_office"): "Nova Post",
    ("NovaPost", "locker"): "Nova Post Paketautomat",
    ("Parcelly", "pickup_point"): "Parcelly",
    ("Parcelly", "locker"): "Parcelly Station",
}
STEMS = {"DHL": "dhl", "Hermes": "hermes", "DPD": "dpd", "GLS": "gls", "UPS": "ups", "Amazon": "amazon",
         "FedEx": "fedex", "myflexbox": "myflexbox", "DeinFach": "deinfach", "MBE": "mbe",
         "NovaPost": "novapost", "Parcelly": "parcelly"}


def overpass() -> list[dict]:
    for endpoint in ENDPOINTS:
        for attempt in range(3):
            try:
                print(f"   → {endpoint} (attempt {attempt + 1})")
                response = requests.post(endpoint, data={"data": QUERY}, timeout=600,
                                         headers={"User-Agent": USER_AGENT})
                if response.status_code in (429, 504):
                    raise RuntimeError(f"HTTP {response.status_code}")
                response.raise_for_status()
                elements = response.json().get("elements", [])
                if elements:
                    return elements
                raise RuntimeError("empty answer")
            except Exception as error:  # noqa: BLE001
                print(f"   ⚠️  {error}")
                time.sleep(30 * (attempt + 1))
    return []


def parse_opening_hours(value: str | None):
    """Never fails: unusual OSM syntax falls back to the raw string."""
    try:
        return _parse_opening_hours(value)
    except (ValueError, IndexError):
        return value or None


def _parse_opening_hours(value: str | None):
    """
    Common OSM opening_hours forms -> {'mon': '08:20 - 13:35', ...}.

    Handles "Mo-Fr 08:20-13:35; Sa 08:20-12:35" and comma lists of days. Any
    rule it does not understand (PH, months, "off" exceptions ...) is ignored;
    when nothing is understood the raw string is kept for display.
    """
    if not value:
        return None
    if value.strip() == "24/7":
        return {k: "00:00 - 24:00" for k in DAY_KEYS}
    week: dict[int, list[tuple[str, str]]] = {}
    understood = False
    for rule in value.split(";"):
        rule = rule.strip()
        match = re.match(r"^((?:Mo|Tu|We|Th|Fr|Sa|Su)(?:\s*[-,]\s*(?:Mo|Tu|We|Th|Fr|Sa|Su))*)\s+(.+)$", rule)
        if not match:
            continue
        days: list[int] = []
        for part in match.group(1).replace(" ", "").split(","):
            if "-" in part:
                a, b = part.split("-")
                ia, ib = DAYS_OSM.index(a), DAYS_OSM.index(b)
                days += list(range(ia, ib + 1)) if ia <= ib else list(range(ia, 7)) + list(range(0, ib + 1))
            else:
                days.append(DAYS_OSM.index(part))
        times = match.group(2).strip()
        if times == "off":
            for day in days:
                week[day] = []
            understood = True
            continue
        windows = re.findall(r"(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})", times)
        if not windows:
            continue
        for day in days:
            week[day] = [(s.zfill(5), e.zfill(5)) for s, e in windows]
        understood = True
    if not understood:
        return value
    return {DAY_KEYS[i]: (", ".join(f"{s} - {e}" for s, e in week[i]) if week.get(i) else CLOSED) for i in range(7)}


def classify(tags: dict) -> list[tuple[str, str]]:
    """[(carrier, puntType), ...]: a shop can be a pickup point for several networks."""
    amenity = tags.get("amenity", "")
    is_locker = amenity == "parcel_locker"
    # Who runs the parcel service, not the shop's own name ("Kiosk am Markt")
    service = " ".join(tags.get(k, "") for k in ("post_office:brand", "post_office:operator", "brand",
                                                 "operator", "network", "parcel_locker:brand"))
    name = tags.get("name", "")
    found = []
    for carrier, pattern in NETWORKS:
        # a locker's or a network shop's name is the network ("Packstation 123", "Mail Boxes Etc.")
        if not (pattern.search(service) or ((is_locker or carrier in ("MBE", "NovaPost", "Parcelly"))
                                            and pattern.search(name))):
            continue
        if is_locker:
            found.append((carrier, "locker"))
        elif carrier == "DHL" and amenity == "post_office" and (
                tags.get("post_office") != "post_partner" or FILIALE.search(name + " " + service)):
            found.append((carrier, "post_office"))  # Postfiliale (in Germany run by a partner shop)
        elif carrier == "NovaPost" and amenity == "post_office" and tags.get("post_office") != "post_partner":
            found.append((carrier, "post_office"))
        else:
            found.append((carrier, "pickup_point"))
    return found


def main() -> int:
    print("📡 OpenStreetMap / Overpass: every network (fallback)")
    elements = overpass()
    if not elements:
        print("❌ Overpass did not answer: caches unchanged")
        return 1
    print(f"   {len(elements)} OSM elements")

    by_carrier: dict[str, list] = {carrier: [] for carrier in STEMS}
    for element in elements:
        tags = element.get("tags") or {}
        lat = element.get("lat") or (element.get("center") or {}).get("lat")
        lon = element.get("lon") or (element.get("center") or {}).get("lon")
        for carrier, punt_type in classify(tags):
            name = tags.get("name") or DEFAULT_NAMES.get((carrier, punt_type), carrier)
            record = make_record(
                id=f"osm-{element['type'][0]}{element['id']}",
                name=name,
                lat=lat,
                lon=lon,
                punt_type=punt_type,
                street=tags.get("addr:street", ""),
                number=tags.get("addr:housenumber", ""),
                cap=tags.get("addr:postcode", ""),
                city=tags.get("addr:city", ""),
                can_pickup=True,
                can_dropoff=True,
                hours=parse_opening_hours(tags.get("opening_hours")),
            )
            if record:
                by_carrier[carrier].append(record)

    # Each carrier saved separately: one guard failure must not block the others.
    # A carrier can also be skipped here with OSM_SKIP=DHL,GLS
    import json
    import os
    from common import DATA_DIR
    skip = {c.strip() for c in os.environ.get("OSM_SKIP", "").split(",") if c.strip()}
    # A network whose cache came from a direct source (an API, or a fetcher run on
    # the PC) is never overwritten with the usually smaller OSM count
    for carrier, stem in STEMS.items():
        path = DATA_DIR / f"{stem}_all_locations.json"
        try:
            method = (json.loads(path.read_text(encoding="utf-8")).get("metadata") or {}).get("method")
        except (OSError, ValueError):
            method = None
        if method and method != "osm-overpass":
            print(f"   ⏭  {carrier}: cache da fonte diretta ({method}), OSM non la sovrascrive")
            skip.add(carrier)
    failed = []
    for carrier, stem in STEMS.items():
        if carrier in skip:
            continue
        if not by_carrier[carrier] and not (DATA_DIR / f"{stem}_all_locations.json").exists():
            print(f"   ⚪ {carrier}: nessun punto su OpenStreetMap, nessuna cache da salvare")
            continue
        try:
            save(carrier, stem, dedupe(by_carrier[carrier]),
                 "OpenStreetMap (Overpass API), © OpenStreetMap contributors, ODbL", "osm-overpass")
        except SystemExit as exit_:
            if exit_.code:
                failed.append(carrier)
    if failed:
        print(f"⚠️  caches not updated (anomaly): {', '.join(failed)}")
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
