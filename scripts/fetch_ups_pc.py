"""
UPS Access Point in Germania, dal localizzatore di ups.com (da lanciare sul PC).

Fonte: POST https://widgets.ups.com/api/ups.app/xml/Locator
       L'interfaccia XML che usa la pagina "Trova una sede" di ups.com
       (OptionCode 018 = UPS Access Point). È protetta da Akamai: risponde
       403 a richieste fuori dal browser e dai server di GitHub. Per questo lo
       script apre una finestra di Chromium VISIBILE su ups.com e fa le
       ricerche da dentro la pagina, come farebbe il sito stesso.

Strategia: griglia adattiva sulla sagoma della Germania. Ogni cella si cerca dal
centro con raggio pari all'angolo della cella; i risultati sono ordinati per
distanza, quindi se ne tornano MAX_LIST e l'ultimo è più vicino dell'angolo,
la cella si divide in quattro.

Ctrl+C (o una sessione scaduta) salva un checkpoint in data/ups_checkpoint.json;
rilanciando si riprende da lì.

    python scripts/fetch_ups_pc.py              # giro completo (~30-60 min)
    set UPS_TEST=1 & python scripts/fetch_ups_pc.py   # solo prova su Francoforte
"""

import json
import math
import os
import sys
import time
import uuid
import xml.etree.ElementTree as ET
from pathlib import Path

from common import DATA_DIR, dedupe, grid_cells, land_filter, make_record, save, week_from

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    print("Playwright non installato:  python -m pip install playwright && python -m playwright install chromium")
    sys.exit(1)

LOCATOR_URL = "https://widgets.ups.com/api/ups.app/xml/Locator"
HOME_URL = "https://www.ups.com/de/de/home"
MAX_LIST = int(os.environ.get("UPS_MAX_LIST", "50"))
START_CELL_KM = 20
MIN_CELL_KM = 0.5
DELAY = 0.8
CHECKPOINT = DATA_DIR / "ups_checkpoint.json"
DAY_INDEX = {"1": 6, "2": 0, "3": 1, "4": 2, "5": 3, "6": 4, "7": 5}  # UPS: 1 = domenica

REQUEST = """<?xml version="1.0"?><LocatorRequest xml:lang="de_DE"><Request><RequestAction>Locator</RequestAction>\
<RequestOption>1</RequestOption><TransactionReference><CustomerContext>e4vti_ulf</CustomerContext></TransactionReference>\
</Request><OriginAddress><Geocode><Latitude>{lat:.6f}</Latitude><Longitude>{lon:.6f}</Longitude></Geocode>\
<AddressKeyFormat><CountryCode>DE</CountryCode></AddressKeyFormat></OriginAddress><Translate><Locale>de_DE</Locale>\
</Translate><UnitOfMeasurement><Code>KM</Code></UnitOfMeasurement><LocationSearchCriteria><SearchOption><OptionType>\
<Code>01</Code></OptionType><OptionCode><Code>018</Code></OptionCode></SearchOption><MaximumListSize>{size}\
</MaximumListSize><SearchRadius>{radius}</SearchRadius></LocationSearchCriteria><SortCriteria><SortType>01</SortType>\
</SortCriteria></LocatorRequest>"""

FETCH_JS = """async ([url, body, tid, creds]) => {
  // a stalled request must not hang the whole crawl: give up after 45 s
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45000);
  try {
    const r = await fetch(url, {method: 'POST', credentials: creds, body, signal: ctrl.signal,
      headers: {'Content-Type': 'application/json', 'transid': tid, 'Accept-Language': 'de-DE'}});
    return [r.status, await r.text()];
  } catch (e) {
    return [0, String(e)];
  } finally {
    clearTimeout(timer);
  }
}"""


class SessionLost(Exception):
    pass


