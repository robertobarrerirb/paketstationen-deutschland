"""
Nova Post in Germany: its own branches (PostBranch, Paketautomaten) and the PUDO points
it uses, which are DPD Pickup shops (source "DPD").

API: GET https://api.novapost.com/site/v.1.0/divisions?countryCodes[]=DE&limit=100&page=N
     The service behind novapost.com/de-de/departments (found with scripts/scopri.py
     novapost on 16/10/2026): no key, 100 per page, ~11,500 German points.
     PUDO points carry no shop name ("Berlin DE45396"): they are listed as "Nova Post
     PUDO", so scripts/shared_points.py joins them to the DPD shop at the same address.

    python scripts/fetch_novapost.py
"""

import sys
import time
from collections import Counter

import requests

from common import dedupe, make_record, save, week_from

URL = "https://api.novapost.com/site/v.1.0/divisions"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/140.0 Safari/537.36",
    "Accept": "application/json",
    "Accept-Language": "de",
    "Origin": "https://novapost.com",
    "Referer": "https://novapost.com/",
}
DAYS = {"monday": 0, "tuesday": 1, "wednesday": 2, "thursday": 3, "friday": 4, "saturday": 5, "sunday": 6}
TYPES = {"Postomat": "locker", "PostBranch": "post_office", "CargoBranch": "post_office", "PUDO": "pickup_point"}


def hours(schedule):
    by_day = {i: [] for i in range(7)}
    for entry in schedule or []:
        day = DAYS.get(str(entry.get("day") or "").lower())
        start, end = (entry.get("from") or "")[:5], (entry.get("to") or "")[:5]
        if day is None or not start or not end or start == end:
            continue
        if entry.get("breakFrom") and entry.get("breakTo"):
            by_day[day] += [(start, entry["breakFrom"][:5]), (entry["breakTo"][:5], end)]
        else:
            by_day[day].append((start, end))
    return week_from(by_day)


def page(session, n):
    params = {"countryCodes[]": "DE", "limit": 100, "page": n}
    for attempt in range(5):
        try:
            time.sleep(0.3)
            response = session.get(URL, params=params, timeout=60)
            if response.status_code in (429, 500, 502, 503, 504):
                raise RuntimeError(f"HTTP {response.status_code}")
            response.raise_for_status()
            return response.json()
        except Exception as error:  # noqa: BLE001 - network code, retried
            if attempt == 4:
                raise SystemExit(f"❌ pagina {n}: {error}")
            time.sleep(2 ** attempt * 5)
    return {}


def main():
    print("📡 Nova Post (API della pagina Filialen di novapost.com, 100 per pagina)")
    session = requests.Session()
    session.headers.update(HEADERS)
    first = page(session, 1)
    last, total = first.get("last_page") or 1, first.get("total")
    print(f"   {total} punti in {last} pagine")
    items = list(first.get("items") or [])
    for n in range(2, last + 1):
        items += page(session, n).get("items") or []
    print("   categorie:", dict(Counter(x.get("divisionCategory") for x in items)),
          "· fonti:", dict(Counter(x.get("source") for x in items)))

    records = []
    for x in items:
        if (x.get("countryCode") or "DE") != "DE" or x.get("status") not in (None, "Working"):
            continue
        category = x.get("divisionCategory")
        kind = TYPES.get(category, "pickup_point")
        parts = x.get("addressParts") or {}
        street = str(parts.get("street") or "").strip()
        if category == "PUDO":
            name = "Nova Post PUDO"
        elif kind == "locker":
            name = f"Nova Post Paketautomat {x.get('number') or ''}".strip()
        else:
            name = f"Nova Post {x.get('name') or x.get('number') or ''}".strip()
        record = make_record(
            id=f"novapost-{x.get('id')}",
            name=name,
            lat=x.get("latitude"),
            lon=x.get("longitude"),
            punt_type=kind,
            street=street.title() if street.isupper() else street,
            number=parts.get("building") or "",
            cap=parts.get("postCode") or "",
            city=parts.get("city") or "",
            can_pickup=not x.get("prohibitedIssuance"),
            can_dropoff=not x.get("prohibitedSending"),
            hours=hours(x.get("workSchedule")),
        )
        if record:
            records.append(record)
    records = dedupe(records)
    if len(records) < 1000:
        print(f"❌ solo {len(records)} punti: risposta inattesa, cache invariata")
        return 1
    save("NovaPost", "novapost", records, URL + "?countryCodes[]=DE", "api-paged")
    return 0


if __name__ == "__main__":
    sys.exit(main())
