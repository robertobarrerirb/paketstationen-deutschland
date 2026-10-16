"""
Residents on the census 2022 100 m grid (Zensus 2022, "Bevölkerungszahl in Gitterzellen").

Source: Destatis / Statistische Ämter des Bundes und der Länder, Zensus 2022, 100 m cells
(dl-de/by-2-0), as packed in parquet by the z22 project (github.com/jslth/z22data,
z22_data_100m/population_0.parquet): x, y = cell centre in ETRS89-LAEA (EPSG:3035),
value = residents. Cells with fewer than 3 residents are blanked by the census
(secrecy), so the grid totals ~82.6 million against 82.7.

Output: data/popolazione_zensus_100m.csv.gz with lon, lat (cell centre), pop, code
(empty: the Gemeinde is assigned by point-in-polygon where needed).
Used by scripts/build_data.py (residents within 5 minutes of each place),
scripts/build_copertura.py (celle.bin for the browser) and, without VG250-EW,
scripts/prepare_territorium.py (population per Gemeinde). Workflow "Scarica popolazione".

    python scripts/fetch_zensus.py [file.parquet]
"""

from __future__ import annotations

import io
import sys
import time
from pathlib import Path

import pandas as pd
import requests
from pyproj import Transformer

from common import USER_AGENT

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "popolazione_zensus_100m.csv.gz"
URL = "https://github.com/jslth/z22data/raw/refs/heads/main/z22_data_100m/population_0.parquet"


def download() -> bytes:
    for attempt in range(4):
        try:
            r = requests.get(URL, headers={"User-Agent": USER_AGENT}, timeout=600)
            r.raise_for_status()
            if not r.content.startswith(b"PAR1"):
                raise RuntimeError("il file scaricato non è un parquet")
            return r.content
        except Exception as error:  # noqa: BLE001 - network, retried
            if attempt == 3:
                raise SystemExit(f"❌ griglia del censimento non raggiungibile: {error}")
            time.sleep(15 * (attempt + 1))
    return b""


def main() -> int:
    started = time.time()
    print("👥 Popolazione del censimento 2022 su celle di 100 m")
    if len(sys.argv) > 1:
        frame = pd.read_parquet(sys.argv[1])
    else:
        content = download()
        print(f"   {len(content) / 1e6:.0f} MB scaricati")
        frame = pd.read_parquet(io.BytesIO(content))
    frame.columns = [c.lower() for c in frame.columns]
    frame = frame[frame["value"] > 0]
    lon, lat = Transformer.from_crs(3035, 4326, always_xy=True).transform(
        frame["x"].to_numpy(), frame["y"].to_numpy())
    out = pd.DataFrame({"lon": lon.round(6), "lat": lat.round(6),
                        "pop": frame["value"].astype(int).to_numpy(), "code": ""})
    if out["pop"].sum() < 70e6:
        raise SystemExit(f"❌ solo {out['pop'].sum():,.0f} abitanti: file incompleto?")
    out.to_csv(OUT, index=False, compression="gzip")
    print(f"✅ {len(out)} celle · {out['pop'].sum():,.0f} abitanti · "
          f"{(time.time() - started) / 60:.1f} min → {OUT.name} ({OUT.stat().st_size / 1e6:.0f} MB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
