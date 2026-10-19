"""
Mail Boxes Etc. centers in Germany (partner shops: shipping, printing, pickup).

API: POST https://www.mbe.de/WS/wsStores.asmx/FindNear  {"coords": {"lat", "lng"}, "servizi": []}
     The search of mbe.de/de/store-locator (found on 19/10/2026 after scripts/scopri.py mbe):
     whatever the coordinates, d.Props.DataForMap holds every German center (~150) with
     position and an info-window snippet (address). Opening hours come from each center's
     page (/de/versand-druck/<ort>/<nummer>, block "store-orari").

    python scripts/fetch_mbe.py
"""

import html
import json
import re
import sys
import time

import requests

from common import USER_AGENT, make_record, save

BASE = "https://www.mbe.de"
URL = f"{BASE}/WS/wsStores.asmx/FindNear"
DAYS = {"Montag": 0, "Dienstag": 1, "Mittwoch": 2, "Donnerstag": 3, "Freitag": 4, "Samstag": 5, "Sonntag": 6}
DAY_KEYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
TIME = re.compile(r"(\d{1,2})[:.](\d{2})\s*-\s*(\d{1,2})[:.](\d{2})")


def split_street(line: str):
    """'Hans-Thoma-Straße 13' -> ('Hans-Thoma-Straße', '13'); number last in Germany."""
    m = re.match(r"^(.*?)\s+(\d+\s*[a-zA-Z]?(?:\s*[-/]\s*\d+\s*[a-zA-Z]?)?)$", line.strip())
    return (m.group(1).strip(), m.group(2).replace(" ", "")) if m else (line.strip(), "")


def parse_marker(item):
    markup = item.get("InfoWindowMarkup") or ""
    number = re.search(r"<span>\s*(\d+)\s*</span>", markup)
    address = re.search(r"<p>\s*(.*?)\s*</p>", markup, re.S)
    url = re.search(r'href="(/de/versand-druck/[^"]+)"', markup)
    street_line, cap, city = "", "", ""
    if address:
        parts = [html.unescape(re.sub(r"<[^>]+>", "", p)).strip()
                 for p in re.split(r"<br\s*/?>", address.group(1))]
        parts = [p for p in parts if p]
        if parts:
            street_line = parts[0]
        if len(parts) > 1:
            m = re.match(r"(\d{5})\s+(.*)", parts[-1])
            cap, city = (m.group(1), m.group(2)) if m else ("", parts[-1])
    return {
        "number": number.group(1) if number else str(item.get("ID")),
        "street_line": street_line,
        "cap": cap,
        "city": city,
        "url": url.group(1) if url else "",
        "lat": (item.get("Coords") or {}).get("Lat"),
        "lon": (item.get("Coords") or {}).get("Lng"),
    }


def page_hours(session, path):
    """Weekly hours from a center's page; None when the block is missing or empty."""
    if not path:
        return None
    try:
        page = session.get(BASE + path, timeout=30)
        page.raise_for_status()
    except requests.RequestException:
        return None
    block = page.text.split('class="store-orari"', 1)
    if len(block) < 2:
        return None
    week, seen = {}, False
    for day, body in re.findall(r'class="giorno">\s*([A-Za-z]+)\s*</div>(.*?)(?=class="riga-orario|$)',
                                block[1][:6000], re.S):
        if day not in DAYS:
            continue
        windows = [f"{int(a):02d}:{b} - {int(c):02d}:{d}" for a, b, c, d in TIME.findall(body)]
        seen = seen or bool(windows)
        week[DAY_KEYS[DAYS[day]]] = ", ".join(windows) if windows else "closed"
    return week if seen and len(week) == 7 else None


def main():
    print("📡 Mail Boxes Etc. (ricerca dello store locator mbe.de, una chiamata + pagine dei centri)")
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT, "X-Requested-With": "XMLHttpRequest",
                            "Referer": f"{BASE}/de/store-locator", "Origin": BASE})
    response = session.post(URL, json={"coords": {"lat": 51.16, "lng": 10.45}, "servizi": []}, timeout=60)
    response.raise_for_status()
    d = response.json().get("d") or {}
    markers = json.loads((d.get("Props") or {}).get("DataForMap") or "[]")
    print(f"   {len(markers)} centri ricevuti")

    records, with_hours = [], 0
    for item in markers:
        x = parse_marker(item)
        street, number = split_street(x["street_line"])
        week = page_hours(session, x["url"])
        with_hours += week is not None
        time.sleep(0.3)
        record = make_record(
            id=f"mbe-{x['number']}",
            name=f"Mail Boxes Etc. {x['number']}" + (f" {x['city']}" if x["city"] else ""),
            lat=x["lat"],
            lon=x["lon"],
            punt_type="pickup_point",
            street=street,
            number=number,
            cap=x["cap"],
            city=x["city"],
            can_pickup=True,
            can_dropoff=True,
            hours=week,
        )
        if record:
            records.append(record)
    print(f"   orari trovati per {with_hours} centri su {len(markers)}")
    if len(records) < 80:
        print(f"❌ solo {len(records)} centri: risposta inattesa, cache invariata")
        return 1
    save("MBE", "mbe", records, URL, "api-findnear")
    return 0


if __name__ == "__main__":
    sys.exit(main())
