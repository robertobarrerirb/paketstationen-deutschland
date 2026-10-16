"""
Prepara i dati territoriali della Germania: Gemeinden, Kreise e Länder, con
contorni e popolazione.

Fonti
-----
- Contorni e popolazione: BKG "VG250-EW" (Verwaltungsgebiete 1:250 000 mit
  Einwohnerzahlen, stato al 31.12), GeoPackage UTM32, licenza dl-de/by-2-0.
  Il file si trova leggendo l'indice di daten.gdz.bkg.bund.de, così il nome
  esatto (che cambia con l'annata) non è scritto qui.
  Ripiego: VG250 senza abitanti (stato all'1.1); la popolazione dei comuni
  viene allora dalla griglia del censimento 2022 (scripts/fetch_zensus.py).
- Si tiene solo la parte di terra (GF = 4): niente Mare del Nord, Baltico,
  Lago di Costanza.

Corrispondenze con la versione francese (i nomi delle colonne restano quelli,
così build_data.py e la webapp sono gli stessi):
    commune / code      Gemeinde, AGS (8 cifre)
    departement / dep_* Kreis (Landkreis, Kreisfreie Stadt ...), codice a 5 cifre
    region / region_*   Land, codice a 2 cifre

Uscite
------
data/territorium/gemeinden.geojson          un poligono per Gemeinde (semplificato ~10 m)
data/territorium/deutschland_outline.geojson contorno della Germania (griglie dei fetcher)
data/territorium/meta.json                  fonti e annata
webapp/public/municipalities.json           indice per il selettore della webapp
webapp/public/data/boundaries/              contorni delle Gemeinden per Kreis,
                                            più kreise.geojson (vista Germania)

    python scripts/prepare_territorium.py [--force]
"""

from __future__ import annotations

import json
import re
import sys
import unicodedata
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import geopandas as gpd
import pandas as pd
import requests
from shapely import make_valid
from shapely.geometry import mapping
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "data" / "territorium"
RAW_DIR = OUT_DIR / "raw"
WEBAPP_PUBLIC = ROOT / "webapp" / "public"
BOUNDARIES_DIR = WEBAPP_PUBLIC / "data" / "boundaries"
ZENSUS_FILE = ROOT / "data" / "popolazione_zensus_100m.csv.gz"

BKG = "https://daten.gdz.bkg.bund.de/produkte/vg"
# (directory, with population?) in order of preference
PRODUCTS = [("vg250-ew_ebenen_1231", True), ("vg250_ebenen_0101", False), ("vg250_ebenen_1231", False)]
FILE_PATTERN = re.compile(r'href="([^"]*utm32s\.gpkg\.ebenen\.zip)"', re.I)

NATIONAL_SLUG = "deutschland"
REGION_PREFIX = "land-"
DEPARTMENT_PREFIX = "kreis-"

SIMPLIFY_DEG = 0.0001             # ~10 m
SIMPLIFY_BOUNDARIES_DEG = 0.0004  # outlines drawn at Kreis zoom
SIMPLIFY_DEPARTMENTS_DEG = 0.002  # Kreis outlines for the national view

# Kreis types written before the name ("Landkreis München"), so the district
# and the city of the same name stay apart. Cities keep the bare name.
DISTRICT_TYPES = {"Landkreis", "Kreis", "Regionalverband"}

GERMAN = str.maketrans({"ä": "ae", "ö": "oe", "ü": "ue", "Ä": "Ae", "Ö": "Oe", "Ü": "Ue", "ß": "ss"})


def slugify(text) -> str:
    text = (text if isinstance(text, str) else "").translate(GERMAN)
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-zA-Z0-9]+", "-", text).strip("-").lower()


