"""
Builds every webapp file from the carriers' national caches.

    data/<carrier>_all_locations.json   (scripts/fetch_*.py)
  + data/territorium/gemeinden.geojson (scripts/prepare_territorium.py)
  → webapp/public/data/

One pass: every point is assigned to its Gemeinde with a spatial join (no
per-Gemeinde API calls: with ~10,800 Gemeinden it would not be sustainable).
"commune" / "département" / "région" in the code are Gemeinde / Kreis / Land
(the names come from the French version). Then it writes:

  <slug>.geojson                one file per Gemeinde: points + outline
  kreis-<slug>.geojson          one per Kreis: points + outline
  land-<slug>.geojson           one per Land: points + outline
  deutschland.geojson           every point (no opening hours, to stay light)

Points of the same physical place listed by several networks (a kiosk that is
Hermes PaketShop and DPD Pickup ...) get the same "gruppo" and the list "reti":
the map shows them as one place (scripts/shared_points.py). Per-carrier counts
stay complete; "luoghi" counts distinct physical places.
  geo/coverage_<r>.geojson      union of the 300/400/500 m radii (Germany view)
  summary.json                  outcome per commune and per carrier
  statistics.json               density and coverage per commune (Statistics page)
  totals_history.json           weekly series for Germany, Länder and Kreise
  history/<kreis>.json          weekly series for the Gemeinden of that Kreis

Distances are computed in ETRS89 / UTM zone 32N (EPSG:25832), the official
projection of the German survey (BKG, most Länder): buffers are true metres.

    python scripts/build_data.py
"""

from __future__ import annotations

import json
import sys
import time
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

import geopandas as gpd
import pandas as pd
import shapely
from shapely import make_valid
from shapely.geometry import mapping
from shapely.ops import unary_union

from shared_points import load_corrections, shared_groups

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
TERRITORIO = DATA_DIR / "territorium"
WEBAPP_PUBLIC = ROOT / "webapp" / "public"
OUT = WEBAPP_PUBLIC / "data"

METRIC_CRS = "EPSG:25832"
NATIONAL_SLUG = "deutschland"
BUFFER_RADII = (300, 400, 500)
# Points up to this far outside every comune (coast, simplified borders) are
# assigned to the nearest one; beyond it they are abroad or at sea.
SNAP_M = 250

# Carrier -> cache stem. Order = CARRIER_ORDER in webapp/lib/carriers.ts;
# a carrier missing on either side silently drops out of the charts.
CARRIERS = {
    "DHL": "dhl",            # Deutsche Post / DHL: Packstation, Poststation, Filiale, Paketshop
    "Hermes": "hermes",
    "DPD": "dpd",
    "GLS": "gls",
    "UPS": "ups",
    "Amazon": "amazon",
    "FedEx": "fedex",
    "myflexbox": "myflexbox",
    "DeinFach": "deinfach",
    "MBE": "mbe",            # Mail Boxes Etc.
    "NovaPost": "novapost",
}
LOCKER_TYPES = {"locker"}  # mirrors LOCKER_TYPES in webapp/types/pakketpunten.ts
CATEGORIES = ("locker", "shop")

POINT_PROPS = ["locatieNaam", "straatNaam", "straatNr", "cap", "citta", "vervoerder", "puntType",
               "latitude", "longitude", "canPickup", "canDropoff", "openingstijden"]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def rounded(geometry, decimals=5):
    return json.loads(json.dumps(mapping(geometry)), parse_float=lambda x: round(float(x), decimals))


def repaired(geom):
    if geom.is_valid:
        return geom
    fixed = make_valid(geom)
    if fixed.geom_type == "GeometryCollection":
        fixed = unary_union([g for g in fixed.geoms if g.geom_type in ("Polygon", "MultiPolygon")])
    return fixed


def write_json(path: Path, payload, compact=True):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        if compact:
            json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))
        else:
            json.dump(payload, handle, ensure_ascii=False, indent=1)


# --------------------------------------------------------------------------- load

