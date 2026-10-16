"""
Recognises the physical places served by several networks (same shop, same locker).

Every network lists its own points: a kiosk that is Hermes PaketShop, DPD Pickup
and GLS PaketShop appears three times, with coordinates a few metres apart.
Here those duplicates are grouped into one shared "place".

Rule (decided with Roberto, October 2026, from the Italian version): two points of
different networks are the same place when they have a SIMILAR ADDRESS and a SIMILAR
NAME.
- similar address: same street and house number (12 and 12a are similar: the number
  counts, not the letter), within ADDRESS_M metres;
- similar name: at least one significant word in common, without the networks'
  prefixes ("DHL Paketshop - ", "Hermes PaketShop ") and without articles, legal forms
  (GmbH, e.K.) and network brands. "Späti" and "Kiosk" count as the same word.
Where a field is missing it cannot contradict: a listing without a name or without a
house number joins when the rest agrees, but only within NEAR_M metres.
Lockers only join lockers, and a network's own machines (DHL Packstation / Poststation,
Amazon Locker) never join another network's lockers, unless that listing carries the
owner's brand; open stations (myflexbox, DeinFach) may be listed by several
networks. At most one listing per channel in a group (network_slot), and the manual
corrections of data/punti_condivisi_correzioni.json.
German addresses put the number after the street ("Hauptstraße 12a"); "Str." and
"Straße" are normalised to one suffix.
"""

from __future__ import annotations

import re
from difflib import SequenceMatcher
import unicodedata

import numpy as np
import shapely

NEAR_M = 80.0
# A network's own locker machines: a DHL Packstation / Poststation is never another
# network's locker, nor is an Amazon Locker. Open stations (myflexbox, DeinFach,
# ...) are served by several carriers and may be listed by each of them.
OWN_LOCKER_NETWORKS = {"DHL"}
# Names another network uses for an owner's machine. DeinFach stations belong to Deutsche
# Post: DHL lists them as "Packstation 6xx" at the same spot, so they may join DHL's.
OWN_LOCKER_BRANDS = {"DHL": ("packstation", "deinfach"), "Amazon": ("amazon",)}
ADDRESS_M = 200.0
# Same street and name, different house number: still one shop when this close
SAME_SPOT_M = 30.0
# Same street, same house number AND a similar name: one network can geocode the shop
# a few hundred metres off
FULL_MATCH_M = 600.0
MAX_M = FULL_MATCH_M
STREET_SIM = 0.5

PREFIXES = re.compile(
    r"^(dhl\s+packstation|packstation|poststation|dhl\s+paketshop|dhl\s+filiale|postfiliale|filiale|"
    r"hermes\s+paketshop|hermes\s+paketstation|paketshop|dpd\s+pickup(\s+paketshop|\s+station)?|"
    r"pickup\s+paketshop|gls\s+paketshop|gls\s+paketstation|ups\s+access\s+point(\s+locker)?|"
    r"fedex(\s+onsite|\s+ship\s+centre)?|amazon\s+(counter|locker|hub)|myflexbox(\s+paketstation)?|"
    r"deinfach(\s+paketstation)?|mail\s+boxes\s+etc\.?|mbe|nova\s*post(\s+filiale|\s+paketautomat)?|"
    r"paketstation|locker)\s*[-\u2013:\u00b7|]?\s*", re.I)
# Not significant: articles and prepositions, legal forms, the networks' own words
STOP = {
    "der", "die", "das", "dem", "den", "des", "und", "am", "im", "an", "in", "zum", "zur", "bei", "von", "vom",
    "auf", "fur", "fuer", "the", "and", "of",
    "gmbh", "co", "kg", "ohg", "ug", "ag", "eg", "ek", "ev", "inh", "inhaber", "haftungsbeschrankt",
    "haftungsbeschraenkt", "mbh",
    "dhl", "deutsche", "post", "packstation", "poststation", "postfiliale", "filiale", "paketshop", "paketstation",
    "paket", "pakete", "paketannahme", "annahmestelle", "hermes", "dpd", "pickup", "gls", "ups", "access", "point",
    "fedex", "onsite", "amazon", "counter", "hub", "locker", "lockers", "myflexbox", "flexbox", "deinfach",
    "mbe", "mail", "boxes", "etc", "nova", "novapost", "pudo", "shop", "station", "partner", "deutschland",
}
# Words for the same kind of shop: a "Späti" is a "Kiosk" for another network
SYNONYMS = {"trinkhalle": "kiosk", "spaeti": "kiosk", "spati": "kiosk", "tabakwaren": "tabak",
            "lottoannahme": "lotto", "schreibwaren": "papeterie", "papeteria": "papeterie"}
