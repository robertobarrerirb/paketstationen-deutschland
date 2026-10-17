# CLAUDE.md

Guidance for coding agents working in this repository.

## What this is

German version of Punti di ritiro Italia (by way of the French version, Points relais France;
all ports of Pakketpunten, NL): parcel pickup points (Paketstationen, Paketshops, Postfilialen) for
the ~10,800 Gemeinden, ~400 Kreise and 16 Länder of Germany, with a DE / IT / EN UI.

- **Python** (`scripts/`): one nationwide fetcher per network → `data/<stem>_all_locations.json`
  (common record schema in `scripts/common.py`), then `scripts/build_data.py` does a single
  spatial join against the Gemeinden and writes everything under `webapp/public/data/`.
- **Next.js** (`webapp/`): Leaflet map, filters, statistics, matrix, coverage analysis, export, API v1.

There are **no per-Gemeinde API calls**: every network is fetched nationwide and cached.

The code keeps the French version's names: a Gemeinde is a `commune`, a Kreis a `department`
(`departement*` keys in the data files), a Land a `region`, and the AGS sits in `code` / `insee`.

## Commands

```bash
pip install -r requirements.txt
python scripts/prepare_territorium.py  # BKG VG250-EW boundaries + population (run first)
python scripts/fetch_dpd.py            # also: fetch_dhl (DHL_API_KEY optional), fetch_gls,
                                       # fetch_fedex, fetch_osm (fallback for every network);
                                       # from the PC: fetch_amazon, fetch_ups_pc
python scripts/fetch_zensus.py         # census 2022 100 m grid (data/popolazione_zensus_100m.csv.gz)
python scripts/build_data.py           # all webapp data
python scripts/build_copertura.py      # coverage analysis data (needs the census grid)
python scripts/check_cache_freshness.py --max-age-days 45

cd webapp && npm install && npm run dev   # port 3002 (Italy 3000, France 3001)
```

## Conventions

- **CRS**: WGS84 (EPSG:4326) for I/O; **ETRS89 / UTM zone 32N (EPSG:25832)** for any metric
  operation (buffers, areas). Never buffer in degrees.
- **Territory** (`scripts/prepare_territorium.py`): BKG VG250-EW GeoPackage (UTM32, stand 31.12,
  with population EWZ), found by reading the index of daten.gdz.bkg.bund.de; only the land part
  (GF = 4). Fallback: VG250 without population, then population summed from the census grid.
- **Slugs** (`webapp/lib/territory.ts`): `deutschland` (national, URL alias `ganz-deutschland`),
  `land-<name>` (16), `kreis-<name>` (~400; districts carry their type: `kreis-landkreis-muenchen`
  vs the city `kreis-muenchen`), Gemeinden from the name with umlauts transliterated (ä → ae,
  ß → ss); repeated names get their Kreis (`neustadt-coburg`), a repeat inside one Kreis the AGS.
  URL param is `?gemeinde=` (`?commune=`, `?comune=` and `?gemeente=` still read).
- **Area kinds** in `municipalities.json`: `country | region | department | commune`, with
  `region(_slug)`, `department(_slug)`, `department_code` (5-digit Kreis key), `code` (AGS).
