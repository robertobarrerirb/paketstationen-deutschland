"""
GLS Germany: GLS PaketShops, Paketstationen (lockers) and KEEPER points, adaptive grid.

API: GET https://api.gls-group.net/parcel-shop-management/v2/available-public-parcel-shops-pse-bulk
         ?latitude=..&longitude=..&distance=<km>
     The service behind the PaketShop map of gls-group.eu (found with scripts/scopri.py
     for France on 12/10/2026; the same API serves every GLS country, partnerId GLS_DE). The page sends a public header `apikey`;
     GLS_APIKEY overrides it if GLS changes it (record it again with scopri.py gls).
     Every shop within `distance` km, with type SHOPINSHOP / KEEPER / LOCKER and the
     services offered (only today's and tomorrow's hours: not kept).

    python scripts/fetch_gls.py
"""

import os
import time
from collections import Counter

import requests

from common import crawl_cells, dedupe, make_record, save

URL = "https://api.gls-group.net/parcel-shop-management/v2/available-public-parcel-shops-pse-bulk"
APIKEY = os.environ.get("GLS_APIKEY", "8vx0yMRZLcQt0MIh6Ww3yor8o7EXqwl5")
SPLIT_AT = 400
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/140.0 Safari/537.36",
    "Accept": "application/json",
    "Accept-Language": "de-DE",
    "Content-Type": "application/json",
    "Origin": "https://gls-group.eu",
    "Referer": "https://gls-group.eu/",
    "apikey": APIKEY,
}


def main():
    print("📡 GLS Germania (API della mappa gls-group.eu, griglia adattiva)")
    session = requests.Session()
    session.headers.update(HEADERS)
    sizes = Counter()

    def search(lat, lon, radius_m):
        params = {"latitude": f"{lat:.5f}", "longitude": f"{lon:.5f}", "distance": max(1, round(radius_m / 1000))}
        for attempt in range(4):
            time.sleep(0.3)
            try:
                response = session.get(URL, params=params, timeout=90)
                if response.status_code in (401, 403):
                    raise SystemExit(f"❌ HTTP {response.status_code}: la chiave apikey non è più valida "
                                     "(registrala di nuovo con scripts/scopri.py gls)")
                if response.status_code in (429, 500, 502, 503, 504):
                    raise RuntimeError(f"HTTP {response.status_code}")
                response.raise_for_status()
                items = response.json() or []
                sizes[min(len(items) // 100 * 100, 2000)] += 1
                return items
            except SystemExit:
                raise
            except Exception as error:  # noqa: BLE001 - network code, retried
                if attempt == 3:
                    print(f"   ⚠️  {lat:.4f},{lon:.4f}: {error}")
                    return []
                time.sleep(2 ** attempt * 3)
        return []

    raw = crawl_cells(search, start_km=40, cap=SPLIT_AT, min_km=4, workers=2, label="GLS")
    print("   risposte per numero di punti (fasce da 100):", dict(sorted(sizes.items())))

    records, types = [], Counter()
    for shop in raw:
        if str(shop.get("partnerId") or "").upper() not in ("GLS_DE", ""):
            continue
        kind = str(shop.get("type") or "").upper()
        types[kind] += 1
        street = " ".join(x for x in (str(shop.get("street") or "").strip(),
                                      str(shop.get("houseNumber") or "").strip()) if x)
        name = str(shop.get("name") or "").strip()
        record = make_record(
            id=f"gls-{shop.get('parcelShopId')}",
            name=(name.title() if name.isupper() else name) or ("GLS Paketstation" if kind == "LOCKER" else "GLS PaketShop"),
            lat=shop.get("latitude"),
            lon=shop.get("longitude"),
            punt_type="locker" if kind == "LOCKER" else "pickup_point",
            street=street.title() if street.isupper() else street,
            cap=shop.get("zipCode") or "",
            city=str(shop.get("city") or "").title(),
            can_pickup=shop.get("offersParcelCollection") is not False,
            can_dropoff=bool(shop.get("offersReturnDropOff") or shop.get("offersPrepaidParcelDropOff")
                             or shop.get("offersLabellessDropOff")),
        )
        if record:
            records.append(record)
    print("   tipi:", dict(types))
    save("GLS", "gls", dedupe(records), URL, "api-adaptive-grid")


if __name__ == "__main__":
    main()