# Network codes in names ("Packstation 123", "Locker DE0255A"): letters and digits mixed
CODE = re.compile(r"^(?=.*\d)(?=.*[a-z])[a-z0-9]{6,}$")
STREET_STOP = {"str", "strasse", "platz", "pl", "weg", "allee", "gasse", "damm", "chaussee", "ufer",
               "am", "an", "auf", "der", "die", "das", "dem", "den", "des", "im", "in", "zum", "zur", "von",
               "vom", "bei", "hinter", "vor", "unter", "ober", "alte", "alter", "neue", "neuer", "st", "sankt",
               "gewerbegebiet", "industriegebiet", "einkaufszentrum", "center", "ot", "ortsteil"}
GERMAN = str.maketrans({"ä": "ae", "ö": "oe", "ü": "ue", "Ä": "Ae", "Ö": "Oe", "Ü": "Ue", "ß": "ss"})


def _ascii(text) -> str:
    # typographic apostrophes and accents used as apostrophes split words like "'": "L’Oasis" = "L'Oasis"
    text = re.sub(r"[’‘`´]", "'", str(text or "")).translate(GERMAN)
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii").lower()
    # "Hauptstraße", "Hauptstr." and "Haupt-Str." are one street: the suffix becomes
    # a word of its own ("haupt str"), so "Berliner Str." and "Berliner Straße" agree too
    return re.sub(r"(?<=[a-z])-?(strasse|str)\b\.?", " str", text)


def _tokens(text, stop) -> frozenset:
    return frozenset(t for t in re.findall(r"[a-z0-9]+", _ascii(text)) if t not in stop and len(t) > 1)


def name_tokens(name) -> frozenset:
    """
    Significant words of a shop name (no numbers, no network codes); empty for
    anonymous listings ("FedEx OnSite", "Point Relais FR123456").
    """
    text = _ascii(name)
    # Initials joined by "&" are one word: "G&C", "G & C" -> "gc"
    text = re.sub(r"\b([a-z])\s*&\s*([a-z])\b", r"\1\2", text)
    text = PREFIXES.sub("", text)
    return frozenset(SYNONYMS.get(t, t) for t in _tokens(text, STOP) if not CODE.match(t) and not t.isdigit())


def _same_word(x: str, y: str) -> bool:
    """
    Equal; one a truncation of the other (Sturi/Sturiale); the same root
    (tabacchi/tabaccheria); or the same word with an elided article (dazeglio/azeglio).
    """
    if x == y:
        return True
    if min(len(x), len(y)) >= 4 and (x.startswith(y) or y.startswith(x)):
        return True
    if min(len(x), len(y)) >= 5 and (x.endswith(y) or y.endswith(x)):
        return True
    if len(x) >= 6 and len(y) >= 6 and x[:6] == y[:6]:
        return True
    # a typo in a long word ("Boulangeriee" / "Boulangerie")
    return min(len(x), len(y)) >= 7 and x[:3] == y[:3] and SequenceMatcher(None, x, y).ratio() >= 0.88


def _glued(word: str, words: frozenset) -> bool:
    """"nonsolobevande" written as "Non Solo Bevande": the word is made of the other's words."""
    parts = [w for w in words if len(w) >= 3 and w in word]
    return len(word) >= 8 and len(parts) >= 2 and sum(map(len, parts)) >= len(word) - 1


def shared_word(a: frozenset, b: frozenset) -> bool:
    """One significant word in common (see _same_word), or one name glued together."""
    if any(_same_word(x, y) for x in a for y in b):
        return True
    return any(_glued(x, b) for x in a) or any(_glued(y, a) for y in b)


CIVIC_BLOCK = r"(\d+\s*[a-z]{0,2}(?:\s*[-/ ]\s*[a-z0-9]{1,3})*)"


