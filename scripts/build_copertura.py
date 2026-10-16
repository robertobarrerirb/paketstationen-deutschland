"""
Dati per l'analisi di copertura (webapp: /data-export/copertura).

Input
  + data/<corriere>_all_locations.json      cache dei corrieri (Amazon incluso se presente)
  + data/popolazione_zensus_100m.csv.gz     popolazione del censimento 2022 su celle di 100 m
                                            (scripts/fetch_zensus.py); se manca:
  + data/popolazione_h3_r8.csv.gz           popolazione Kontur su esagoni H3 r8
                                            (scripts/fetch_popolazione.py)
  + webapp/public/data/boundaries/*.geojson contorni delle Gemeinden (scripts/prepare_territorium.py)
  + webapp/public/municipalities.json       popolazione per Gemeinde (VG250-EW)

Output in webapp/public/data/copertura/
  meta.json     corrieri, comuni, regioni, fonte della popolazione
  esagoni.bin   per ogni esagono: lat, lon (Int32 ×1e6), abitanti (Float32), comune (Uint16)
  celle.bin     (solo con la griglia del censimento) abitanti su celle di 200 m (1 km dove radi):
                Uint16 lat, Uint16 lon quantizzati (meta.celle), Float32 abitanti, Uint16 comune;
                lib/residents.ts li usa per gli abitanti entro 5 minuti
  punti.json    sedi fisiche distinte: lat, lon (×1e5), tipo, maschera dei corrieri, via

Il calcolo della copertura (raggio, reti, tipi di punto) avviene nel browser, così
i parametri si cambiano senza rigenerare nulla. Una sede condivisa da più reti
(es. un chiosco Hermes PaketShop e DPD Pickup) è una sola sede con più bit accesi.
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import geopandas as gpd
import h3
import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_data import CARRIERS, METRIC_CRS, WEBAPP_PUBLIC, DATA_DIR, load_caches, repaired  # noqa: E402

OUT = WEBAPP_PUBLIC / "data" / "copertura"
POP_FILE = DATA_DIR / "popolazione_h3_r8.csv.gz"
CARREAUX_FILE = DATA_DIR / "popolazione_zensus_100m.csv.gz"  # Zensus 2022, 100 m cells
# celle.bin: residents on a 200 m grid (1 km where sparse: fewer than 10 residents), coordinates quantised on Germany
CELL_M, SPARSE_POP, SPARSE_M = 200, 10.0, 1000
Q_LAT0, Q_LON0, Q_STEP = 47.0, 5.5, 0.00025
TYPES = ["locker", "pickup_point", "post_office"]


def load_comuni() -> tuple[gpd.GeoDataFrame, pd.DataFrame]:
    index = json.loads((WEBAPP_PUBLIC / "data" / "boundaries" / "index.json").read_text(encoding="utf-8"))
    frames = [gpd.read_file(WEBAPP_PUBLIC / "data" / p["file"]) for p in index["departments"]]
    bounds = pd.concat(frames, ignore_index=True)[["slug", "geometry"]]
    bounds = gpd.GeoDataFrame(bounds, geometry="geometry", crs="EPSG:4326")
    bounds["geometry"] = bounds.geometry.apply(repaired)
    muni = json.loads((WEBAPP_PUBLIC / "municipalities.json").read_text(encoding="utf-8"))
    info = pd.DataFrame([m for m in muni if m.get("kind") == "commune"])
    info = info[["slug", "name", "department", "region", "population", "code"]]
    return bounds, info


def carreaux_cells():
    if not CARREAUX_FILE.exists():
        return None
    return pd.read_csv(CARREAUX_FILE, dtype={"code": str}, low_memory=False)


def build_hexes(bounds: gpd.GeoDataFrame, info: pd.DataFrame, carreaux=None):
    if carreaux is not None:
        # H3 r8 hexagons with the census residents (instead of Kontur's estimate)
        cells = [h3.latlng_to_cell(la, lo, 8) for la, lo in zip(carreaux["lat"], carreaux["lon"])]
        pop = carreaux.assign(h3=cells).groupby("h3", as_index=False)["pop"].sum()
    else:
        pop = pd.read_csv(POP_FILE)
    latlon = np.array([h3.cell_to_latlng(c) for c in pop["h3"]])
    pts = gpd.GeoDataFrame(pop, geometry=gpd.points_from_xy(latlon[:, 1], latlon[:, 0]), crs="EPSG:4326")
    pts["lat"], pts["lon"] = latlon[:, 0], latlon[:, 1]
    joined = gpd.sjoin(pts, bounds, how="left", predicate="within")
    joined = joined[~joined.index.duplicated(keep="first")].drop(columns=["index_right"])
    missing = joined["slug"].isna()
    if missing.any():  # centro dell'esagono in mare o fuori confine: comune più vicino
        loose = joined.loc[missing].drop(columns=["slug"]).to_crs(METRIC_CRS)
        near = gpd.sjoin_nearest(loose, bounds.to_crs(METRIC_CRS), how="left")
        near = near[~near.index.duplicated(keep="first")]
        joined.loc[near.index, "slug"] = near["slug"]
    info = info.reset_index(drop=True)
    slug_index = {s: i for i, s in enumerate(info["slug"])}
    joined["c"] = joined["slug"].map(slug_index)
    joined = joined.dropna(subset=["c"])
    print(f"   🔷 {len(joined)} esagoni · {int(joined['pop'].sum()):,} abitanti · "
          f"{int(missing.sum())} agganciati al comune più vicino")
    # Popolazione Kontur per comune: sostituisce il dato ufficiale dove manca
    kpop = joined.groupby("c")["pop"].sum()
    return joined, kpop


def build_points():
    gdf, _ = load_caches()
    gdf = gdf[gdf["puntType"].isin(TYPES)].copy()
    carriers = list(CARRIERS)
    gdf["bit"] = gdf["vervoerder"].map(lambda c: 1 << carriers.index(c))
    gdf["klat"] = (gdf["latitude"] * 1e4).round().astype(int)
    gdf["klon"] = (gdf["longitude"] * 1e4).round().astype(int)
    grouped = gdf.groupby(["klat", "klon", "puntType"], sort=False).agg(
        lat=("latitude", "first"), lon=("longitude", "first"), m=("bit", lambda b: int(np.bitwise_or.reduce(b.values))),
        via=("straatNaam", "first"), n=("vervoerder", "size")).reset_index()
    counts = {c: int((gdf["vervoerder"] == c).sum()) for c in carriers}
    sites = {c: int((grouped["m"] & (1 << i) > 0).sum()) for i, c in enumerate(carriers)}
    print(f"   📦 {len(gdf)} punti → {len(grouped)} sedi fisiche distinte")
    return grouped, counts, sites


def clean_via(v) -> str:
    v = str(v or "").strip().rstrip(",")
    return v.title() if v.isupper() else v


def build_cells(carreaux: pd.DataFrame, info: pd.DataFrame, bounds: gpd.GeoDataFrame) -> tuple[int, bytes]:
    """celle.bin: Uint16 lat, Uint16 lon (quantised), Float32 residents, Uint16 commune index."""
    from pyproj import Transformer

    fwd = Transformer.from_crs(4326, METRIC_CRS, always_xy=True)
    back = Transformer.from_crs(METRIC_CRS, 4326, always_xy=True)
    x, y = fwd.transform(carreaux["lon"].to_numpy(), carreaux["lat"].to_numpy())
    # the commune under each cell; the cell's commune code when it falls outside (coast, border)
    pts = gpd.GeoDataFrame(geometry=gpd.points_from_xy(carreaux["lon"], carreaux["lat"]), crs="EPSG:4326")
    hit = gpd.sjoin(pts, bounds, how="left", predicate="within")
    hit = hit[~hit.index.duplicated(keep="first")].sort_index()
    slug_index = {sl: i for i, sl in enumerate(info["slug"])}
    code_index = {str(c).zfill(5): i for i, c in enumerate(info["code"])}
    com = hit["slug"].map(slug_index)
    com = com.fillna(carreaux["code"].map(code_index)).fillna(-1).astype(int).to_numpy()
    df = pd.DataFrame({"kx": (x // CELL_M).astype(int), "ky": (y // CELL_M).astype(int), "p": carreaux["pop"].to_numpy(),
                       "px": x * carreaux["pop"].to_numpy(), "py": y * carreaux["pop"].to_numpy(), "c": com})
    main_c = df.sort_values("p").drop_duplicates(["kx", "ky"], keep="last").set_index(["kx", "ky"])["c"]
    g = df.groupby(["kx", "ky"]).agg(p=("p", "sum"), px=("px", "sum"), py=("py", "sum"))
    g["c"] = main_c
    g = g[g["p"] > 0]
    g["x"], g["y"] = g["px"] / g["p"], g["py"] / g["p"]  # residents' centre
    dense, sparse = g[g["p"] >= SPARSE_POP], g[g["p"] < SPARSE_POP]
    sparse = sparse.assign(px=sparse["x"] * sparse["p"], py=sparse["y"] * sparse["p"],
                           bx=(sparse["x"] // SPARSE_M).astype(int), by=(sparse["y"] // SPARSE_M).astype(int))
    sb = sparse.groupby(["bx", "by", "c"]).agg(p=("p", "sum"), px=("px", "sum"), py=("py", "sum"))
    sb["x"], sb["y"] = sb["px"] / sb["p"], sb["py"] / sb["p"]
    sb = sb.reset_index()
    allx = np.concatenate([dense["x"].to_numpy(), sb["x"].to_numpy()])
    ally = np.concatenate([dense["y"].to_numpy(), sb["y"].to_numpy()])
    allp = np.concatenate([dense["p"].to_numpy(), sb["p"].to_numpy()])
    allc = np.concatenate([dense["c"].to_numpy(), sb["c"].to_numpy()])
    keep = (allc >= 0) & (allp > 0)
    lon, lat = back.transform(allx[keep], ally[keep])
    qlat = np.clip(np.round((lat - Q_LAT0) / Q_STEP), 0, 65535).astype("<u2")
    qlon = np.clip(np.round((lon - Q_LON0) / Q_STEP), 0, 65535).astype("<u2")
    print(f"   🏘️  {int(keep.sum())} celle di popolazione ({len(dense)} da {CELL_M} m, {len(sb)} da {SPARSE_M} m)")
    return int(keep.sum()), qlat.tobytes() + qlon.tobytes() + allp[keep].astype("<f4").tobytes() + allc[keep].astype("<u2").tobytes()


def main() -> int:
    if not POP_FILE.exists() and not CARREAUX_FILE.exists():
        print(f"❌ {POP_FILE.relative_to(DATA_DIR.parent)} mancante: esegui scripts/fetch_popolazione.py")
        return 1
    print("📊 Dati per l'analisi di copertura")
    bounds, info = load_comuni()
    carreaux = carreaux_cells()
    hexes, kpop = build_hexes(bounds, info, carreaux)
    points, counts, sites = build_points()
    OUT.mkdir(parents=True, exist_ok=True)

    n = len(hexes)
    buf = b"".join([
        np.round(hexes["lat"].values * 1e6).astype("<i4").tobytes(),
        np.round(hexes["lon"].values * 1e6).astype("<i4").tobytes(),
        hexes["pop"].values.astype("<f4").tobytes(),
        hexes["c"].values.astype("<u2").tobytes(),
    ])
    (OUT / "esagoni.bin").write_bytes(buf)
    celle = 0
    if carreaux is not None:
        celle, cbuf = build_cells(carreaux, info.reset_index(drop=True), bounds)
        (OUT / "celle.bin").write_bytes(cbuf)
    elif (OUT / "celle.bin").exists():
        (OUT / "celle.bin").unlink()

    type_index = {t: i for i, t in enumerate(TYPES)}
    punti = {
        "lat": np.round(points["lat"].values * 1e5).astype(int).tolist(),
        "lon": np.round(points["lon"].values * 1e5).astype(int).tolist(),
        "t": points["puntType"].map(type_index).astype(int).tolist(),
        "m": points["m"].astype(int).tolist(),
        "v": [clean_via(v) for v in points["via"]],
    }
    with open(OUT / "punti.json", "w", encoding="utf-8") as fh:
        json.dump(punti, fh, ensure_ascii=False, separators=(",", ":"))

    comuni = []
    for i, row in info.iterrows():
        ufficiale = int(row["population"] or 0)
        comuni.append([row["slug"], row["name"], row["department"], row["region"],
                       ufficiale if ufficiale > 0 else int(round(kpop.get(i, 0)))])
    pop_meta = {}
    log = DATA_DIR / "popolazione_log.txt"
    if log.exists():
        first = next((l for l in log.read_text(encoding="utf-8").splitlines() if l.startswith("Scarico")), "")
        pop_meta["file"] = first.replace("Scarico ", "").rsplit("/", 1)[-1]
    meta = {
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "popolazione": ({"fonte": "Zensus 2022, Gitterzellen 100 m (Statistische Ämter des Bundes und der Länder, dl-de/by-2-0)",
                         "abitanti": int(hexes["pop"].sum())}
                        if carreaux is not None else
                        {"fonte": "Kontur Population (H3 r8, CC BY 4.0)", **pop_meta, "abitanti": int(hexes["pop"].sum())}),
        "celle": {"n": celle, "lat0": Q_LAT0, "lon0": Q_LON0, "step": Q_STEP} if celle else None,
        "tipi": TYPES,
        "corrieri": [{"key": c, "punti": counts.get(c, 0), "sedi": sites.get(c, 0)} for c in CARRIERS],
        "esagoni": n,
        "sedi": len(points),
        "comuni": comuni,
    }
    with open(OUT / "meta.json", "w", encoding="utf-8") as fh:
        json.dump(meta, fh, ensure_ascii=False, separators=(",", ":"))
    size = sum(p.stat().st_size for p in OUT.iterdir()) / 1e6
    print(f"   ✅ webapp/public/data/copertura/ · {size:.1f} MB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