class Locator:
    def __init__(self, page):
        self.page = page
        self.creds = "same-origin"
        self.calls = 0

    def raw(self, lat, lon, radius, size):
        body = REQUEST.format(lat=lat, lon=lon, radius=radius, size=size)
        self.page.set_default_timeout(60000)
        return self.page.evaluate(FETCH_JS, [LOCATOR_URL, body, str(uuid.uuid4()), self.creds])

    def search(self, lat, lon, radius, size=MAX_LIST):
        """List of DropLocation elements; raises SessionLost after repeated refusals."""
        radius = max(10, min(100, math.ceil(radius)))  # locator limit 5-100 km; 10 = safe margin
        for attempt in range(6):
            time.sleep(DELAY)
            self.calls += 1
            try:
                status, text = self.raw(lat, lon, radius, size)
            except Exception as error:  # noqa: BLE001 - page navigated, network hiccup ...
                status, text = 0, str(error)
            if status == 200 and "<LocatorResponse" in text:
                root = ET.fromstring(text.encode("utf-8"))
                if root.findtext(".//ResponseStatusCode") != "1":
                    description = root.findtext(".//ErrorDescription") or ""
                    # "no locations found" is an answer, not an error
                    if "no location" in description.lower() or root.findtext(".//ErrorCode") in ("350111", "350116"):
                        return []
                    print(f"   ⚠️  {lat:.4f},{lon:.4f}: {description[:150]}", flush=True)
                    return []
                return root.findall(".//DropLocation")
            print(f"   ⚠️  {lat:.4f},{lon:.4f}: HTTP {status} (tentativo {attempt + 1})", flush=True)
            if status == 403 and self.creds == "same-origin":
                self.creds = "include"
                continue
            # refresh the ups.com session, then back off
            time.sleep(10 * (attempt + 1))
            try:
                self.page.goto(HOME_URL, wait_until="domcontentloaded", timeout=90000)
                self.page.wait_for_timeout(5000)
            except Exception:  # noqa: BLE001
                pass
        raise SessionLost()


def close(browser):
    try:
        browser.close()
    except Exception:  # noqa: BLE001 - Ctrl+C also stops the Playwright driver
        pass


def km_between(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(a))


def summary(location):
    """DropLocation -> small JSON-able dict (checkpoint and records)."""
    def text(path):
        return (location.findtext(path) or "").strip()

    days = {i: [] for i in range(7)}
    for day in location.findall("OperatingHours/StandardHours[HoursType='10']/DayOfWeek"):
        index = DAY_INDEX.get(day.findtext("Day"))
        if index is None:
            continue
        opens = [x.text for x in day.findall("OpenHours")]
        closes = [x.text for x in day.findall("CloseHours")]
        for o, c in zip(opens, closes):
            if o and c:
                days[index].append((f"{int(o) // 100:02d}:{int(o) % 100:02d}", f"{int(c) // 100:02d}:{int(c) % 100:02d}"))
    classes = " ".join(x.text or "" for x in location.findall(".//BusinessClassification/Description"))
    return {
        "id": text("AccessPointInformation/PublicAccessPointID") or text("LocationID"),
        "name": text("AddressKeyFormat/ConsigneeName"),
        "lat": text("Geocode/Latitude"),
        "lon": text("Geocode/Longitude"),
        "street": text("AddressKeyFormat/AddressLine"),
        "cap": text("AddressKeyFormat/PostcodePrimaryLow"),
        "city": text("AddressKeyFormat/PoliticalDivision2"),
        "country": text("AddressKeyFormat/CountryCode"),
        "status": text("AccessPointInformation/AccessPointStatus/Description"),
        "classes": classes,
        "km": float(text("Distance/Value") or 0),
        "hours": {str(k): v for k, v in days.items()},
    }


def is_locker_name(name):
    """UPS also lists other networks' lockers ("myflexbox Paketstation ...", "Packstation",
    "Deinfach 615 In 58135"),
    so "paketstation" counts as well as "locker"."""
    name = str(name or "").lower()
    return ("locker" in name or "paketstation" in name or "packstation" in name or "flexbox" in name
            or "deinfach" in name)  # DeinFach stations: "Deinfach 615 In 58135"


def to_record(point):
    name = point["name"].title() if point["name"].isupper() else point["name"]
    # Only the name: a shop's business classes can mention "locker" (8 Italian
    # shops did in September 2026) without the point being one
    is_locker = is_locker_name(point["name"])
    hours = week_from({int(k): [tuple(w) for w in v] for k, v in point["hours"].items()})
    return make_record(
        id=f"ups-{point['id']}",
        name=name or "UPS Access Point",
        lat=point["lat"],
        lon=point["lon"],
        punt_type="locker" if is_locker else "pickup_point",
        street=point["street"].title(),
        cap=point["cap"],
        city=point["city"].title(),
        hours=hours,
    )


def save_checkpoint(found, pending):
    CHECKPOINT.write_text(json.dumps({"saved_at": time.time(), "found": found, "pending": pending},
                                     ensure_ascii=False), encoding="utf-8")
    print(f"💾 checkpoint: {len(found)} punti, {len(pending)} celle da cercare. Rilancia lo stesso comando per riprendere.")


