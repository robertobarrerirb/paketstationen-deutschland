# Paketstationen Deutschland

Sistema per **raccogliere, analizzare e mostrare su una mappa i punti di ritiro pacchi in Germania**:
Paketstationen (locker automatici), Paketshop nei negozi e Postfilialen, Gemeinde per Gemeinde, con
interfaccia in **tedesco, italiano e inglese**.

Si compone di:

- un **backend Python** che ogni mese scarica le posizioni dalle reti e le assegna alle Gemeinden;
- una **webapp Next.js** con mappa interattiva, filtri, statistiche, ricerca per indirizzo, analisi
  di copertura, export e API.

È l'adattamento per la Germania di *Punti di ritiro Italia* (via la versione francese *Points relais
France*), a sua volta porting di [Pakketpunten](https://github.com/robbertj85/pakketpunten), il
progetto open source olandese (MIT).

> **Esclusione di responsabilità** — Il progetto è fornito "così com'è", senza garanzie. I dati
> provengono da fonti pubbliche e possono essere incompleti o imprecisi. Il progetto non è affiliato
> alle reti.

---

## Reti e fonti

| Rete (chiave) | Fonte | Metodo | Stato |
|---|---|---|---|
| **Deutsche Post / DHL** (`DHL`: Packstation, Poststation, Postfiliale, DHL Paketshop) | `api-gw.dhlparcel.nl/parcel-shop-locations/DE/by-geo` se risponde per la Germania, altrimenti DHL Location Finder Unified API (chiave gratuita, secret `DHL_API_KEY`) | griglia adattiva, su GitHub; riserva OpenStreetMap | da verificare al primo giro |
| **Hermes** (`Hermes`: PaketShop e Paketstation) | `paketshop.myhermes.de/api/v1/parcelshops/search` (API del PaketShop-Finder, 20 punti per ricerca) | `fetch_hermes.py`, griglia adattiva, su GitHub | trovata con `scopri.py hermes` il 16/10/2026 |
| **DPD** (`DPD`: Pickup Paketshop e Pickup Station) | `pickup.dpd.cz/api/getAll?country=276` | API pubblica DPD, una chiamata (in Francia: 24.563 punti) | da verificare al primo giro |
| **GLS** (`GLS`: PaketShop, Paketstation) | `api.gls-group.net/…-pse-bulk` (API della mappa gls-group.eu, `partnerId` `GLS_DE`) | API, griglia adattiva, su GitHub | da verificare al primo giro |
| **UPS** (`UPS`: Access Point) | localizzatore di ups.com, da un browser visibile | dal PC: `fetch_ups_pc.py` | da fare dal PC |
| **Amazon** (`Amazon`: Locker e Counter) | `amazon.de/location_selector/fetch_locations` | dal PC: `fetch_amazon.py` (cookie di Firefox su amazon.de) | da fare dal PC |
| **FedEx** (`FedEx`) | `local.fedex.com/en/search` | ricerca pubblica, griglia di cerchi | come in Italia e Francia |
| **myflexbox** (`myflexbox`: stazioni aperte a tutti i corrieri) | `api.myflexbox.de/api/1/lockers` (lista della mappa di myflexbox.com) | `fetch_myflexbox.py`, una chiamata, su GitHub | 16/10/2026: 2.063 stazioni |
| **DeinFach** (`DeinFach`: stazioni aperte della Deutsche Post, usate da DHL, UPS e DHL Express) | elenco incluso nel widget Standortfinder di deinfach.de | `fetch_deinfach.py`, un download, su GitHub | 16/10/2026: 1.724 stazioni; da ottobre 2026 confluisce in myflexbox |
| **Mail Boxes Etc.** (`MBE`) | ricerca dello store locator mbe.de (tutti i centri in una chiamata) + pagine dei centri per gli orari | `fetch_mbe.py` | — |
| **Nova Post** (`NovaPost`: filiali proprie e i Paketshop DPD Pickup che usa) | `api.novapost.com/site/v.1.0/divisions?countryCodes[]=DE` (API della pagina Filialen) | `fetch_novapost.py`, 100 per pagina, su GitHub | 16/10/2026: ~11.500 punti, quasi tutti DPD Pickup |

LPR (LPR Logistik) e Parcelly sono esclusi: nessuna mappa pubblica dei punti in Germania (Parcelly oggi vende software per reti di ritiro altrui, non ha una rete propria).

**Hermes**: l'API del PaketShop-Finder restituisce sempre i 20 negozi più vicini a un punto, senza parametri per averne di più: la griglia divide una cella solo quando il ventesimo negozio è ancora più vicino dell'angolo della cella.

**OpenStreetMap come riserva**: `fetch_osm.py` assegna ogni Packstation, Postfiliale, Paketshop o
locker di OSM a tutte le reti che compaiono in `brand`, `operator` o `post_office:brand`, e salva solo
le reti senza una cache da fonte diretta (un fetcher con API o dal PC non viene mai sovrascritto). Per
queste reti i conteggi sono un minimo.

**Trovare la fonte di una rete**: dal PC

```bash
python scripts/scopri.py <rete>     # hermes, myflexbox, deinfach, novapost, mbe, dhl, ups
```

apre il localizzatore della rete in un browser visibile, registra le chiamate che fa la mappa e le
salva in `debug/scopri_<rete>.json`: allegando quel file in chat si scrive il fetcher dedicato.

**Punti serviti da più reti**: un chiosco che è Hermes PaketShop, DPD Pickup e GLS PaketShop è
elencato da tre reti. `scripts/shared_points.py` li riconosce come un solo luogo quando hanno
**indirizzo simile** (stessa via e stesso numero; "Hauptstr." = "Hauptstraße") **e nome simile**. Le
Packstation DHL e gli Amazon Locker non si uniscono mai ai locker di altre reti; le stazioni aperte
(myflexbox, DeinFach) sì, perché le usano più corrieri. Una Postfiliale in Germania è un
negozio partner, quindi può condividere il luogo con le altre reti. Correzioni manuali in
`data/punti_condivisi_correzioni.json`.

**L'indirizzo vale più delle coordinate**: ogni punto con via e numero civico viene spostato sullo
stesso numero della stessa via in **OpenStreetMap**, nella stessa Gemeinde ed entro 3 km
(`scripts/osm_indirizzi.py` → `data/posizioni_indirizzi.json`; workflow **Posizioni dagli indirizzi
(OSM)**, mensile il giorno 3). Le coordinate ufficiali degli edifici (BKG HK-DE) non sono open data
per tutta la Germania, solo per alcuni Länder.

**Territorio**: ~10.800 Gemeinden, ~400 Kreise (Landkreise e kreisfreie Städte), 16 Länder, dai
confini BKG **VG250-EW** (stato al 31.12, con gli abitanti delle statistiche ufficiali; © GeoBasis-DE /
BKG, dl-de/by-2-0), solo la parte di terra. **Popolazione servita** (abitanti entro 5 minuti a piedi,
400 m in linea d'aria) e analisi di copertura: **censimento 2022 su celle di 100 m** (`scripts/fetch_zensus.py`,
dal pacchetto z22data su GitHub; workflow manuale **Scarica popolazione**), con i totali riportati
agli abitanti di ogni Gemeinde.

---

## Differenze rispetto alle versioni italiana e francese

| | Italia | Francia | Germania |
|---|---|---|---|
| Aree | 7.896 comuni + 20 regioni | ~34.900 comuni + 96 dipartimenti + 13 regioni | ~10.800 Gemeinden + ~400 **Kreise** + 16 **Länder** |
| Metri | EPSG:6875 | EPSG:2154 | **ETRS89 / UTM 32N (EPSG:25832)** |
| Confini | ISTAT | IGN via Etalab | **BKG VG250-EW** |
| Popolazione fine | sezioni ISTAT | INSEE 200 m | **Zensus 2022, 100 m** |
| Lingua | italiano | FR / IT / EN | **DE / IT / EN** (`?lang=`) |
| URL | `?comune=` | `?commune=` | `?gemeinde=` (gli altri si leggono ancora) |
| Porta locale | 3000 | 3001 | **3002** |

Nel codice i nomi restano quelli della versione francese: una Gemeinde è una `commune`, un Kreis un
`department` (`departement*` nei file), un Land una `region`, e l'AGS sta nel campo `insee`/`code`.

---

## Avvio rapido

### 1. Backend (dati)

```bash
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
python -m playwright install chromium          # solo per Amazon, UPS e scopri.py

python scripts/prepare_territorium.py          # confini e abitanti BKG VG250-EW (~2 min)

# Reti: ognuna scrive data/<rete>_all_locations.json
python scripts/fetch_dpd.py                    # DPD Pickup: ~1 min
python scripts/fetch_dhl.py                    # Deutsche Post / DHL (DHL_API_KEY facoltativa)
python scripts/fetch_gls.py                    # GLS
python scripts/fetch_hermes.py                 # Hermes PaketShop
python scripts/fetch_myflexbox.py              # myflexbox
python scripts/fetch_deinfach.py               # DeinFach
python scripts/fetch_novapost.py               # Nova Post
python scripts/fetch_mbe.py                    # Mail Boxes Etc.
python scripts/fetch_fedex.py                  # FedEx: ~20 min
python scripts/fetch_osm.py                    # OpenStreetMap: le reti senza fonte diretta
python scripts/fetch_ups_pc.py                 # UPS Access Point, dal PC (browser visibile)
python scripts/fetch_amazon.py                 # dal PC; Ctrl+C salva un checkpoint e si riprende

python scripts/fetch_zensus.py                 # popolazione del censimento 2022 su celle di 100 m
python scripts/build_data.py                   # tutti i file della webapp
python scripts/build_copertura.py              # dati dell'analisi di copertura
```

Si può partire anche con una sola rete: `build_data.py` usa le cache che trova e segnala le mancanti.

### 2. Webapp

```bash
cd webapp
npm install
npm run dev        # http://localhost:3002 (Italia 3000, Francia 3001: si aprono insieme)
```

### 3. Pubblicazione

1. Esegui a mano **Scarica popolazione** (una volta) e poi **Aggiorna i punti di ritiro**
   (*Actions* → *Run workflow*): scarica i dati, costruisce i file e li committa. Poi riparte da solo
   **una volta al mese**, il giorno 4 (Italia il 2, Francia il 3: i minuti di Actions non si sommano
   nello stesso giorno).
2. Amazon e UPS si aggiornano **dal PC**, come in Italia e in Francia, poi commit di
   `data/amazon_all_locations.json` e `data/ups_all_locations.json`.
3. Collega il repository a [Vercel](https://vercel.com) con *Root Directory* = `webapp`.
   Variabili d'ambiente facoltative: `GITHUB_REPOSITORY` (link ai log nella pagina
   Aktualisierungen), `PHOTON_URL` (istanza Photon per la ricerca indirizzi).

I file dati restano fuori dalle funzioni serverless (`outputFileTracingExcludes` in
`next.config.ts`): le API che ne hanno bisogno li leggono dallo storage statico del sito
(`lib/publicData.ts`).

---

## Struttura

```
paketstationen-deutschland/
├── scripts/
│   ├── common.py                # schema dei record, griglie, salvataggio con cache guard
│   ├── cache_guard.py           # blocca i cali anomali (>20%), si auto-ripara in due esecuzioni
│   ├── check_cache_freshness.py # fallisce se una cache ha più di 45 giorni
│   ├── prepare_territorium.py   # Gemeinden/Kreise/Länder, abitanti, municipalities.json, contorni
│   ├── fetch_zensus.py          # popolazione del censimento 2022 (100 m)
│   ├── fetch_dpd.py             # DPD Pickup
│   ├── fetch_dhl.py             # Deutsche Post / DHL
│   ├── fetch_gls.py             # GLS (API della mappa)
│   ├── fetch_hermes.py          # Hermes (API del PaketShop-Finder)
│   ├── fetch_myflexbox.py       # myflexbox (lista della mappa)
│   ├── fetch_deinfach.py        # DeinFach (elenco nel widget)
│   ├── fetch_novapost.py        # Nova Post (API della pagina Filialen)
│   ├── fetch_fedex.py           # FedEx
│   ├── fetch_osm.py             # OpenStreetMap, per le reti senza fonte diretta
│   ├── fetch_ups_pc.py          # UPS dal PC
│   ├── fetch_amazon.py          # Amazon dal PC
│   ├── scopri.py                # registra le chiamate di un localizzatore (dal PC)
│   ├── shared_points.py         # luoghi serviti da più reti
│   ├── build_data.py            # join spaziale → tutti i file della webapp
│   └── build_copertura.py       # dati dell'analisi di copertura
├── data/                        # cache delle reti (committate), territorium/ (generata)
├── .github/workflows/           # update-data.yml (mensile), rebuild.yml, popolazione.yml, indirizzi.yml
└── webapp/
    ├── lib/i18n.tsx, lib/translate.ts, lib/messages/{de,it,en}.ts   # le tre lingue
    ├── lib/territory.ts         # slug: 'deutschland', 'land-*', 'kreis-*', Gemeinden
    ├── lib/carriers.ts          # reti: ordine, colori, etichette, loghi, fonte
    └── public/data/
        ├── <gemeinde>.geojson           # un file per Gemeinde: punti + contorno
        ├── kreis-<name>.geojson         # ~400 file
        ├── land-<name>.geojson          # 16 file
        ├── deutschland.geojson          # tutti i punti, senza orari
        ├── boundaries/                  # contorni delle Gemeinden per Kreis + kreise.geojson
        ├── stats/<kreis>.json           # statistiche delle Gemeinden per Kreis
        └── history/<kreis>.json         # storico delle Gemeinden per Kreis
```

## Aggiungere una lingua

Le stringhe sono in `webapp/lib/messages/`: `de.ts` definisce le chiavi, `it.ts` e `en.ts` sono
tipizzati su di essa, quindi una traduzione mancante fa fallire la build. Per una quarta lingua:
copia `en.ts`, traduci, e aggiungila a `LANGS` in `lib/translate.ts`.

## Licenza

Codice MIT. I dati mantengono le licenze delle fonti (BKG e censimento: Datenlizenz Deutschland –
Namensnennung 2.0; OpenStreetMap: ODbL).
