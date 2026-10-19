"""
Position of the points from their address, with OpenStreetMap house numbers.

Rule (Roberto, October 2026): when address and coordinates disagree, the address wins.
For every listing with a real street address and a house number, the same number of the
same street is looked up in OpenStreetMap, in the same Gemeinde (the one under the
network's coordinates or the one its town name says) and within SEARCH_M metres; if
found, the listing moves there. Address lines that are a network label ("Packstation
123", "Postfiliale 603": amazon.de listings of other networks) have nothing to look up.

Input: the OSM addresses exported by osmium as line-delimited GeoJSON (see the workflow
"Posizioni dagli indirizzi (OSM)"):

    osmium tags-filter germany-latest.osm.pbf nwr/addr:housenumber -o addr.osm.pbf
    osmium export addr.osm.pbf -c scripts/osm_indirizzi.json -f geojsonseq \
        --geometry-types=point,polygon -o addr.geojsonseq
    python scripts/osm_indirizzi.py addr.geojsonseq

Output: data/posizioni_indirizzi.json {"<Network>:<id>": [lat, lon], ...} with a summary
per network; scripts/build_data.py applies it before grouping the points.
"""

from __future__ import annotations

import json
import math
import re
import sys
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import shapely
from pyproj import Transformer

from build_data import CARRIERS
from shared_points import _ascii, _street_sim, street_info

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT = DATA / "posizioni_indirizzi.json"
SEARCH_M = 3000.0      # a network's coordinates can be this far off
CELL_M = SEARCH_M      # grid cell; a listing looks at its cell and the 8 around it
STREET_SIM = 0.5
# A network label in the address line ("DHL Packstation 107" at amazon.de), not a street
LABEL = re.compile(r"\b(packstation|poststation|postfiliale|paketshop|paketstation|filiale|locker|dhl|hermes|dpd|gls|ups|myflexbox)\b")
TO_M = Transformer.from_crs(4326, 25832, always_xy=True)


def _plain(text) -> str:
    return re.sub(r"[^a-z]", "", _ascii(text))


def load_comuni():
    """Gemeinde polygons (data/territorium/gemeinden.geojson, scripts/prepare_territorium.py)."""
    data = json.loads((DATA / "territorium" / "gemeinden.geojson").read_text(encoding="utf-8"))
    geoms = [shapely.geometry.shape(f["geometry"]) for f in data["features"]]
    raw = [str(f["properties"]["commune"]) for f in data["features"]]
    return shapely.STRtree(geoms), geoms, [_plain(n) for n in raw], raw


def comune_of(tree, lons, lats) -> np.ndarray:
    """Index of the Gemeinde containing each point, -1 outside."""
    out = np.full(len(lons), -1)
    if len(lons):
        pts, polys = tree.query(shapely.points(np.asarray(lons), np.asarray(lats)), predicate="within")
        out[pts] = polys
    return out


def listing_address(loc: dict):
    """(street words, civic number) of a real street address, else None."""
    street, number = str(loc.get("straatNaam") or ""), str(loc.get("straatNr") or "")
    if LABEL.search(_ascii(street)) or not re.search(r"[A-Za-zÄÖÜäöüß]{3}", street):
        return None  # "Postfiliale 603", "Packstation 123": a label, not a street
    words, house = street_info(street, number)
    if not words or not house.isdigit():
        return None
    return words, house


def load_listings():
    listings = []
    for carrier, stem in CARRIERS.items():
        path = DATA / f"{stem}_all_locations.json"
        if not path.exists():
            continue
        for loc in json.loads(path.read_text(encoding="utf-8")).get("locations") or []:
            try:
                lat, lon = float(loc["latitude"]), float(loc["longitude"])
            except (KeyError, TypeError, ValueError):
                continue
            address = listing_address(loc)
            if address:
                listings.append((f"{carrier}:{loc['id']}", carrier, lat, lon, *address, _plain(loc.get("citta"))))
    return listings


def centre(geometry):
    kind, coords = geometry["type"], geometry["coordinates"]
    if kind == "Point":
        return coords[0], coords[1]
    ring = coords[0] if kind == "Polygon" else coords[0][0]
    xs = [c[0] for c in ring[:-1] or ring]
    ys = [c[1] for c in ring[:-1] or ring]
    return sum(xs) / len(xs), sum(ys) / len(ys)