def load_caches():
    frames, sources = [], {}
    for carrier, stem in CARRIERS.items():
        path = DATA_DIR / f"{stem}_all_locations.json"
        if not path.exists():
            print(f"   ⚪ {carrier:14s} no cache ({path.name})")
            sources[carrier] = None
            continue
        with open(path, encoding="utf-8") as handle:
            cache = json.load(handle)
        locations = cache.get("locations") or []
        sources[carrier] = {
            "fetched_at": (cache.get("metadata") or {}).get("fetched_at"),
            "locations": len(locations),
            "source": (cache.get("metadata") or {}).get("source"),
        }
        if not locations:
            continue
        frame = pd.DataFrame(locations)
        frame["vervoerder"] = carrier
        frames.append(frame)
        print(f"   🟢 {carrier:14s} {len(frame):6d} points")
    if not frames:
        raise SystemExit("❌ No carrier cache in data/: run the fetch_*.py scripts first")
    points = pd.concat(frames, ignore_index=True)
    for column in POINT_PROPS:
        if column not in points:
            points[column] = None
    points = points.dropna(subset=["latitude", "longitude"])
    points["openingstijden"] = points["openingstijden"].astype(object).where(points["openingstijden"].notna(), None)
    gdf = gpd.GeoDataFrame(points, geometry=gpd.points_from_xy(points["longitude"], points["latitude"]), crs="EPSG:4326")
    return gdf, sources


def address_positions(points: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """
    The address wins over the network's coordinates (Roberto, October 2026): listings whose
    street and house number were found in OpenStreetMap (data/posizioni_indirizzi.json, from
    scripts/osm_indirizzi.py, workflow "Posizioni dagli indirizzi (OSM)") are placed there.
    """
    path = DATA_DIR / "posizioni_indirizzi.json"
    if not path.exists():
        print("   ⚪ nessuna posizione dagli indirizzi (data/posizioni_indirizzi.json)")
        return points
    positions = json.loads(path.read_text(encoding="utf-8")).get("posizioni") or {}
    keys = points["vervoerder"] + ":" + points["id"].astype(str)
    found = keys.map(positions)
    hit = found.notna()
    points = points.copy()
    points.loc[hit, "latitude"] = [v[0] for v in found[hit]]
    points.loc[hit, "longitude"] = [v[1] for v in found[hit]]
    points["geometry"] = gpd.points_from_xy(points["longitude"], points["latitude"])
    print(f"   🏠 {int(hit.sum())} punti posizionati dal loro indirizzo")
    return points


def assign_comuni(points: gpd.GeoDataFrame, comuni: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    joined = gpd.sjoin(points, comuni[["slug", "geometry"]], how="left", predicate="within")
    joined = joined[~joined.index.duplicated(keep="first")].drop(columns=["index_right"])
    missing = joined["slug"].isna()
    if missing.any():
        loose = joined.loc[missing].drop(columns=["slug"]).to_crs(METRIC_CRS)
        nearest = gpd.sjoin_nearest(loose, comuni[["slug", "geometry"]].to_crs(METRIC_CRS),
                                    how="left", max_distance=SNAP_M)
        nearest = nearest[~nearest.index.duplicated(keep="first")]
        joined.loc[nearest.index, "slug"] = nearest["slug"]
    dropped = joined["slug"].isna().sum()
    print(f"   📍 {len(joined) - dropped} points assigned · {int(missing.sum())} snapped to the nearest commune (≤{SNAP_M} m) "
          f"· {dropped} dropped (outside Germany or at sea)")
    return joined.dropna(subset=["slug"])


# ------------------------------------------------------------------------ features

def point_feature(row, slim=False) -> dict:
    props = {"type": "pakketpunt"}
    if row["gruppo"]:
        props["gruppo"] = row["gruppo"]
        if not slim:  # the national file holds every member: the map derives the list
            props["reti"] = row["reti"]
    for key in POINT_PROPS:
        value = row[key]
        if slim and key in ("openingstijden", "cap", "citta"):
            continue
        if isinstance(value, float) and value != value:  # NaN
            value = None
        props[key] = value if value is not None else ("" if key in ("straatNaam", "straatNr", "cap", "citta", "locatieNaam") else None)
    if row.get("abitanti5min") is not None and row.get("abitanti5min") == row.get("abitanti5min"):
        props["abitanti5min"] = int(row["abitanti5min"])
        props["abitantiServiti"] = int(row["abitantiServiti"])
    props["bezettingsgraad"] = 50  # kept for API compatibility; no real occupancy data exists
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [round(row["longitude"], 7), round(row["latitude"], 7)]},
        "properties": props,
    }


