"""
myflexbox Paketstationen in Germany (open lockers served by several carriers).

API: GET https://api.myflexbox.de/api/1/lockers
     The public list behind the station map of myflexbox.com (found on 16/10/2026 in
     the map's script, after scripts/scopri.py myflexbox): every German locker in one
     call, with address, opening hours and state. api.myflexbox.at has the Austrian ones.
     Stations being dismantled (operationalState TERMINATING) are left out; those in
     maintenance stay (they come back).

    python scripts/fetch_myflexbox.py
"""

import re
import sys
from collections import Counter

import requests

from common import USER_AGENT, make_record, save, week_from

URL = "https://api.myflexbox.de/api/1/lockers"
DAYS = {"MONDAY": 0, "TUESDAY": 1, "WEDNESDAY": 2, "THURSDAY": 3, "FRIDAY": 4, "SATURDAY": 5, "SUNDAY": 6}


def hours(entries):
    by_day = {i: [] for i in range(7)}
    for entry in entries or []:
        day = DAYS.get(str(entry.get("day") or "").upper())
        if day is not None and entry.get("startTime") and entry.get("endTime"):
            end = entry["endTime"][:5]
            by_day[day].append((entry["startTime"][:5], "24:00" if end == "23:59" else end))
    return week_from(by_day)


def display_name(raw: str) -> str:
    """'Walddörferstraße 146 - Hamburg (REWE Nord)' -> 'myflexbox REWE Nord'; else 'myflexbox Paketstation'."""
    host = re.search(r"\(([^)]+)\)\s*$", raw or "")
    return f"myflexbox {host.group(1).strip()}" if host else "myflexbox Paketstation"


def main():
    print("📡 myflexbox (API pubblica della mappa myflexbox.com, una chiamata)")
    response = requests.get(URL, timeout=120, headers={"User-Agent": USER_AGENT, "Accept": "application/json",
                                                       "Origin": "https://www.myflexbox.com",
                                                       "Referer": "https://www.myflexbox.com/"})
    response.raise_for_status()
    lockers = response.json().get("lockers") or []
    states = Counter(x.get("operationalState") for x in lockers)
    print(f"   {len(lockers)} stazioni ricevute, stato: {dict(states)}")

    records = []
    for x in lockers:
        if (x.get("countryCode") or "DE") != "DE" or x.get("operationalState") == "TERMINATING":
            continue
        record = make_record(
            id=f"myflexbox-{x.get('lockerId')}",
            name=display_name(x.get("name")),
            lat=x.get("latitude"),
            lon=x.get("longitude"),
            punt_type="locker",
            street=x.get("streetName") or "",
            number=x.get("streetNumber") or "",
            cap=x.get("postcode") or "",
            city=x.get("city") or "",
            can_pickup=True,
            can_dropoff=True,
            hours=hours(x.get("openingHours")),
        )
        if record:
            records.append(record)
    if len(records) < 500:
        print(f"❌ solo {len(records)} stazioni: risposta inattesa, cache invariata")
        return 1
    save("myflexbox", "myflexbox", records, URL, "api-lockers")
    return 0


if __name__ == "__main__":
    sys.exit(main())