def find_package(force: bool) -> tuple[Path, bool, str]:
    """Download the newest VG250(-EW) GeoPackage; returns (zip, has_population, url)."""
    cached = sorted(RAW_DIR.glob("*.gpkg.ebenen.zip"))
    if cached and not force:
        has_pop = "-ew" in cached[-1].name
        print(f"📦 {cached[-1].name} (in cache)")
        return cached[-1], has_pop, cached[-1].name
    last_error = None
    for product, has_pop in PRODUCTS:
        index_url = f"{BKG}/{product}/aktuell/"
        try:
            listing = requests.get(index_url, timeout=60)
            listing.raise_for_status()
            names = FILE_PATTERN.findall(listing.text)
            if not names:
                raise RuntimeError("nessun GeoPackage UTM32 nell'indice")
            url = requests.compat.urljoin(index_url, names[0])
            target = RAW_DIR / Path(names[0]).name
            print(f"⬇️  {url}")
            RAW_DIR.mkdir(parents=True, exist_ok=True)
            with requests.get(url, timeout=600, stream=True) as response:
                response.raise_for_status()
                with open(target, "wb") as handle:
                    for chunk in response.iter_content(1 << 20):
                        handle.write(chunk)
            return target, has_pop, url
        except Exception as error:  # noqa: BLE001
            print(f"⚠️  {index_url}: {error}")
            last_error = error
    raise SystemExit(f"❌ VG250 non scaricabile da {BKG}: {last_error}")


def read_layers(package: Path) -> dict[str, gpd.GeoDataFrame]:
    with zipfile.ZipFile(package) as archive:
        inner = [n for n in archive.namelist() if n.lower().endswith(".gpkg")]
        if not inner:
            raise SystemExit(f"❌ nessun .gpkg in {package.name}")
        target = RAW_DIR / Path(inner[0]).name
        if not target.exists() or target.stat().st_mtime < package.stat().st_mtime:
            with archive.open(inner[0]) as src, open(target, "wb") as dst:
                while chunk := src.read(1 << 20):
                    dst.write(chunk)
    layers = {}
    for layer in ("vg250_gem", "vg250_krs", "vg250_lan"):
        frame = gpd.read_file(target, layer=layer)
        frame.columns = [c if c == "geometry" else c.upper() for c in frame.columns]
        frame = frame[frame["GF"] == 4].to_crs("EPSG:4326")
        layers[layer] = frame
    return layers


def zensus_population(gemeinden: gpd.GeoDataFrame) -> pd.Series:
    """Residents per Gemeinde from the census 2022 100 m grid (fallback only)."""
    if not ZENSUS_FILE.exists():
        print("⚠️  griglia del censimento assente: comuni senza popolazione")
        return pd.Series(0, index=gemeinden.index)
    grid = pd.read_csv(ZENSUS_FILE)
    points = gpd.GeoDataFrame(grid, geometry=gpd.points_from_xy(grid["lon"], grid["lat"]), crs="EPSG:4326")
    joined = gpd.sjoin(points, gemeinden[["AGS", "geometry"]], how="inner", predicate="within")
    by_ags = joined.groupby("AGS")["pop"].sum()
    return gemeinden["AGS"].map(by_ags).fillna(0).round().astype(int)


def repaired(geom):
    if geom is None or geom.is_valid:
        return geom
    fixed = make_valid(geom)
    if fixed.geom_type == "GeometryCollection":
        fixed = unary_union([g for g in fixed.geoms if g.geom_type in ("Polygon", "MultiPolygon")])
    return fixed


def rounded(geometry, decimals=5):
    return json.loads(json.dumps(mapping(geometry)), parse_float=lambda x: round(float(x), decimals))


def write_geojson(path: Path, features: list) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump({"type": "FeatureCollection", "features": features}, handle,
                  ensure_ascii=False, separators=(",", ":"))


def kreis_name(row) -> str:
    bez = str(row.get("BEZ") or "").strip()
    name = str(row["GEN"]).strip()
    if bez in DISTRICT_TYPES and not name.startswith(bez):
        return f"{bez} {name}"
    return name