def main(path: str) -> int:
    started = time.time()
    listings = load_listings()
    print(f"📮 {len(listings)} punti con indirizzo e civico")
    xs, ys = TO_M.transform([l[3] for l in listings], [l[2] for l in listings])
    # The number must be in the listing's Gemeinde: the one under the network's coordinates,
    # or the one its town name says ("Hauptstraße 9" of the next village is another place)
    tree, _, comune_names, data_names = load_comuni()
    at = comune_of(tree, [l[3] for l in listings], [l[2] for l in listings])
    name_index = {}
    for k, name in enumerate(comune_names):
        name_index.setdefault(name, k)
        # "Frankfurt am Main" is "Frankfurt" for many networks, "Halle (Saale)" is "Halle"
        short = _plain(re.split(r"\s+(?:am|an der|im|in der|ob der|bei|\(|/|,)", data_names[k])[0])
        if short != name:
            name_index.setdefault(short, k)
    own = [{c for c in (at[n], name_index.get(l[6], -1)) if c >= 0} for n, l in enumerate(listings)]
    wanted = defaultdict(list)  # (house, cell) -> listing indexes whose 3x3 block covers that cell
    for n, (x, y) in enumerate(zip(xs, ys)):
        cx, cy = int(x // CELL_M), int(y // CELL_M)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                wanted[(listings[n][5], cx + dx, cy + dy)].append(n)

    best = {}  # listing index -> (similarity, -distance, lon, lat)
    seen = kept = 0
    batch = []

    def flush():
        nonlocal kept
        if not batch:
            return
        bx, by = TO_M.transform([b[2] for b in batch], [b[3] for b in batch])
        bc = comune_of(tree, [b[2] for b in batch], [b[3] for b in batch])
        for (words, house, lon, lat), x, y, c in zip(batch, bx, by, bc):
            for n in wanted.get((house, int(x // CELL_M), int(y // CELL_M)), ()):
                if c not in own[n]:
                    continue
                d = math.hypot(x - xs[n], y - ys[n])
                if d > SEARCH_M:
                    continue
                sim = _street_sim(words, listings[n][4])
                if sim < STREET_SIM:
                    continue
                kept += 1
                score = (sim, -d)
                if n not in best or score > best[n][:2]:
                    best[n] = (sim, -d, lon, lat)
        batch.clear()

    with open(path, encoding="utf-8") as handle:
        for line in handle:
            line = line.strip().lstrip("\x1e")
            if not line:
                continue
            seen += 1
            feature = json.loads(line)
            props = feature.get("properties") or {}
            street, number = props.get("addr:street") or props.get("addr:place"), props.get("addr:housenumber")
            if not street or not number or not feature.get("geometry"):
                continue
            words, house = street_info(street, number)
            if not words or not house.isdigit():
                continue
            lon, lat = centre(feature["geometry"])
            batch.append((words, house, lon, lat))
            if len(batch) >= 200_000:
                flush()
            if seen % 2_000_000 == 0:
                print(f"   … {seen} indirizzi OSM letti, {len(best)} punti trovati", flush=True)
    flush()

    positions, stats = {}, defaultdict(lambda: {"con_indirizzo": 0, "trovati": 0, "spostati_oltre_10m": 0,
                                                "spostati_oltre_100m": 0})
    for n, listing in enumerate(listings):
        stats[listing[1]]["con_indirizzo"] += 1
        if n not in best:
            continue
        _, neg_d, lon, lat = best[n]
        positions[listing[0]] = [round(lat, 7), round(lon, 7)]
        stats[listing[1]]["trovati"] += 1
        stats[listing[1]]["spostati_oltre_10m"] += -neg_d > 10
        stats[listing[1]]["spostati_oltre_100m"] += -neg_d > 100
    OUT.write_text(json.dumps({
        "metadata": {"generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                     "source": "OpenStreetMap (Geofabrik germany-latest), © OpenStreetMap contributors, ODbL",
                     "osm_indirizzi_letti": seen, "search_m": SEARCH_M, "per_rete": stats},
        "posizioni": positions,
    }, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"✅ {len(positions)} punti su {len(listings)} posizionati dall'indirizzo "
          f"({seen} indirizzi OSM, {(time.time() - started) / 60:.0f} min)")
    for carrier, s in stats.items():
        print(f"   {carrier:14s} {s}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
