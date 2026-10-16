"""
Amazon Hub Lockers and Counters in Germany (amazon.de).

API: GET https://www.amazon.de/location_selector/fetch_locations
         ?latitude=..&longitude=..&clientId=..&countryCode=DE
     The endpoint behind the pickup-location search page (/ulp). It returns
     20 points within ~15 km of a coordinate (sortType=NEAREST). It needs the
     cookies of a browser session, so Playwright opens the store once (or the
     cookies come from the Firefox installed on the PC); then every call is a
     plain HTTP request.

Strategy: adaptive grid over the outline of Germany
(data/territorium/deutschland_outline.geojson). Each cell is searched from its
centre; when 20 points come back and the 20th is closer than the corners, the
cell is split in four. Cells start at 16 km, so a corner (11.3 km) stays
within the search radius.

As in the Italian version, run it on the PC (Amazon blocks GitHub runners):
    pip install playwright && playwright install chromium

    python scripts/fetch_amazon.py
"""

import json
import os
import math
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import requests

from common import make_record, save
from shapely.geometry import box, shape
from shapely.strtree import STRtree

try:
    from playwright.sync_api import sync_playwright
except ImportError:  # the session then comes from the installed Firefox (firefox_session)
    sync_playwright = None

ROOT = Path(__file__).resolve().parent.parent
OUTLINE_FILE = ROOT / "data" / "territorium" / "deutschland_outline.geojson"
ISO2 = "DE"
LOCALE = "de-DE"

DOMAIN = "www.amazon.de"
ULP_URL = f"https://{DOMAIN}/ulp"
API_URL = f"https://{DOMAIN}/location_selector/fetch_locations"
PAGE_CAP = 20
START_CELL_KM = 16
MIN_CELL_KM = 0.25
# The 20 results are near, but not strictly the 20 nearest: a point at 2.0 km
# can be missing while the 20th is at 2.3 km. So a cell only counts as
# complete when its corners lie within this share of the 20th point's distance.
TRUST = 0.5
# amazon.it (Italian version) answered 503 at 6 parallel; 3 with a short pause stay under the limit
WORKERS = 3
REQUEST_DELAY = 0.3
MAX_ATTEMPTS = 6
RETRY_ROUNDS = 3
RETRY_PAUSE = 120  # s, times the round

_local = threading.local()

# Diagnostics: counters, first error samples, periodic progress line
STATS = {"calls": 0, "ok": 0, "errors": {}, "samples": [], "pauses": 0}
_stats_lock = threading.Lock()

# Test mode: AMAZON_TEST_BBOX="south,west,north,east" limits the grid and never
# touches the cache; AMAZON_MAX_MINUTES stops the crawl after that long (with a
# checkpoint, like Ctrl+C); AMAZON_SAVE_PARTIAL=1 publishes the checkpoint's
# points as the cache without searching.
TEST_BBOX = os.environ.get("AMAZON_TEST_BBOX", "").strip()
MAX_MINUTES = float(os.environ.get("AMAZON_MAX_MINUTES", "0") or 0)
_START = time.time()


def out_of_time():
    return bool(MAX_MINUTES) and (time.time() - _START) / 60 > MAX_MINUTES


def note_error(kind, detail):
    with _stats_lock:
        STATS["errors"][kind] = STATS["errors"].get(kind, 0) + 1
        if len(STATS["samples"]) < 8:
            STATS["samples"].append(f"{kind}: {detail[:300]}")


def progress_reporter(found_ref):
    def loop():
        while True:
            time.sleep(60)
            with _stats_lock:
                el = (time.time() - _START) / 60
                print(f"   ⏱ {el:.0f} min · {STATS['calls']} chiamate ({STATS['calls'] / max(el, 0.01):.0f}/min) · "
                      f"ok {STATS['ok']} · errori {STATS['errors']} · pause {STATS['pauses']} · punti {len(found_ref)}",
                      flush=True)
    threading.Thread(target=loop, daemon=True).start()


def haversine_km(lat1, lon1, lat2, lon2):
    p = math.radians
    a = math.sin(p(lat2 - lat1) / 2) ** 2 + math.cos(p(lat1)) * math.cos(p(lat2)) * math.sin(p(lon2 - lon1) / 2) ** 2
    return 12742 * math.asin(math.sqrt(a))


USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
)


def default_client_id():
    """The finder's clientId follows the store: amazon_be_..., amazon_it_..."""
    store = DOMAIN.removeprefix("www.amazon.").split(".")[-1]
    return f"amazon_{store}_add_to_addressbook_mkt_mobile"


FIREFOX_USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:128.0) Gecko/20100101 Firefox/128.0"


