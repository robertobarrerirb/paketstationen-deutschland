"""
DeinFach Paketstationen (Deutsche Post's open lockers, used by DHL, UPS and DHL Express).

Source: the location finder widget of deinfach.de carries every station inside its
script: https://standortfinder.deinfach.de/location-finder-widget.es.js holds a
JSON.parse('[...]') with one GeoJSON Feature per station (found on 16/10/2026 after
scripts/scopri.py deinfach). Note: coordinates are [lat, lon], not GeoJSON's [lon, lat].
Opening times are "all-0-24", "mon-sat-6-22" ... or a list of {day, open, close}.
Stations "außer Betrieb" are left out; "defekt" ones stay (they get repaired).
Since October 2026 DeinFach is being folded into myflexbox.

    python scripts/fetch_deinfach.py
"""

import json
import re
import sys
from collections import Counter

import requests

from common import USER_AGENT, make_record, save, week_from

URL = "https://standortfinder.deinfach.de/location-finder-widget.es.js"
SHORT_DAYS = {"mon": 0, "tue": 1, "wed": 2, "thu": 3, "fri": 4, "sat": 5, "sun": 6}
GERMAN_DAYS = {"montag": 0, "dienstag": 1, "mittwoch": 2, "donnerstag": 3, "freitag": 4, "samstag": 5, "sonntag": 6}


def hhmm(value) -> str:
    value = str(value).strip()
    if ":" in value:
        h, m = value.split(":")[:2]
        return f"{int(h):02d}:{int(m):02d}"
    return f"{int(float(value)):02d}:00"


def hours(spec):
    by_day = {i: [] for i in range(7)}
    if isinstance(spec, list):
        for entry in spec:
            day = GERMAN_DAYS.get(str(entry.get("day") or "").strip().lower())
            if day is not None and entry.get("open") and entry.get("close"):
                by_day[day].append((hhmm(entry["open"]), hhmm(entry["close"])))
        return week_from(by_day)
    match = re.fullmatch(r"(all|[a-z]{3})(?:-([a-z]{3}))?-(\d{1,2}(?::\d{2})?)-(\d{1,2}(?::\d{2})?)", str(spec or "").strip().lower())
    if not match:
        return str(spec) if spec else None
    first, last, start, end = match.groups()
    days = range(7) if first == "all" else range(SHORT_DAYS[first], SHORT_DAYS.get(last or first, SHORT_DAYS[first]) + 1)
    for day in days:
        by_day[day].append((hhmm(start), hhmm(end)))
    return week_from(by_day)


def features(script: str) -> list:
    start = script.find("JSON.parse('[{\"type\":\"Feature\"")
    if start < 0:
        raise SystemExit("❌ elenco delle stazioni non trovato nello script del widget (struttura cambiata?)")
    end = script.find("]')", start)
    raw = script[start + len("JSON.parse('"): end + 1]
    return json.loads(raw.replace("\\'", "'"))


def main():
    print("📡 DeinFach (elenco incluso nel widget Standortfinder di deinfach.de)")
    response = requests.get(URL, timeout=120, headers={"User-Agent": USER_AGENT, "Referer": "https://www.deinfach.de/"})
    response.raise_for_status()
    items = features(response.text)
    print(f"   {len(items)} stazioni, stato: {dict(Counter(f['properties'].get('operatingStatus') for f in items))}")

    records = []
    for feature in items:
        p = feature.get("properties") or {}
        if p.get("operatingStatus") == "außer Betrieb":
            continue
        lat, lon = (feature.get("geometry") or {}).get("coordinates") or (None, None)
        if lat is not None and lon is not None and lat < lon:  # in case they switch to GeoJSON order
            lat, lon = lon, lat
        address = p.get("address") or {}
        partners = p.get("logisticPartners") or []
        record = make_record(
            id=f"deinfach-{p.get('podId')}",
            name=f"DeinFach {address.get('city') or ''} {p.get('lockerNumber') or ''}".strip(),
            lat=lat,
            lon=lon,
            punt_type="locker",
            street=address.get("street") or "",
            number=address.get("streetNumber") or "",
            cap=address.get("postalCode") or "",
            city=address.get("city") or "",
            can_pickup=(not partners) or any(x.get("isPickupPossible") for x in partners),
            can_dropoff=(not partners) or any(x.get("isDropOffPossible") for x in partners),
            hours=hours(p.get("openingTimes")),
        )
        if record:
            records.append(record)
    if len(records) < 500:
        print(f"❌ solo {len(records)} stazioni: risposta inattesa, cache invariata")
        return 1
    save("DeinFach", "deinfach", records, URL, "widget-geojson")
    return 0


if __name__ == "__main__":
    sys.exit(main())