def street_info(street, number):
    """(street words, civic number or '' — the number only: 24/A, 24A and 24 are all '24')."""
    street, number = _ascii(street), _ascii(number)
    # Drop what follows the civic number: "Via Giovanni Pascoli, 18, Milano,
    # Metropolitan City of Milan, Italy" (InPost) -> "Via Giovanni Pascoli, 18";
    # but keep "Corso 4 Aprile, 3" whole (the 4 is part of the name)
    parts = [x.strip() for x in street.split(",") if x.strip()]
    if len(parts) > 1:
        cut = next((n for n, x in enumerate(parts) if n and re.fullmatch(CIVIC_BLOCK, x)), 0)
        street = ", ".join(parts[: cut + 1])
    # The number field when present, else the civic block at the end of the line:
    # "73-R", "134/B", "57B/C", "78-80" and "78 80" (first number of a range)
    # A number first is rare in Germany but some networks write "12 Hauptstr."
    start = re.match(r"^\s*(\d+)\s*[a-z]?\b[\s,]+(?=[a-z])", street)
    if start:
        street = street[start.end():]
    in_number = re.findall(r"\d+", number)
    if in_number:
        house = in_number[0]
    elif start:
        house = start.group(1)
    else:
        # numbers inside the name ("Rue du 8 Mai 1945") are not a civic number
        end = re.search(CIVIC_BLOCK + r"\s*$", street)
        house = re.match(r"\d+", end.group(1)).group(0) if end else ""
        # The civic block is not part of the street name
        street = re.sub(CIVIC_BLOCK + r"\s*$", "", street)
    words = frozenset(t for t in re.findall(r"[a-z]+", street) if t not in STREET_STOP and len(t) > 2)
    return words, house


def _street_sim(a: frozenset, b: frozenset) -> float:
    """Jaccard on street words, typos and abbreviations tolerated (Suffraggio/Suffragio)."""
    if not a or not b:
        return 0.0
    matched = sum(1 for x in a if any(_same_word(x, y) for y in b))
    return matched / (len(a) + len(b) - matched)


def _jaccard(a: frozenset, b: frozenset) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def load_corrections(path) -> dict:
    """
    Manual corrections (data/punti_condivisi_correzioni.json), for the cases the
    rules cannot decide: "separa" lists points that are different shops even if
    they look alike, "unisci" points that are one place even if they do not.
    Points are "<Rete>:<id>" with the id of the network's cache.
    """
    import json
    from pathlib import Path

    path = Path(path)
    if not path.exists():
        return {"separa": [], "unisci": []}
    data = json.loads(path.read_text(encoding="utf-8"))
    return {k: [entry["punti"] for entry in data.get(k, [])] for k in ("separa", "unisci")}


