"""
DPD Pickup in Germany: every Pickup Paketshop and Pickup Station in one call.

API: GET https://pickup.dpd.cz/api/getAll?country=276
     Public endpoint of the DPD group (Geopost), no key: for France (country=250)
     it returned the whole Pickup network (24,563 points on 09/10/2026), partner shops
     ("pickup_point") and Pickup Stations ("dpd_box"). Germany is country 276.

    python scripts/fetch_dpd.py
"""
import requests

from common import ISO_NUMERIC, USER_AGENT, make_record, save, week_from, dedupe

URL = "https://pickup.dpd.cz/api/getAll"


def hours(entries):
    """DPD: [{day: 1=Mon..7=Sun, openMorning, closeMorning, openAfternoon, closeAfternoon}]."""
    by_day = {}
    for entry in entries or []:
        day = entry.get("day")
        if not isinstance(day, int) or not 1 <= day <= 7:
            continue
        windows = []
        for start, end in (("openMorning", "closeMorning"), ("openAfternoon", "closeAfternoon")):
            if entry.get(start) and entry.get(end):
                windows.append((entry[start][:5], entry[end][:5]))
        by_day[day - 1] = windows
    return week_from(by_day)


def point_type(item):
    kind = str(item.get("pickup_network_type") or "").lower()
    return "locker" if ("box" in kind or "locker" in kind) else "pickup_point"


def main():
    print(f"📡 DPD Pickup via DPD Pickup API (country={ISO_NUMERIC})")
    response = requests.get(URL, params={"country": ISO_NUMERIC}, timeout=120,
                            headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    response.raise_for_status()
    payload = response.json()
    if payload.get("status") != "ok":
        raise SystemExit(f"❌ API answer: {payload.get('status')} {payload.get('message')}")
    items = (payload.get("data") or {}).get("items") or []
    print(f"   {len(items)} points received (API count: {payload.get('count')})")

    records = []
    for item in items:
        record = make_record(
            id=item.get("id"),
            name=item.get("company") or ("DPD Pickup Station" if point_type(item) == "locker" else "DPD Pickup Paketshop"),
            lat=item.get("latitude"),
            lon=item.get("longitude"),
            punt_type=point_type(item),
            street=item.get("street", ""),
            number=item.get("house_number", ""),
            cap=item.get("postcode", ""),
            city=item.get("city", ""),
            can_pickup=bool(item.get("pickup_allowed", 1)),
            can_dropoff=bool(item.get("dropoff_allowed", 0)),
            hours=hours(item.get("hours")),
        )
        if record:
            records.append(record)

    save("DPD", "dpd", dedupe(records), f"{URL}?country={ISO_NUMERIC}", "api-getAll")


if __name__ == "__main__":
    main()
