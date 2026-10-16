"""
Hermes PaketShops (and Hermes Paketstationen, "hbx") in Germany, adaptive grid.

API: GET https://paketshop.myhermes.de/api/v1/parcelshops/search?address=<lat>,<lon>
     The service behind the PaketShop finder of myhermes.de (found with
     scripts/scopri.py hermes on 16/10/2026). No key: it answers the 20 shops
     nearest to the address (or "lat,lon"), with distanceInMeter; no parameter
     changes that number. So a cell is split only when its 20th shop is still
     closer than the cell's corner.

    python scripts/fetch_hermes.py
"""

import sys
import time
from collections import Counter

import requests

from common import crawl_cells, dedupe, make_record, save, week_from

URL = "https://paketshop.myhermes.de/api/v1/parcelshops/search"
PER_CALL = 20
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/140.0 Safari/537.36",
    "Accept": "application/json",
    "Accept-Language": "de-DE",
    "x-language": "de",
    "Referer": "https://paketshop.myhermes.de/",
}
DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]


def hours(business):
    business = business or {}
    by_day = {}
    for i, day in enumerate(DAYS):
        windows = []
        for n in (1, 2, 3):
            start, end = business.get(f"{day}From{n}"), business.get(f"{day}To{n}")
            if start and end:
                windows.append((start[:5], end[:5]))
        by_day[i] = windows
    return week_from(by_day)


def main():
    print("📡 Hermes PaketShop (API del PaketShop-Finder di myhermes.de, 20 per ricerca, griglia adattiva)")
    session = requests.Session()
    session.headers.update(HEADERS)
    errors = Counter()

    def search(lat, lon, radius_m):
        for attempt in range(5):
            time.sleep(0.25)
            try:
                response = session.get(URL, params={"address": f"{lat:.5f},{lon:.5f}"}, timeout=40)
                if response.status_code in (401, 403):
                    errors[response.status_code] += 1
                    if errors[response.status_code] > 20:
                        raise SystemExit(f"❌ HTTP {response.status_code}: il servizio rifiuta le richieste")
                    raise RuntimeError(f"HTTP {response.status_code}")
                if response.status_code in (429, 500, 502, 503, 504):
                    raise RuntimeError(f"HTTP {response.status_code}")
                if response.status_code == 404:
                    return []
                response.raise_for_status()
                return response.json().get("parcelShopDetails") or []
            except SystemExit:
                raise
            except Exception as error:  # noqa: BLE001 - network code, retried
                if attempt == 4:
                    print(f"   ⚠️  {lat:.4f},{lon:.4f}: {error}")
                    return []
                time.sleep(2 ** attempt * 3)
        return []

    def full(items, radius_m):
        return len(items) >= PER_CALL and max(x.get("distanceInMeter") or 0 for x in items) < radius_m

    raw = crawl_cells(search, start_km=20, cap=PER_CALL, min_km=0.4, workers=3, label="Hermes", full=full)

    records = []
    for shop in raw:
        address = shop.get("address") or {}
        if (address.get("country") or "DEU") not in ("DEU", "DE"):
            continue
        is_box = bool(shop.get("hbx"))
        record = make_record(
            id=f"hermes-{shop.get('number')}",
            name=(shop.get("name") or "").strip() or ("Hermes Paketstation" if is_box else "Hermes PaketShop"),
            lat=address.get("lat"),
            lon=address.get("lng"),
            punt_type="locker" if is_box else "pickup_point",
            street=address.get("street") or "",
            cap=address.get("zipCode") or "",
            city=address.get("city") or "",
            can_pickup=True,
            can_dropoff=True,
            hours=hours(shop.get("businessHours")),
        )
        if record:
            records.append(record)
    records = dedupe(records)
    if len(records) < 1000:
        print(f"❌ solo {len(records)} punti: risposta inattesa, cache invariata")
        return 1
    save("Hermes", "hermes", records, URL, "api-nearest20-adaptive-grid")
    return 0


if __name__ == "__main__":
    sys.exit(main())