def firefox_profiles():
    home = Path.home()
    roots = [home / "Library/Application Support/Firefox/Profiles",             # macOS
             Path(os.environ.get("APPDATA", home)) / "Mozilla/Firefox/Profiles",  # Windows
             home / ".mozilla/firefox", home / "snap/firefox/common/.mozilla/firefox"]
    files = [f for root in roots if root.is_dir() for f in root.glob("*/cookies.sqlite")]
    return sorted(files, key=lambda f: f.stat().st_mtime, reverse=True)


def firefox_session():
    """
    Cookies of amazon.de from the Firefox installed on the PC (no automation:
    the cookie database is copied and read). Open amazon.de in Firefox first.
    Used with AMAZON_BROWSER=firefox, or when Playwright has no browser
    (Playwright no longer ships one for older macOS, e.g. macOS 12).
    """
    import shutil
    import sqlite3
    import tempfile

    for db in firefox_profiles():
        with tempfile.TemporaryDirectory() as tmp:
            for suffix in ("", "-wal"):  # Firefox keeps the file locked and recent writes in the WAL
                src = Path(str(db) + suffix)
                if src.exists():
                    shutil.copy2(src, Path(tmp) / ("cookies.sqlite" + suffix))
            con = sqlite3.connect(Path(tmp) / "cookies.sqlite")
            rows = con.execute("SELECT name, value FROM moz_cookies WHERE host LIKE ?",
                               (f"%{DOMAIN.removeprefix('www')}",)).fetchall()
            con.close()
        if rows:
            print(f"   🦊 {len(rows)} cookie di {DOMAIN} da Firefox ({db.parent.name})")
            return dict(rows), FIREFOX_USER_AGENT, default_client_id()
    raise SystemExit(f"❌ Nessun cookie di {DOMAIN} in Firefox: apri https://{DOMAIN} in Firefox "
                     "(accetta i cookie), poi rilancia lo script.")


def browser_session():
    """Cookies and clientId from a visit to the store and its finder page.

    From a GitHub runner amazon.com.be answered /ulp with a download instead of
    the page ("Download is starting"), so the homepage comes first for the
    session cookies, a failed /ulp load is tolerated, and the clientId falls
    back to the store's pattern when the page made no call.
    """
    client_ids = []

    def on_request(request):
        if "fetch_locations" in request.url:
            client_ids.extend(parse_qs(urlparse(request.url).query).get("clientId", []))

    def launch_browser(p):
        # Playwright's own Chromium; else the installed Google Chrome or Edge
        # (Playwright no longer ships Chromium for older macOS, e.g. macOS 12)
        errors = []
        for channel in (None, "chrome", "msedge"):
            try:
                return p.chromium.launch(headless=True, channel=channel) if channel else p.chromium.launch(headless=True)
            except Exception as e:  # noqa: BLE001
                errors.append(f"{channel or 'chromium'}: {str(e).splitlines()[0]}")
        raise SystemExit("⚠️  Playwright non trova un browser:\n   " + "\n   ".join(errors))

    if os.environ.get("AMAZON_BROWSER", "").lower() == "firefox" or sync_playwright is None:
        return firefox_session()
    with sync_playwright() as p:
        try:
            browser = launch_browser(p)
        except SystemExit as error:
            print(f"{error}\n   ↪ provo con i cookie di Firefox")
            return firefox_session()
        context = browser.new_context(
            locale=LOCALE, user_agent=USER_AGENT, accept_downloads=True,
        )
        context.add_init_script("window.alert=()=>{};window.confirm=()=>true;window.prompt=()=>null;")  # JS pop-ups crash the Playwright driver
        page = context.new_page()
        page.on("request", on_request)
        for url in (f"https://{DOMAIN}/", ULP_URL):
            try:
                page.goto(url, wait_until="domcontentloaded", timeout=60000)
            except Exception as e:  # PlaywrightError: download, timeout, reset
                print(f"   ⚠️  {url}: {str(e).splitlines()[0]}")
                continue
            time.sleep(3)
        for _ in range(20):
            if client_ids:
                break
            time.sleep(0.5)
        cookies = {c["name"]: c["value"] for c in context.cookies()}
        browser.close()

    client_id = client_ids[0] if client_ids else default_client_id()
    return cookies, USER_AGENT, client_id