def cell_for(lat, lon, side):
    dlat = side / 2 / 111.0
    dlon = side / 2 / (111.320 * math.cos(math.radians(lat)))
    return [lat - dlat, lon - dlon, lat + dlat, lon + dlon]


def main():
    print("📡 UPS Access Point dal localizzatore di ups.com (browser visibile) · v4")
    test = bool(os.environ.get("UPS_TEST"))
    found, pending = {}, None
    if not test and CHECKPOINT.exists():
        data = json.loads(CHECKPOINT.read_text(encoding="utf-8"))
        found, pending = data.get("found") or {}, data.get("pending")
        print(f"↩️  ripresa: {len(found)} punti già trovati, {len(pending)} celle da cercare")
    if pending is None:
        near_land = land_filter()
        corner = START_CELL_KM / math.sqrt(2)
        pending = [cell_for(lat, lon, START_CELL_KM) for lat, lon in grid_cells(START_CELL_KM)
                   if near_land(lat, lon, corner)]
        print(f"📍 {len(pending)} celle da {START_CELL_KM} km")

    with sync_playwright() as p:
        try:
            browser = p.chromium.launch(channel="chrome", headless=False)
        except Exception:  # noqa: BLE001 - Chrome not installed: Playwright's Chromium
            browser = p.chromium.launch(headless=False)
        context = browser.new_context(locale="de-DE", viewport={"width": 1100, "height": 800})
        # JavaScript pop-ups (alert) crash the Playwright driver: neutralise them
        context.add_init_script("window.alert=()=>{};window.confirm=()=>true;window.prompt=()=>null;")
        context.on("page", lambda pg: pg.on("dialog", lambda d: d.dismiss()))
        page = context.new_page()
        page.goto(HOME_URL, wait_until="domcontentloaded", timeout=90000)
        print("\n👉 Nella finestra del browser accetta i cookie di ups.com (poi non toccarla più).")
        input("   Fatto? Premi Invio qui per iniziare... ")
        locator = Locator(page)

        if test:
            for size, radius in ((15, 25), (50, 25), (100, 25), (100, 100)):
                items = [summary(x) for x in locator.search(50.1109, 8.6821, radius, size)]
                far = max((x["km"] for x in items), default=None)
                print(f"   🧪 lista {size}, raggio {radius} km: {len(items)} punti, il più lontano a {far} km")
            print("   esempio:", json.dumps([to_record(x) for x in items[:1]], ensure_ascii=False)[:600])
            browser.close()
            return 0

        started = time.time()
        current = None
        try:
            while pending:
                current = pending.pop()
                s, w, n, e = current
                clat, clon = (s + n) / 2, (w + e) / 2
                corner = km_between(clat, clon, n, e)
                items = [summary(x) for x in locator.search(clat, clon, corner + 0.5)]
                for item in items:
                    if item["country"] in ("", "DE") and item["status"] in ("", "ACTIVE"):
                        found.setdefault(item["id"], item)
                side = km_between(s, w, s, e)
                if len(items) >= MAX_LIST and side / 2 >= MIN_CELL_KM:
                    reach = max(x["km"] for x in items)
                    if reach < corner:
                        pending += [[s, w, clat, clon], [s, clon, clat, e], [clat, w, n, clon], [clat, clon, n, e]]
                if locator.calls % 25 == 0:
                    minutes = (time.time() - started) / 60
                    print(f"   ⏱ {minutes:.0f} min · {locator.calls} ricerche · {len(found)} punti · {len(pending)} celle da cercare",
                          flush=True)
                current = None
                if locator.calls % 200 == 0:
                    save_checkpoint(found, pending)
        except (KeyboardInterrupt, SessionLost):
            print("\n⏸ interrotto (Ctrl+C o sessione ups.com non più valida)")
            save_checkpoint(found, pending + ([current] if current else []))
            close(browser)
            return 3
        close(browser)

    records = dedupe([r for r in (to_record(x) for x in found.values()) if r])
    print(f"\n✅ {len(records)} UPS Access Point ({locator.calls} ricerche, {(time.time() - started) / 60:.0f} min)")
    save("UPS", "ups", records, LOCATOR_URL, f"localizzatore-ups.com-griglia ({locator.calls} ricerche)")
    if CHECKPOINT.exists():
        CHECKPOINT.unlink()
    return 0


if __name__ == "__main__":
    sys.exit(main())