def mark_shared(points: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Columns gruppo ('' when not shared) and reti (networks at that place, in CARRIERS order)."""
    metric = points.to_crs(METRIC_CRS).geometry
    group = shared_groups(
        metric.x.values, metric.y.values,
        points["vervoerder"].tolist(),
        (points["category"] == "locker").tolist(),
        points["locatieNaam"].fillna("").astype(str).tolist(),
        points["straatNaam"].fillna("").astype(str).tolist(),
        points["straatNr"].fillna("").astype(str).tolist(),
        keys=(points["vervoerder"] + ":" + points["id"].astype(str)).tolist(),
        corrections=load_corrections(DATA_DIR / "punti_condivisi_correzioni.json"),
    )
    order = {c: i for i, c in enumerate(CARRIERS)}
    points = points.copy()
    points["gruppo"] = [f"g{g}" if g >= 0 else "" for g in group]
    networks = points[points["gruppo"] != ""].groupby("gruppo")["vervoerder"].agg(
        lambda c: sorted(set(c), key=order.get))
    points["reti"] = points["gruppo"].map(networks)
    points["luogo"] = place_keys(points)
    shared = int((points["gruppo"] != "").sum())
    print(f"   🔗 {shared} points in {len(networks)} places served by several networks · "
          f"{places(points)} distinct places out of {len(points)} points")
    return points


# A listing whose coordinates come from its own street address ("12 rue de la Paix"): not
# the Amazon Lockers that carry the place name in the address line ("Supermarché Casino Lyon")
def _address_backed(name: str, street: str, number: str) -> bool:
    return any(ch.isdigit() for ch in f"{street} {number}")


AGREE_M = 30.0


def place_positions(points: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """
    One position per shared place, decided by the addresses (Roberto, October 2026: when
    address and coordinates disagree the address wins). The networks geocode one shop
    differently, sometimes hundreds of metres off: the marker goes where most listings with
    a street address agree (within AGREE_M of each other), at their mean.
    """
    points = points.copy()
    shared = points[points["gruppo"] != ""]
    if shared.empty:
        return points
    metric = shared.to_crs(METRIC_CRS).geometry
    xs, ys = metric.x, metric.y
    moved = 0
    for _, idx in shared.groupby("gruppo").groups.items():
        idx = list(idx)
        if len(idx) < 2:
            continue
        backed = [k for k in idx if _address_backed(str(points.at[k, "locatieNaam"]), str(points.at[k, "straatNaam"] or ""),
                                                     str(points.at[k, "straatNr"] or ""))] or idx

        def dist(a, b):
            return ((xs[a] - xs[b]) ** 2 + (ys[a] - ys[b]) ** 2) ** 0.5

        # the address-backed listing most others agree with (ties: the most central)
        best = max(backed, key=lambda c: (sum(dist(c, k) <= AGREE_M for k in backed),
                                          -sum(dist(c, k) for k in backed)))
        near = [k for k in backed if dist(best, k) <= AGREE_M]
        lat = float(sum(points.at[k, "latitude"] for k in near) / len(near))
        lon = float(sum(points.at[k, "longitude"] for k in near) / len(near))
        for k in idx:
            if abs(points.at[k, "latitude"] - lat) > 1e-7 or abs(points.at[k, "longitude"] - lon) > 1e-7:
                moved += 1
            points.at[k, "latitude"], points.at[k, "longitude"] = lat, lon
    points["geometry"] = gpd.points_from_xy(points["longitude"], points["latitude"])
    print(f"   🎯 {moved} punti condivisi spostati sulla posizione concordata dagli indirizzi")
    return points


WALK_M = 400.0  # 5 minutes on foot, as the crow flies


POP_REACH: dict = {}  # territory slug -> {carrier: residents within 5 minutes of its points, "_tutte": any network}


def population_cells(communes: gpd.GeoDataFrame | None):
    """
    Residents as weighted points (lon, lat, weight, Gemeinde slug, Kreis slug, Land slug),
    counts scaled to each Gemeinde's current population (VG250-EW).
    Preferred: the census 2022 100 m grid (data/popolazione_zensus_100m.csv.gz, scripts/fetch_zensus.py).
    Fallback: Kontur H3 r8 hexagon centres (coarse).
    """
    import numpy as np

    by_slug = communes.set_index("slug") if communes is not None else None
    carreaux = DATA_DIR / "popolazione_zensus_100m.csv.gz"
    if carreaux.exists() and communes is not None:
        cells = pd.read_csv(carreaux, dtype={"code": str}, low_memory=False)
        # the Gemeinde under each cell (Gemeinden of 2022 may have merged since)
        pts = gpd.GeoDataFrame(geometry=gpd.points_from_xy(cells["lon"], cells["lat"]), crs="EPSG:4326")
        hit = gpd.sjoin(pts, communes[["slug", "geometry"]], how="left", predicate="within")
        hit = hit[~hit.index.duplicated(keep="first")].sort_index()
        slug = hit["slug"]
        lost = slug.isna()
        if lost.any():  # cells on the coast or a border: their commune code
            slug.loc[lost] = cells.loc[lost, "code"].map(communes.set_index("code")["slug"])
        census = cells.groupby(slug)["pop"].sum()
        factor = (by_slug["population"] / census).replace([np.inf, -np.inf], np.nan)
        weight = cells["pop"].to_numpy() * slug.map(factor).fillna(1.0).to_numpy()
        print(f"   👥 popolazione: Zensus 2022, celle di 100 m ({len(cells)} celle)")
        return (cells["lon"].to_numpy(), cells["lat"].to_numpy(), weight, slug.to_numpy(dtype=object),
                slug.map(by_slug["dep_slug"]).to_numpy(dtype=object), slug.map(by_slug["region_slug"]).to_numpy(dtype=object))

    path = DATA_DIR / "popolazione_h3_r8.csv.gz"
    try:
        import h3
    except ImportError:
        return None
    if not path.exists():
        return None
    pop = pd.read_csv(path)
    hex_ll = np.array([h3.cell_to_latlng(c) for c in pop["h3"]])
    slug = np.full(len(pop), None, dtype=object)
    dep = np.full(len(pop), None, dtype=object)
    region = np.full(len(pop), None, dtype=object)
    if communes is not None:
        where = gpd.sjoin(gpd.GeoDataFrame(geometry=gpd.points_from_xy(hex_ll[:, 1], hex_ll[:, 0]), crs="EPSG:4326"),
                          communes[["slug", "dep_slug", "region_slug", "geometry"]], how="left", predicate="within")
        where = where[~where.index.duplicated(keep="first")].sort_index()
        slug = where["slug"].to_numpy(dtype=object)
        dep, region = where["dep_slug"].to_numpy(dtype=object), where["region_slug"].to_numpy(dtype=object)
        kontur = pop["pop"].groupby(slug).sum()
        factor = (by_slug["population"] / kontur).replace([np.inf, -np.inf], np.nan)
        pop = pop.assign(pop=pop["pop"].to_numpy() * pd.Series(slug).map(factor).fillna(1.0).to_numpy())
    print("   👥 popolazione: Kontur (centri degli esagoni H3), manca data/popolazione_zensus_100m.csv.gz")
    return hex_ll[:, 1], hex_ll[:, 0], pop["pop"].to_numpy(float), slug, dep, region


def population_served(points: gpd.GeoDataFrame, communes: gpd.GeoDataFrame | None = None) -> gpd.GeoDataFrame:
    """
    Residents near each place (population_cells: census 2022 100 m grid, else Kontur):
    - abitanti5min: people living within WALK_M of the place;
    - abitantiServiti: the same people shared out among all the places within their reach
      (someone with three places within 5 minutes counts one third for each).
    Also POP_REACH: residents of each territory within WALK_M of a point of each network.
    """
    import numpy as np

    points = points.copy()
    points["abitanti5min"] = None
    points["abitantiServiti"] = None
    cells = population_cells(communes)
    if cells is None:
        print("   ⚪ popolazione servita: nessun dato di popolazione")
        return points
    lon, lat, weights, cell_slug, cell_dep, cell_region = cells
    keys = points["luogo"]
    places = points.groupby(keys)[["latitude", "longitude"]].first()
    place_xy = gpd.GeoSeries(gpd.points_from_xy(places["longitude"], places["latitude"]), crs="EPSG:4326").to_crs(METRIC_CRS)
    cell_xy = gpd.GeoSeries(gpd.points_from_xy(lon, lat), crs="EPSG:4326").to_crs(METRIC_CRS)
    cell_i, place_i = shapely.STRtree(place_xy.values).query(cell_xy.values, predicate="dwithin", distance=WALK_M)
    reach = np.bincount(cell_i, minlength=len(weights))  # places within 5 minutes of each cell
    within = np.bincount(place_i, weights=weights[cell_i], minlength=len(places))
    served = np.bincount(place_i, weights=weights[cell_i] / reach[cell_i], minlength=len(places))
    if communes is not None:
        levels = [pd.factorize(pd.Series(v)) for v in (cell_slug, cell_dep, cell_region)]
        place_nets = points.groupby(keys)["vervoerder"].agg(set).reindex(places.index).tolist()
        totals: dict = defaultdict(dict)
        for carrier in list(CARRIERS) + ["_tutte"]:
            has = np.array([carrier == "_tutte" or carrier in nets for nets in place_nets])
            reached = np.unique(cell_i[has[place_i]])
            w = weights[reached]
            totals[NATIONAL_SLUG][carrier] = float(w.sum())
            for codes, names in levels:
                ok = codes[reached] >= 0
                sums = np.bincount(codes[reached][ok], weights=w[ok], minlength=len(names))
                for name, v in zip(names, sums):
                    if v:
                        totals[name][carrier] = float(v)
        POP_REACH.clear()
        POP_REACH.update({slug: {c: int(round(v)) for c, v in d.items()} for slug, d in totals.items()})
    by_place = pd.DataFrame({"abitanti5min": np.round(within).astype(int), "abitantiServiti": np.round(served).astype(int)},
                            index=places.index)
    points["abitanti5min"] = keys.map(by_place["abitanti5min"])
    points["abitantiServiti"] = keys.map(by_place["abitantiServiti"])
    print(f"   👥 popolazione entro {WALK_M:.0f} m di {len(places)} luoghi "
          f"(mediana {int(np.median(within))} abitanti, servita {int(np.median(served))})")
    return points


def place_keys(points) -> list:
    """One key per physical place, as webapp/lib/sharedPlaces.ts placeKey():
    the gruppo when shared, else the exact coordinates (6 decimals), so points of
    different listings at the very same spot count as one place."""
    return [g if g else f"{lat:.6f},{lon:.6f}"
            for g, lat, lon in zip(points["gruppo"], points["latitude"], points["longitude"])]


def places(subset) -> int:
    """Distinct physical places (same rule as the map's 'luoghi distinti')."""
    return int(subset["luogo"].nunique())


def shared_places(subset) -> int:
    """Distinct places served by two or more networks (as countSharedPlaces in the webapp)."""
    nets = subset.groupby("luogo")["vervoerder"].nunique()
    return int((nets > 1).sum())


def collection(meta: dict, features: list) -> dict:
    return {"type": "FeatureCollection", "metadata": meta, "features": features}


# ---------------------------------------------------------------------- statistics

def coverage_ratio(points_m: gpd.GeoSeries, boundary_m, radius: int) -> float:
    if not len(points_m) or boundary_m.is_empty or boundary_m.area <= 0:
        return 0.0
    covered = unary_union(points_m.buffer(radius, quad_segs=8))
    return min(covered.intersection(boundary_m).area / boundary_m.area, 1.0)


# -------------------------------------------------------------------------- history

def week_info(date: datetime) -> dict:
    iso = date.isocalendar()
    start = date - timedelta(days=date.weekday())
    return {
        "week": iso[1],
        "year": iso[0],
        "week_label": f"{iso[0]}-W{iso[1]:02d}",
        "date_from": start.strftime("%Y-%m-%d"),
        "date_to": (start + timedelta(days=6)).strftime("%Y-%m-%d"),
    }


def upsert(history: list, entry: dict) -> None:
    for existing in history:
        if existing["week_label"] == entry["week_label"]:
            existing.update(entry)
            break
    else:
        history.append(entry)
    history.sort(key=lambda e: e["date"])


def update_history(national: dict, aggregates: dict, commune_counts: dict, commune_department: dict) -> None:
    now = datetime.now(timezone.utc)
    info = week_info(now)
    date = now.strftime("%Y-%m-%d")
    path = OUT / "totals_history.json"
    try:
        history = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        history = {"snapshots": [], "municipalities": {}}

    snapshot = {"date": date, **info, "totals": {"total": national["total"], "providers": national["providers"]}}
    upsert(history["snapshots"], snapshot)
    for slug, counts in [(NATIONAL_SLUG, national), *aggregates.items()]:
        entry = {"date": date, **info, "total": counts["total"], "providers": counts["providers"]}
        upsert(history["municipalities"].setdefault(slug, {"history": []})["history"], entry)

    snaps = history["snapshots"]
    if len(snaps) >= 2:
        latest, previous = snaps[-1], snaps[-2]
        carriers = set(latest["totals"]["providers"]) | set(previous["totals"]["providers"])
        history["trend"] = {
            "period": {"from": previous["date"], "to": latest["date"], "weeks": len(snaps)},
            "change": {
                "total": latest["totals"]["total"] - previous["totals"]["total"],
                "providers": {c: latest["totals"]["providers"].get(c, 0) - previous["totals"]["providers"].get(c, 0)
                              for c in carriers},
            },
        }
    history["updated_at"] = now_iso()
    write_json(path, history)

    # Per-commune series, one file per département (10,800 series in one file
    # would be huge after a year; the API reads only the département it needs)
    by_department = defaultdict(dict)
    for slug, counts in commune_counts.items():
        by_department[commune_department[slug]][slug] = counts
    for dep_slug, counts_by_slug in by_department.items():
        dep_path = OUT / "history" / f"{dep_slug}.json"
        try:
            dep_history = json.loads(dep_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            dep_history = {"municipalities": {}}
        for slug, counts in counts_by_slug.items():
            entry = {"date": date, **info, "total": counts["total"], "providers": counts["providers"]}
            upsert(dep_history["municipalities"].setdefault(slug, {"history": []})["history"], entry)
        dep_history["updated_at"] = now_iso()
        write_json(dep_path, dep_history)
    print(f"   📈 history updated: week {info['week_label']} ({len(snaps)} weeks)")


def write_aggregate(slug: str, name: str, extra: dict, group: gpd.GeoDataFrame, points: gpd.GeoDataFrame,
                    generated_at: str) -> dict:
    """Points + dissolved outline of a département or région; returns its counts."""
    subset = points[points["slug"].isin(set(group["slug"]))]
    per_carrier = Counter(subset["vervoerder"])
    outline = unary_union(group.geometry).simplify(0.0005)
    features = [point_feature(p) for _, p in subset.iterrows()]
    features.append({"type": "Feature", "geometry": rounded(outline, 4),
                     "properties": {"type": "boundary", "gemeente": name}})
    write_json(OUT / f"{slug}.geojson", collection({
        "gemeente": name,
        "slug": slug,
        **extra,
        "generated_at": generated_at,
        "total_points": len(subset),
        "total_places": places(subset),
        "providers": sorted(per_carrier),
        "bounds": [round(v, 6) for v in outline.bounds],
        "municipalities_included": len(group),
        "provider_stats": dict(per_carrier),
        "abitanti_serviti": POP_REACH.get(slug, {}),
    }, features))
    return {"total": len(subset), "providers": dict(per_carrier)}


# ----------------------------------------------------------------------------- main

def main() -> int:
    started = time.time()
    print("🏗️  Building webapp data")

    communes_file = TERRITORIO / "gemeinden.geojson"
    if not communes_file.exists():
        print("❌ data/territorium/gemeinden.geojson missing: run scripts/prepare_territorium.py")
        return 1
    communes = gpd.read_file(communes_file).set_crs("EPSG:4326", allow_override=True)
    communes["geometry"] = communes.geometry.map(repaired)
    meta_territoire = json.loads((TERRITORIO / "meta.json").read_text(encoding="utf-8"))
    print(f"   🗺️  {len(communes)} communes · population: {meta_territoire.get('population')}")

    points, sources = load_caches()
    points = address_positions(points)
    points = assign_comuni(points, communes)
    points = points.sort_values(["vervoerder", "latitude", "longitude"]).reset_index(drop=True)
    points["category"] = points["puntType"].map(lambda t: "locker" if t in LOCKER_TYPES else "shop")
    points = mark_shared(points)
    # One position per shared place, then the commune of that position
    points = place_positions(points)
    points = assign_comuni(points.drop(columns=["slug"]), communes)
    points["luogo"] = place_keys(points)
    points = population_served(points, communes)

    communes_m = communes.to_crs(METRIC_CRS)
    points_m = points.to_crs(METRIC_CRS).geometry
    carriers = list(CARRIERS)
    generated_at = now_iso()

    # Fresh output, keeping only what other scripts own
    for path in OUT.glob("*.geojson"):
        path.unlink()

    by_slug = {slug: idx for slug, idx in points.groupby("slug").groups.items()}
    commune_department = dict(zip(communes["slug"], communes["dep_slug"]))

    summary_results, stats_records, commune_counts = [], [], {}
    for n, row in enumerate(communes.itertuples(index=False), 1):
        idx = by_slug.get(row.slug, [])
        subset = points.loc[idx]
        per_carrier = Counter(subset["vervoerder"])
        per_category = Counter(subset["category"])

        features = [point_feature(p) for _, p in subset.iterrows()]
        features.append({
            "type": "Feature",
            "geometry": rounded(row.geometry),
            "properties": {"type": "boundary", "gemeente": row.commune},
        })
        payload = collection({
            "gemeente": row.commune,
            "slug": row.slug,
            "departement": row.departement,
            "departement_code": row.dep_code,
            "departement_slug": row.dep_slug,
            "region": row.region,
            "region_slug": row.region_slug,
            "insee": row.code,
            "generated_at": generated_at,
            "total_points": len(subset),
            "total_places": places(subset),
            "providers": sorted(per_carrier),
            "bounds": [round(v, 6) for v in row.geometry.bounds],
            "abitanti_serviti": POP_REACH.get(row.slug, {}),
        }, features)
        path = OUT / f"{row.slug}.geojson"
        write_json(path, payload)

        counts = {"total": len(subset), "providers": {c: per_carrier.get(c, 0) for c in carriers if per_carrier.get(c)}}
        commune_counts[row.slug] = counts
        summary_results.append({
            "gemeente": row.commune,
            "slug": row.slug,
            "success": True,
            "count": len(subset),
            "file_size_kb": round(path.stat().st_size / 1024, 1),
        })

        # Statistics: density and coverage of the commune's land area
        boundary_m = communes_m.geometry.iloc[n - 1]
        area_km2 = round(boundary_m.area / 1_000_000, 2)
        population = int(row.population) if row.population == row.population and row.population else 0
        sub_m = points_m.loc[idx].drop_duplicates() if len(idx) else points_m.iloc[0:0]
        stats_records.append({
            "slug": row.slug,
            "gemeente": row.commune,
            "departement": row.departement,
            "departement_code": row.dep_code,
            "departement_slug": row.dep_slug,
            "region": row.region,
            "region_slug": row.region_slug,
            "code": row.code,
            "population": population,
            "area_km2": area_km2,
            "total": len(subset),
            "luoghi": places(subset),
            "per_10k_inwoners": round(len(subset) / population * 10_000, 2) if population else 0.0,
            "per_km2": round(len(subset) / area_km2, 2) if area_km2 else 0.0,
            "vervoerders": {c: per_carrier.get(c, 0) for c in carriers},
            "categorieen": {c: per_category.get(c, 0) for c in CATEGORIES},
            "dekking": {str(r): round(coverage_ratio(sub_m, boundary_m, r), 4) for r in BUFFER_RADII},
        })
        if n % 2000 == 0:
            print(f"   … {n}/{len(communes)} communes ({time.time() - started:.0f} s)")

    # Départements and régions: points + dissolved outline
    aggregates = {}
    for (code, name, slug, region), group in communes.groupby(["dep_code", "departement", "dep_slug", "region"]):
        aggregates[slug] = write_aggregate(slug, name, {"departement": name, "departement_code": code, "region": region},
                                           group, points, generated_at)
    for (name, slug), group in communes.groupby(["region", "region_slug"]):
        aggregates[slug] = write_aggregate(slug, name, {"region": name}, group, points, generated_at)
    print(f"   🗂️  {len(aggregates)} Kreis and Land files")

    # Germany: every point, without opening hours to keep the file light
    per_carrier = Counter(points["vervoerder"])
    write_json(OUT / f"{NATIONAL_SLUG}.geojson", collection({
        "gemeente": "Deutschland",
        "slug": NATIONAL_SLUG,
        "generated_at": generated_at,
        "total_points": len(points),
        "total_places": places(points),
        "providers": sorted(per_carrier),
        "bounds": [round(v, 6) for v in points.total_bounds],
        "municipalities_included": len(communes),
        "provider_stats": dict(per_carrier),
        "abitanti_serviti": POP_REACH.get(NATIONAL_SLUG, {}),
        "slim": True,
    }, [point_feature(p, slim=True) for _, p in points.iterrows()]))
    size_mb = (OUT / f"{NATIONAL_SLUG}.geojson").stat().st_size / 1024 / 1024
    print(f"   🇩🇪 deutschland.geojson: {len(points)} points, {size_mb:.1f} MB")

    # National coverage unions (the browser cannot union ~150k circles)
    geo_dir = OUT / "geo"
    geo_dir.mkdir(parents=True, exist_ok=True)
    locations = points_m.drop_duplicates()
    for radius in BUFFER_RADII:
        union = shapely.union_all(locations.buffer(radius, quad_segs=8).values)
        # Simplify part by part: simplify() on one MultiPolygon of ~50.000 parts
        # checks topology across all of them and takes minutes instead of seconds
        union = shapely.multipolygons(shapely.simplify(shapely.get_parts(union), 10))
        wgs = gpd.GeoSeries([union], crs=METRIC_CRS).to_crs("EPSG:4326").iloc[0]
        write_json(geo_dir / f"coverage_{radius}.geojson", {
            "type": "FeatureCollection",
            "metadata": {"radius_m": radius, "generated_from": f"{NATIONAL_SLUG}.geojson",
                         "generated_at": generated_at, "points": len(points)},
            "features": [{"type": "Feature", "properties": {"type": f"coverage_{radius}m", "buffer_m": radius},
                          "geometry": rounded(wgs)}],
        })
    print("   🎯 national coverage 300/400/500 m")

    # summary.json
    carrier_stats = {}
    for carrier in carriers:
        ok = sources.get(carrier) is not None
        carrier_stats[carrier] = {
            "available": ok,
            "total_points": int(per_carrier.get(carrier, 0)),
            "latest_update": (sources.get(carrier) or {}).get("fetched_at"),
            "source": (sources.get(carrier) or {}).get("source"),
        }
    write_json(OUT / "summary.json", {
        "generated_at": generated_at,
        "total_municipalities": len(communes),
        "carrier_stats": carrier_stats,
        "results": summary_results,
    })

    # statistics.json
    stats_records.sort(key=lambda r: (r["gemeente"], r["slug"]))
    total_area = sum(r["area_km2"] for r in stats_records) or 1
    national_stats = {
        "total": len(points),
        "luoghi": places(points),
        "luoghi_condivisi": shared_places(points),
        "population": sum(r["population"] for r in stats_records),
        "area_km2": round(total_area, 2),
        "vervoerders": {c: int(per_carrier.get(c, 0)) for c in carriers},
        "categorieen": {c: int((points["category"] == c).sum()) for c in CATEGORIES},
        "dekking": {str(r): round(sum(s["dekking"][str(r)] * s["area_km2"] for s in stats_records) / total_area, 4)
                    for r in BUFFER_RADII},
    }
    write_json(OUT / "statistics.json", {
        "generated_at": generated_at,
        "population_source": meta_territoire.get("population"),
        "national": national_stats,
        "bronnen": {c: ({k: v for k, v in s.items() if k != "source"} if s else None) for c, s in sources.items()},
        "municipalities": stats_records,
    })

    # The same records split by département: the data matrix and the
    # statistics page load one département at a time instead of ~16 MB
    stats_dir = OUT / "stats"
    stats_dir.mkdir(parents=True, exist_ok=True)
    for old in stats_dir.glob("*.json"):
        old.unlink()
    by_dep = defaultdict(list)
    for record in stats_records:
        by_dep[record["departement_slug"]].append(record)
    for dep_slug, records in by_dep.items():
        write_json(stats_dir / f"{dep_slug}.json", {"generated_at": generated_at, "municipalities": records})

    update_history(
        {"total": len(points), "providers": {c: int(n) for c, n in per_carrier.items()}},
        aggregates, commune_counts, commune_department,
    )

    print(f"\n✅ {len(points):,} points in {len(communes)} communes · {time.time() - started:.0f} s")
    for carrier in carriers:
        if per_carrier.get(carrier):
            print(f"   {carrier:14s} {per_carrier[carrier]:7,d}")
    for radius in BUFFER_RADII:
        print(f"   coverage within {radius} m: {national_stats['dekking'][str(radius)] * 100:.1f}% of the land area")
    return 0


if __name__ == "__main__":
    sys.exit(main())