def main() -> int:
    force = "--force" in sys.argv
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    package, has_population, source_url = find_package(force)
    layers = read_layers(package)
    gem, krs, lan = layers["vg250_gem"], layers["vg250_krs"], layers["vg250_lan"]
    print(f"🗺️  {len(gem)} Gemeinden, {len(krs)} Kreise, {len(lan)} Länder")

    gem = gem.dissolve(by="AGS", as_index=False, aggfunc="first") if gem["AGS"].duplicated().any() else gem
    krs = krs.copy()
    krs["name"] = krs.apply(kreis_name, axis=1)
    lan = lan.copy()
    lan["name"] = lan["GEN"].astype(str)

    communes = gpd.GeoDataFrame({
        "commune": gem["GEN"].astype(str).str.strip(),
        "code": gem["AGS"].astype(str),
        "bez": gem["BEZ"].astype(str),
        "dep_code": gem["AGS"].astype(str).str[:5],
        "region_code": gem["AGS"].astype(str).str[:2],
    }, geometry=gem.geometry.values, crs="EPSG:4326")

    if has_population and "EWZ" in gem.columns:
        communes["population"] = pd.to_numeric(gem["EWZ"], errors="coerce").fillna(0).astype(int).values
        population_source = "BKG VG250-EW, Einwohnerzahlen der Statistischen Ämter (Fortschreibung)"
    else:
        communes["population"] = zensus_population(gem).values
        population_source = "Zensus 2022, Gitterzellen 100 m (Summe je Gemeinde)"

    dep_name = dict(zip(krs["AGS"].astype(str), krs["name"]))
    region_name = dict(zip(lan["AGS"].astype(str), lan["name"]))
    communes["departement"] = communes["dep_code"].map(dep_name)
    communes["region"] = communes["region_code"].map(region_name)
    missing = communes["region"].isna() | communes["departement"].isna()
    if missing.any():
        print(f"⚠️  {int(missing.sum())} Gemeinden senza Kreis/Land: ignorate "
              f"({', '.join(communes.loc[missing, 'code'].head(5))})")
        communes = communes[~missing].copy()

    # Kreis and Land slugs
    krs["slug"] = DEPARTMENT_PREFIX + krs["name"].map(slugify)
    if krs["slug"].duplicated().any():
        dup = krs["slug"].duplicated(keep=False)
        krs.loc[dup, "slug"] = krs.loc[dup, "slug"] + "-" + krs.loc[dup, "AGS"].astype(str)
    lan["slug"] = REGION_PREFIX + lan["name"].map(slugify)

    # Gemeinde slugs: names repeat a lot (Neustadt, Altenberg ...). A repeated
    # name gets its Kreis (without "Landkreis"/"Kreis"), a repeat inside one
    # Kreis the AGS.
    dep_short = {code: slugify(re.sub(r"^(Landkreis|Kreis|Regionalverband)\s+", "", name))
                 for code, name in dep_name.items()}
    base = communes["commune"].map(slugify)
    duplicated = base.duplicated(keep=False)
    slugs = pd.Series([f"{b}-{dep_short[d]}" if dup else b
                       for b, d, dup in zip(base, communes["dep_code"], duplicated)], index=communes.index)
    still = slugs.duplicated(keep=False)
    slugs[still] = base[still] + "-" + communes.loc[still, "code"]
    reserved = {NATIONAL_SLUG, "ganz-deutschland"} | set(krs["slug"]) | set(lan["slug"])
    clash = slugs.isin(reserved)
    slugs[clash] = slugs[clash] + "-" + communes.loc[clash, "code"]
    communes["slug"] = slugs
    assert communes["slug"].is_unique and krs["slug"].is_unique and lan["slug"].is_unique

    communes["dep_slug"] = communes["dep_code"].map(dict(zip(krs["AGS"].astype(str), krs["slug"])))
    communes["region_slug"] = communes["region_code"].map(dict(zip(lan["AGS"].astype(str), lan["slug"])))
    communes["geometry"] = communes.geometry.map(repaired).simplify(SIMPLIFY_DEG, preserve_topology=True)

    out = communes[["commune", "slug", "code", "bez", "dep_code", "departement", "dep_slug",
                    "region_code", "region", "region_slug", "population", "geometry"]]
    out.to_file(OUT_DIR / "gemeinden.geojson", driver="GeoJSON")
    print(f"💾 {OUT_DIR / 'gemeinden.geojson'} · {int(out['population'].sum()):,} abitanti")

    outline = unary_union(lan.geometry.map(repaired)).simplify(0.005)
    write_geojson(OUT_DIR / "deutschland_outline.geojson",
                  [{"type": "Feature", "properties": {"name": "Deutschland"}, "geometry": rounded(outline, 4)}])

    def pop_sum(frame) -> int:
        return int(frame["population"].fillna(0).sum())

    # municipalities.json: Deutschland, Länder, Kreise, then every Gemeinde
    index = [{
        "name": "Deutschland", "slug": NATIONAL_SLUG, "kind": "country",
        "region": None, "region_slug": None,
        "department": None, "department_slug": None, "department_code": None,
        "population": pop_sum(out), "code": None,
    }]
    for _, land in lan.sort_values("name").iterrows():
        code = str(land["AGS"])
        index.append({
            "name": land["name"], "slug": land["slug"], "kind": "region",
            "region": land["name"], "region_slug": land["slug"],
            "department": None, "department_slug": None, "department_code": None,
            "population": pop_sum(out[out["region_code"] == code]), "code": code,
        })
    for _, kreis in krs.sort_values("AGS").iterrows():
        code = str(kreis["AGS"])
        land_code = code[:2]
        index.append({
            "name": kreis["name"], "slug": kreis["slug"], "kind": "department",
            "region": region_name.get(land_code), "region_slug": REGION_PREFIX + slugify(region_name.get(land_code, "")),
            "department": kreis["name"], "department_slug": kreis["slug"], "department_code": code,
            "population": pop_sum(out[out["dep_code"] == code]), "code": code,
        })
    for _, row in out.sort_values(["commune", "dep_code"]).iterrows():
        index.append({
            "name": row["commune"], "slug": row["slug"], "kind": "commune",
            "region": row["region"], "region_slug": row["region_slug"],
            "department": row["departement"], "department_slug": row["dep_slug"], "department_code": row["dep_code"],
            "population": int(row["population"] or 0), "code": row["code"],
        })
    with open(WEBAPP_PUBLIC / "municipalities.json", "w", encoding="utf-8") as handle:
        json.dump(index, handle, ensure_ascii=False, separators=(",", ":"))
    print(f"💾 municipalities.json: {len(index)} voci")

    # Gemeinde outlines per Kreis (Kreis and Land views), and the Kreis
    # outlines for the national view (10.800 Gemeinden are too many)
    BOUNDARIES_DIR.mkdir(parents=True, exist_ok=True)
    for old in BOUNDARIES_DIR.glob("*.geojson"):
        old.unlink()
    files = []
    for (code, name, slug, region_slug), group in out.groupby(["dep_code", "departement", "dep_slug", "region_slug"]):
        features = [{
            "type": "Feature",
            "properties": {"type": "boundary", "gemeente": r["commune"], "slug": r["slug"]},
            "geometry": rounded(r.geometry.simplify(SIMPLIFY_BOUNDARIES_DEG, preserve_topology=True), 4),
        } for _, r in group.iterrows()]
        path = BOUNDARIES_DIR / f"{slug}.geojson"
        write_geojson(path, features)
        files.append({"name": name, "code": code, "slug": slug, "region_slug": region_slug,
                      "file": f"boundaries/{path.name}",
                      "size_mb": round(path.stat().st_size / 1024 / 1024, 2),
                      "boundaries_count": len(features)})
    dep_features = [{
        "type": "Feature",
        "properties": {"type": "boundary", "gemeente": k["name"], "slug": k["slug"], "code": str(k["AGS"])},
        "geometry": rounded(repaired(k.geometry).simplify(SIMPLIFY_DEPARTMENTS_DEG, preserve_topology=True), 4),
    } for _, k in krs.iterrows()]
    write_geojson(BOUNDARIES_DIR / "kreise.geojson", dep_features)
    with open(BOUNDARIES_DIR / "index.json", "w", encoding="utf-8") as handle:
        json.dump({
            "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "departments_file": "boundaries/kreise.geojson",
            "total_departments": len(files),
            "total_boundaries": sum(f["boundaries_count"] for f in files),
            "departments": files,
        }, handle, ensure_ascii=False, indent=1)
    print(f"💾 contorni: {len(files)} Kreise, {sum(f['size_mb'] for f in files):.1f} MB")

    with open(OUT_DIR / "meta.json", "w", encoding="utf-8") as handle:
        json.dump({
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "contours": f"BKG VG250 (dl-de/by-2-0), {Path(source_url).name}",
            "population": population_source,
            "communes": len(out),
            "departements": len(krs),
            "regions": len(lan),
        }, handle, ensure_ascii=False, indent=1)
    return 0


if __name__ == "__main__":
    sys.exit(main())