def country_cells():
    """16 km cells (as lat/lon boxes) that touch French land."""
    if not OUTLINE_FILE.exists():
        raise SystemExit("❌ Esegui prima scripts/prepare_territorio.py")
    with open(OUTLINE_FILE, encoding="utf-8") as f:
        outline = shape(json.load(f)["features"][0]["geometry"])
    polygons = list(getattr(outline, "geoms", [outline]))
    tree = STRtree(polygons)
    minx = min(p.bounds[0] for p in polygons)
    miny = min(p.bounds[1] for p in polygons)
    maxx = max(p.bounds[2] for p in polygons)
    maxy = max(p.bounds[3] for p in polygons)
    dlat = START_CELL_KM / 111.32
    cells = []
    lat = miny
    while lat < maxy:
        dlon = START_CELL_KM / (111.32 * math.cos(math.radians(lat + dlat / 2)))
        lon = minx
        while lon < maxx:
            cell = box(lon, lat, lon + dlon, lat + dlat)
            if any(polygons[i].intersects(cell) for i in tree.query(cell)):
                cells.append((lat, lon, lat + dlat, lon + dlon))
            lon += dlon
        lat += dlat
    return cells


class Fetcher:
    def __init__(self, cookies, user_agent, client_id):
        self.cookies = cookies
        self.headers = {"User-Agent": user_agent, "Accept": "application/json", "Accept-Language": LOCALE}
        self.params = {
            "clientId": client_id, "countryCode": ISO2, "sortType": "NEAREST", "userBenefit": "false",
            "showFreeShippingLabel": "false", "showPromotionDetail": "false", "showAvailableLocations": "false",
        }
        self.lock = threading.Lock()
        self.pause_until = 0.0

    def session(self):
        if not hasattr(_local, "session"):
            _local.session = requests.Session()
            _local.session.headers.update(self.headers)
            _local.session.cookies.update(self.cookies)
        return _local.session

    def search(self, lat, lon):
        params = dict(self.params, latitude=f"{lat:.5f}", longitude=f"{lon:.5f}")
        for attempt in range(MAX_ATTEMPTS):
            if out_of_time():
                raise RuntimeError("tempo scaduto")
            # A refusal pauses every worker, not just the one that got it
            wait = self.pause_until - time.time()
            time.sleep(max(wait, 0) + REQUEST_DELAY)
            with _stats_lock:
                STATS["calls"] += 1
            try:
                resp = self.session().get(API_URL, params=params, timeout=30)
                if resp.status_code != 200:
                    note_error(f"HTTP {resp.status_code}", resp.text)
                resp.raise_for_status()
                try:
                    data = resp.json()
                except ValueError:
                    note_error("non-JSON", resp.text)
                    raise
                # A throttled call is valid JSON without points:
                # {"exceptionClassName":"ThrottlingException"}
                if data.get("isErrored") or data.get("exceptionClassName"):
                    raise ValueError(data.get("exceptionClassName") or "isErrored")
                with _stats_lock:
                    STATS["ok"] += 1
                return data.get("locationList") or []
            except (requests.RequestException, ValueError) as e:
                if isinstance(e, ValueError) and str(e) and "Expecting" not in str(e):
                    note_error(str(e), json.dumps(params))
                elif isinstance(e, requests.RequestException) and not getattr(e, "response", None):
                    note_error(type(e).__name__, str(e))
                if attempt == MAX_ATTEMPTS - 1:
                    raise RuntimeError(f"{lat:.4f},{lon:.4f}: {e}")
                # 5, 10, 20, 40, 80 s: a 503 is Amazon's rate limit, it needs a real pause
                with self.lock:
                    self.pause_until = max(self.pause_until, time.time() + 5 * 2 ** attempt)
                with _stats_lock:
                    STATS["pauses"] += 1

    def try_search(self, cell):
        """(cell, locations), or (cell, None) when Amazon kept refusing it."""
        s, w, n, e = cell
        try:
            return cell, self.search((s + n) / 2, (w + e) / 2)
        except RuntimeError as err:
            if not out_of_time():
                print(f"   ⚠️  {err}", flush=True)
            return cell, None


class Interrupted(Exception):
    """Ctrl+C during the crawl: carries the cells still to search."""

    def __init__(self, pending):
        super().__init__("interrotto")
        self.pending = pending