def shared_groups(x, y, carriers, is_locker, names, streets, numbers, keys=None, corrections=None):
    """
    Group id per point (numpy int array); -1 for points not shared with any other network.

    x, y: metric coordinates (EPSG:25832, UTM 32N); the other arguments are per-point sequences.
    keys ("<Rete>:<id>") and corrections (load_corrections) apply manual fixes.
    """
    corrections = corrections or {"separa": [], "unisci": []}
    index_of = {k: n for n, k in enumerate(keys)} if keys is not None else {}
    apart = {}  # point -> points it must never share a group with
    for listed in corrections["separa"]:
        found = [index_of[k] for k in listed if k in index_of]
        for a in found:
            apart.setdefault(a, set()).update(b for b in found if b != a)
    n = len(x)
    xy = np.column_stack([x, y])
    points = shapely.points(xy)
    i, j = shapely.STRtree(points).query(points, predicate="dwithin", distance=MAX_M)
    once = i < j
    i, j = i[once], j[once]
    if not len(i):
        return np.full(n, -1)
    nets = np.array([network_slot(carriers[k], names[k]) for k in range(n)])
    keep = (nets[i] != nets[j]) & (np.asarray(is_locker)[i] == np.asarray(is_locker)[j])
    post_office = np.array([is_post_office(carriers[k], names[k]) for k in range(n)])
    keep &= post_office[i] == post_office[j]
    # A network's own locker machine is never another network's locker, even in the
    # same supermarket (Amazon Locker, Vinted Go locker, Pickup Station / consigne);
    # InPost machines, on the contrary, are listed by Mondial Relay, DHL and Amazon ("MR - ")
    # Another network can list such a machine under the owner's brand: UPS sells the Vinted
    # Go lockers ("Vinted Go Consigne - Carrefour"); that listing may join the owner's locker.
    owner = [OWN_LOCKER_BRANDS.get(carriers[k]) if is_locker[k] and (carriers[k] in OWN_LOCKER_NETWORKS or (
        carriers[k] == "Amazon" and str(names[k]).lower().startswith("amazon locker"))) else None for k in range(n)]
    lower = [str(v).lower() for v in names]

    def allowed(a, b):
        if owner[a] and owner[b]:
            return False
        if owner[a]:
            return any(brand in lower[b] for brand in owner[a])
        if owner[b]:
            return any(brand in lower[a] for brand in owner[b])
        return True

    keep &= np.array([allowed(a, b) for a, b in zip(i, j)], dtype=bool) if len(i) else keep
    i, j = i[keep], j[keep]
    dist = np.hypot(xy[i, 0] - xy[j, 0], xy[i, 1] - xy[j, 1])

    name_cache, street_cache = {}, {}

    def amazon_name_in_street(k):
        # Amazon Counter listings sometimes carry the shop name in the address line
        # and no house number: the line is then a name, not a street
        return carriers[k] == "Amazon" and not re.search(r"\d", str(streets[k]))

    def nt(k):
        if k not in name_cache:
            tokens = name_tokens(names[k])
            if amazon_name_in_street(k):
                tokens = tokens | name_tokens(streets[k])
            name_cache[k] = tokens
        return name_cache[k]

    def st(k):
        if k not in street_cache:
            street_cache[k] = (frozenset(), "") if amazon_name_in_street(k) else street_info(streets[k], numbers[k])
        return street_cache[k]

    matches = []
    for a, b, d in zip(i.tolist(), j.tolist(), dist.tolist()):
        na, nb = nt(a), nt(b)
        (wa, ha), (wb, hb) = st(a), st(b)
        # Each test is True (match), False (contradiction) or None (a side lacks the data)
        street = (_street_sim(wa, wb) >= STREET_SIM) if (wa and wb) else None
        civic = (ha == hb) if (ha and hb) else None   # numbers only: 24 = 24/A
        name = shared_word(na, nb) if (na and nb) else None
        if civic is False and street is True and name and d <= SAME_SPOT_M:
            # Neighbouring numbers on the same spot with the same name (a shop on a corner
            # or with two doors, "2" and "4" of one street 12 m apart)
            civic = None
        if False in (street, civic, name):
            continue
        address = street is True and civic is True
        # Full address and name agree: up to ADDRESS_M (geocoding differs by
        # 100 m and more). One of the two only: the address alone (anonymous
        # "FedEx OnSite"), or a clearly similar name (no
        # address), also up to ADDRESS_M; anything weaker only close by.
        if address and name:
            limit = FULL_MATCH_M
        elif address or (name and _jaccard(na, nb) >= 0.5):
            limit = ADDRESS_M
        elif name or street:
            limit = NEAR_M
        else:
            continue
        if d <= limit:
            matches.append((d, a, b))

    # Forced unions first (distance -1)
    for listed in corrections["unisci"]:
        found = [index_of[k] for k in listed if k in index_of]
        matches += [(-1.0, found[0], b) for b in found[1:]]

    # Union-find, closest pairs first, never two points of one network (channel) in a group,
    # never two points the corrections keep apart, and never two shops whose names
    # contradict each other, even through an anonymous listing at the same address
    # ("FedEx OnSite" between two different shops of one building)
    parent = list(range(n))
    members = {}
    named = {}  # root -> its points with a shop name

    def names_clash(a, b):
        na, nb = nt(a), nt(b)
        if not (na and nb):
            return False
        return not shared_word(na, nb)
    held = {a: {a} for a in apart}  # root -> its points that have "separa" partners

    def find(k):
        while parent[k] != k:
            parent[k] = parent[parent[k]]
            k = parent[k]
        return k

    for _, a, b in sorted(matches):
        ra, rb = find(a), find(b)
        if ra == rb:
            continue
        ca = members.get(ra, {nets[ra]} if ra == a else None) or {nets[a]}
        cb = members.get(rb, {nets[rb]} if rb == b else None) or {nets[b]}
        if ca & cb:
            continue
        ha, hb = held.get(ra, set()), held.get(rb, set())
        if any(apart[p] & hb for p in ha):
            continue
        sa = named.get(ra, [ra] if nt(ra) else [])
        sb = named.get(rb, [rb] if nt(rb) else [])
        # every named listing on each side needs a compatible name on the other side
        # (a shop has several names across networks: owner, sign, franchise)
        if sa and sb and not (all(any(not names_clash(x, y) for y in sb) for x in sa)
                              and all(any(not names_clash(y, x) for x in sa) for y in sb)):
            continue
        named[ra] = sa + sb
        named.pop(rb, None)
        parent[rb] = ra
        members[ra] = ca | cb
        members.pop(rb, None)
        if ha or hb:
            held[ra] = ha | hb
            held.pop(rb, None)

    roots = np.array([find(k) for k in range(n)])
    group = np.full(n, -1)
    sizes = np.bincount(roots, minlength=n)
    shared = sizes[roots] > 1
    # compact ids 0..G-1
    _, compact = np.unique(roots[shared], return_inverse=True)
    group[shared] = compact
    return group


def is_post_office(carrier, name) -> bool:
    """
    In Germany a Postfiliale is a partner shop (kiosk, supermarket, stationer): it may
    share a place with other networks' points, so no listing is kept apart as a post office.
    """
    return False


def network_slot(carrier, name) -> str:
    """The channel a listing comes from, for "at most one listing per channel in a group"."""
    return carrier