- **Networks**: keys `DHL, Hermes, DPD, GLS, UPS, Amazon, FedEx, myflexbox, DeinFach, MBE,
  NovaPost`. DHL = Deutsche Post / DHL (Packstation, Poststation, Postfiliale, Paketshop):
  DHL Parcel's keyless API if it answers for DE, else the Location Finder Unified API with
  `DHL_API_KEY`. DPD from `pickup.dpd.cz/api/getAll?country=276`; GLS from api.gls-group.net
  (public header `apikey`, `partnerId` GLS_DE); Hermes from the PaketShop finder's API
  (`paketshop.myhermes.de/api/v1/parcelshops/search?address=lat,lon`, no key, always the 20
  nearest: `crawl_cells(full=...)` splits a cell only when the 20th is inside its reach); myflexbox
  from `api.myflexbox.de/api/1/lockers` (one call, the list behind myflexbox.com's map). DeinFach
  (merging into myflexbox since October 2026) from the station list embedded in its finder
  widget (`standortfinder.deinfach.de/location-finder-widget.es.js`, `JSON.parse('[...]')` of
  GeoJSON Features with coordinates as [lat, lon]). NovaPost from
  `api.novapost.com/site/v.1.0/divisions?countryCodes[]=DE` (100 per page): ~40 own branches and
  ~11,500 PUDO points that are DPD Pickup shops, named "Nova Post PUDO" so they join the DPD shop
  by address. MBE comes from OpenStreetMap until a
  direct source is found with `scripts/scopri.py` (records a locator's network calls from a
  visible browser on the user's PC). `fetch_osm.py` assigns an OSM element to every network named
  in brand / operator / post_office:brand and never overwrites a cache whose `metadata.method` is
  not `osm-overpass`. LPR Logistik and Parcelly were asked for and set aside (no public map of German points; Parcelly now sells PUDO software). Keep `CARRIERS` in
  `scripts/build_data.py`, `NETWORKS`/`STEMS` in `scripts/fetch_osm.py`, `CARRIER_NAMES` in
  `scripts/check_cache_freshness.py`, `CARRIER_ORDER` / `CARRIER_SOURCE` in
  `webapp/lib/carriers.ts` and `SOURCES` in `webapp/components/AboutModal.tsx` in sync. The
  series palette (11 of 12 validated hues; the 12th, orange, is free) was validated with the dataviz validator; re-run it if you add one.
- A point used by several networks is listed under each; `scripts/shared_points.py` gives every
  listing of one physical place the same `gruppo` (+ `reti`); the map draws one marker per place.
  Lockers only join lockers; DHL Packstationen / Poststationen and Amazon Lockers never join
  another network's locker unless that listing carries the owner's brand (DeinFach stations
  are Deutsche Post's: they may join the "Packstation 6xx" DHL lists there); open stations
  (myflexbox, DeinFach) may be listed by several networks. A Postfiliale is a partner
  shop in Germany, so post offices are not kept apart. amazon.de also offers other networks'
  points (DHL ~38,000, Hermes, DPD, myflexbox: ~47,500 of its ~52,000), listed as "DHL Postfiliale 603"
  with that label as address: they join the named network's listing within 30 m (`amazon_3p`).
  As in France, they stay counted under Amazon too. "Str." / "Straße" are normalised to one
  street word; German addresses put the number last ("Hauptstraße 12a").
  Position of a shared place (`place_positions` in `build_data.py`): where most listings with a
  street address agree (within 30 m), at their mean; the Gemeinde is assigned afterwards.
  "Address beats coordinates" (Roberto's rule) runs only when `data/posizioni_indirizzi.json`
  exists: no German address source yet (the Italian version uses OSM, `osm_indirizzi.py`).
- **puntType**: `locker` | `pickup_point` | `post_office`; only `locker` is a locker.
- **Opening hours**: `{mon, tue, wed, thu, fri, sat, sun}` with `"HH:MM - HH:MM[, ...]"` or `"closed"`.
- GeoJSON property names are inherited from the Dutch project (`locatieNaam`, `vervoerder`,
  `openingstijden`, ...) and the Italian port (`cap` = PLZ, `citta` = Ort) for compatibility.
- `bezettingsgraad` is always 50: there is no real occupancy data.
- Population served (`population_served()` in `build_data.py`): per place, `abitanti5min` =
  residents within 400 m (5 minutes on foot, straight line) and `abitantiServiti` = the same
  residents split equally among all the places within their 400 m; per territory, metadata
  `abitanti_serviti` (per network, `_tutte` = any). Population: the census 2022 100 m grid
  (`scripts/fetch_zensus.py`, from github.com/jslth/z22data; cells under 3 residents are blanked
  by the census), scaled to each Gemeinde's VG250-EW population. The filter panel and the
  territory box recompute residents in the browser (`lib/residents.ts` on `celle.bin`, 200 m cells
  quantised from lat 47.0 / lon 5.5).

## Languages (webapp)

Every UI string is in `webapp/lib/messages/de.ts` (keys) with `it.ts` and `en.ts` typed against
it: a missing translation fails `tsc`. Components use `useI18n()` from `lib/i18n.tsx`
(`t(key, vars)`, `tp(base, count)` for `_one`/`_other` plurals, `fmt` / `fmtDate` for the
locale); API routes use `translate()` from `lib/translate.ts` (no React). The language comes from
`?lang=`, else localStorage, else the browser, else German; the server always renders German.
Area terms: DE Gemeinde / Kreis / Bundesland, IT comune / circondario / Land, EN municipality /
district / state. Network names are brand names and stay untranslated (`CARRIER_LABELS`). Python
console output for scripts the user runs on their PC is in Italian; data, API and code comments
are English.

## Cache guard

`scripts/cache_guard.py` refuses to overwrite a cache when the count drops >20% (exit 2) and
self-heals when the drop repeats on the next run. `CACHE_GUARD_FORCE=1` accepts immediately.
The workflow commits `data/fetch_history.json` whatever the outcome.

## Webapp data files

- `/municipalities.json` — Deutschland, Länder, Kreise, Gemeinden
- `/data/<slug>.geojson` — points + `boundary` feature (Gemeinden, Kreise, Länder)
- `/data/deutschland.geojson` — all points, without opening hours (size)
- `/data/geo/coverage_<r>.geojson` — national coverage unions
- `/data/boundaries/kreis-*.geojson` + `index.json` — Gemeinde outlines per Kreis (Land and Kreis
  views; also used server-side by `lib/comuneLookup.ts` for geocoding); `kreise.geojson` — Kreis
  outlines for the national view
- `/data/stats/kreis-*.json` — per-Gemeinde statistics of one Kreis (data matrix and statistics
  page load one at a time; the full `statistics.json` stays server-side)
- `/data/history/kreis-*.json` — per-Gemeinde history; `totals_history.json` holds Germany, Länder
  and Kreise
- `summary.json`, `statistics.json`
- `/data/copertura/` — coverage analysis (`/data-export/coverage`): `esagoni.bin` (population on
  H3 r8 hexagons from the census grid: Int32 lat, Int32 lon ×1e6, Float32 pop, Uint16 Gemeinde
  index), `celle.bin` (census residents on 200 m cells, 1 km where fewer than 10: Uint16 lat/lon
  quantised as `meta.celle`, Float32 pop, Uint16 Gemeinde; used by `lib/residents.ts`),
  `punti.json` (distinct sites with network bitmask in `CARRIERS` order, Uint16: max 16 networks)
  and `meta.json`. Coverage is computed in the browser (`lib/coverage.ts`).

Bulk data is excluded from serverless bundles (`next.config.ts`); API routes read area files
through `lib/publicData.ts` (local file, else fetch from the static host).

## Map rendering (webapp/components/Map.tsx)

Performance-critical: Germany has ~100,000+ places. Coverage (300/400/500 m) is one canvas layer
per radius (`MergedCircles`), not Turf unions. Dots (Germany, Länder, Kreise, >1,500 places
in view) are one canvas layer (`CanvasPlaces`) with hit-testing; logo markers are culled to the
viewport, icons cached per zoom band. A single popup is created on click. Avoid per-marker React
children or anything keyed on the exact zoom level.

## Geocoding

`/api/geocode` proxies Photon (komoot) with `lang=de|it|en` and a Germany bbox. The Gemeinde is
resolved by point-in-polygon against the BKG outlines, never by name matching.
`PHOTON_URL` overrides the instance.