def crawl(fetcher, cells, found=None):
    """
    Search every cell, splitting the crowded ones, until no cell is left.

    Each answer is used as soon as it arrives (points kept, split decided), so
    an interruption loses nothing: Ctrl+C raises Interrupted with every cell
    not yet answered plus the sub-cells already scheduled.
    """
    found = {} if found is None else found
    calls = 0
    splits = 0
    level = 0

    def use(cell, locations, next_cells):
        nonlocal splits
        s, w, n, e = cell
        clat, clon = (s + n) / 2, (w + e) / 2
        for loc in locations:
            found.setdefault(loc.get("id"), loc)
        if len(locations) < PAGE_CAP:
            return
        reach = max(haversine_km(clat, clon, l["location"]["latitude"], l["location"]["longitude"]) for l in locations)
        corner = haversine_km(clat, clon, n, e)
        if reach * TRUST >= corner or corner < MIN_CELL_KM:
            return
        splits += 1
        next_cells += [(s, w, clat, clon), (s, clon, clat, e), (clat, w, n, clon), (clat, clon, n, e)]

    def run(batch, next_cells, failed):
        """Search `batch`; answered cells are used at once, refused ones go to `failed`."""
        nonlocal calls
        todo = list(batch)
        pool = ThreadPoolExecutor(max_workers=WORKERS)
        try:
            for index, (cell, locations) in enumerate(pool.map(fetcher.try_search, todo)):
                calls += 1
                todo[index] = None
                if locations is None:
                    failed.append(cell)
                else:
                    use(cell, locations, next_cells)
        except KeyboardInterrupt:
            pool.shutdown(wait=False, cancel_futures=True)
            raise Interrupted([c for c in todo if c is not None] + failed + next_cells)
        pool.shutdown(wait=True)

    while cells:
        if out_of_time():
            print(f"   ⏹ limite di {MAX_MINUTES:.0f} min raggiunto: {len(cells)} celle da riprendere", flush=True)
            return found, calls, splits, cells
        level += 1
        next_cells, failed = [], []
        run(cells, next_cells, failed)
        # Cells Amazon kept refusing get a few more rounds after a longer pause;
        # only if they still fail is the whole run given up (cache untouched)
        for round_ in range(1, RETRY_ROUNDS + 1):
            if not failed or out_of_time():
                break
            print(f"   {len(failed)} searches refused; retrying in {RETRY_PAUSE * round_} s", flush=True)
            try:
                time.sleep(RETRY_PAUSE * round_)
            except KeyboardInterrupt:
                raise Interrupted(failed + next_cells)
            retry, failed = failed, []
            run(retry, next_cells, failed)
        leftover = []
        if failed and out_of_time():
            print(f"   ⏹ tempo scaduto: {len(failed)} celle da riprendere", flush=True)
            leftover = failed
        elif failed:
            raise RuntimeError(f"{len(failed)} searches still refused after {RETRY_ROUNDS} retry rounds")
        print(f"   level {level}: {len(cells)} searches, {len(found)} points, {len(next_cells)} cells to refine", flush=True)
        cells = next_cells + leftover
    return found, calls, splits, cells


CHECKPOINT = ROOT / "data" / "amazon_checkpoint.json"
CACHE = ROOT / "data" / "amazon_all_locations.json"
RAW_KEYS = ("id", "name", "location", "addressLine1", "addressLine2", "postalCode", "city",
            "accessPointType", "countryCode")


def load_checkpoint():
    """(found, pending) of an unfinished crawl, or (None, None)."""
    try:
        data = json.loads(CHECKPOINT.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None, None
    age_days = (time.time() - data.get("saved_at", 0)) / 86400
    if age_days > 40:
        print(f"   checkpoint di {age_days:.0f} giorni fa: troppo vecchio, si riparte da capo")
        return None, None
    return data.get("found") or {}, [tuple(c) for c in data.get("pending") or []]


def save_checkpoint(found, pending):
    slim = {k: {f: v.get(f) for f in RAW_KEYS if f in v} for k, v in found.items()}
    CHECKPOINT.write_text(json.dumps({"saved_at": time.time(), "found": slim, "pending": pending},
                                     ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"💾 checkpoint: {len(slim)} punti trovati, {len(pending)} celle da riprendere al prossimo giro")


def cache_age_days():
    try:
        meta = json.loads(CACHE.read_text(encoding="utf-8")).get("metadata") or {}
        fetched = datetime.fromisoformat(meta["fetched_at"].replace("Z", "+00:00"))
        return (datetime.now(fetched.tzinfo) - fetched).total_seconds() / 86400
    except (OSError, ValueError, KeyError):
        return None


# The type comes from accessPointType and, for points of other networks amazon.de may
# offer, from the name too.
LOCKER_NAME = re.compile(r"\b(locker|lockers|paketstation|packstation|schlie(ss|ß)fach)\b", re.I)
POST_OFFICE_NAME = re.compile(r"^(postfiliale|filiale)\b", re.I)


def point_type(name, access_type=None):
    name = str(name or "")
    if "locker" in str(access_type or "").lower() or LOCKER_NAME.search(name):
        return "locker"
    if POST_OFFICE_NAME.search(name):
        return "post_office"
    return "pickup_point"


def normalize(loc):
    coords = loc.get("location") or {}
    address = loc.get("addressLine1") or loc.get("addressLine2") or ""
    return make_record(
        id=loc["id"],
        name=loc.get("name", ""),
        lat=coords["latitude"],
        lon=coords["longitude"],
        punt_type=point_type(loc.get("name"), loc.get("accessPointType")),
        street=address,
        cap=loc.get("postalCode", ""),
        city=loc.get("city", ""),
        can_pickup=True,
        # Amazon returns can be handed in at lockers and counters alike
        can_dropoff=True,
    )


def to_records(found):
    locations = []
    for loc in found.values():
        try:
            record = normalize(loc)
        except (KeyError, TypeError):
            continue
        if record and loc.get("countryCode", ISO2) == ISO2:
            locations.append(record)
    return locations


def main():
    print("=" * 80)
    print("AMAZON HUB COMPLETE LOCATION FETCH")
    print("=" * 80)
    print(f"Time: {datetime.now():%Y-%m-%d %H:%M:%S}")

    started = time.time()
    resumed_found, resumed_pending = (None, None) if TEST_BBOX else load_checkpoint()
    if os.environ.get("AMAZON_SAVE_PARTIAL"):
        # Publish what an unfinished crawl found so far; the checkpoint stays,
        # so the next normal run still completes the missing cells
        if not resumed_found:
            print("❌ nessun checkpoint da pubblicare")
            return 1
        locations = to_records(resumed_found)
        print(f"📦 pubblico {len(locations)} punti da un giro incompleto ({len(resumed_pending)} celle ancora da cercare)")
        save("Amazon", "amazon", locations, API_URL, f"griglia-adattiva, parziale ({len(resumed_pending)} celle mancanti)")
        return 0
    if resumed_pending is None and not TEST_BBOX and not os.environ.get("AMAZON_FULL"):
        age = cache_age_days()
        if age is not None and age < 10:
            print(f"ℹ️  cache di {age:.1f} giorni fa e nessun giro in sospeso: niente da fare")
            return 0
    cookies, user_agent, client_id = browser_session()
    print(f"🌐 {ULP_URL}: session ok, clientId {client_id}")

    cells = country_cells() if resumed_pending is None else resumed_pending
    if resumed_pending is not None:
        print(f"↩️  ripresa del giro precedente: {len(resumed_found)} punti già trovati, {len(cells)} celle da cercare")
    if TEST_BBOX:
        s_, w_, n_, e_ = (float(v) for v in TEST_BBOX.split(","))
        cells = [c for c in cells if c[0] < n_ and c[2] > s_ and c[1] < e_ and c[3] > w_]
        print(f"🧪 TEST: solo il riquadro {TEST_BBOX}; la cache non viene toccata")
    print(f"📍 {len(cells)} cells of {START_CELL_KM} km, {WORKERS} parallel\n")

    found = dict(resumed_found or {})
    progress_reporter(found)
    try:
        found, calls, splits, pending = crawl(Fetcher(cookies, user_agent, client_id), cells, found)
    except Interrupted as stop:
        if TEST_BBOX:
            return 1
        print("\n⏸ interrotto (Ctrl+C)")
        save_checkpoint(found, stop.pending)
        print("   per riprendere rilancia lo stesso comando; per pubblicare i punti trovati finora:"
              " AMAZON_SAVE_PARTIAL=1 python scripts/fetch_amazon.py")
        return 3
    except RuntimeError as e:
        print(f"❌ Search failed ({e}); cache not updated")
        print(f"   statistiche: {json.dumps(STATS, ensure_ascii=False)[:3000]}")
        return 1

    locations = to_records(found)

    print(f"\n✅ {len(locations)} Amazon locations ({calls} searches, {splits} splits, {(time.time() - started) / 60:.1f} min)")
    print(f"   statistiche: {json.dumps(STATS, ensure_ascii=False)[:3000]}")
    if TEST_BBOX:
        types = {}
        for r in locations:
            types[r["puntType"]] = types.get(r["puntType"], 0) + 1
        print(f"🧪 TEST concluso: {len(locations)} punti nel riquadro, per tipo {types}; esempio: {locations[:1]}")
        return 0
    if pending:
        save_checkpoint(found, pending)
        print("⏸ giro incompleto: la cache resta quella precedente, il prossimo giro riprende da qui")
        return 3
    if not locations:
        print("❌ No locations fetched")
        return 1

    save("Amazon", "amazon", locations, API_URL, f"griglia-adattiva ({calls} ricerche)")
    if CHECKPOINT.exists():
        CHECKPOINT.unlink()
    return 0


if __name__ == "__main__":
    sys.exit(main())
