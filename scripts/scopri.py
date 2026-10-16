"""
Registra le chiamate del localizzatore di una rete tedesca (da lanciare sul PC).

Alcuni localizzatori bloccano i browser automatici "invisibili" (GitHub
Actions) o non rispondono da fuori della Germania. Questo script apre una
finestra di browser VISIBILE (Chrome se installato, altrimenti il Chromium di
Playwright; SCOPRI_BROWSER=chromium per usare sempre il Chromium di Playwright,
SCOPRI_BROWSER=firefox per il Firefox di Playwright): tu accetti i
cookie e cerchi "Frankfurt" come faresti a mano; lo script registra in background
le risposte dei server e le salva in debug/scopri_<rete>.json.
Da quel file si ricava l'interfaccia per scaricare tutti i punti della rete.

    python scripts/scopri.py hermes      # oppure: myflexbox, deinfach, parcelly, novapost, mbe, dhl, ups

Poi premi Invio nel terminale quando la mappa mostra i risultati e allega il
file debug/scopri_<rete>.json nella chat (non contiene i tuoi cookie).
"""

import json
import os
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

OUT = Path(__file__).resolve().parent.parent / "debug"
OUT.mkdir(exist_ok=True)

# Pagina di partenza di ogni localizzatore (SCOPRI_URL la sostituisce)
NETWORKS = {
    "hermes": "https://www.myhermes.de/paketshopfinder/",
    "myflexbox": "https://www.myflexbox.com/",
    "deinfach": "https://www.deinfach.de/",
    "parcelly": "https://www.parcelly.com/",
    "novapost": "https://novapost.com/de-de/departments",
    "mbe": "https://www.mbe.de/de/store-locator",
    "dhl": "https://www.dhl.de/de/privatkunden/dhl-standorte-finden.html",
    "ups": "https://www.ups.com/de/de/home",
}
SKIP = ("analytics", "doubleclick", "google", "adobe", "demdex", "qualtrics", "onetrust", "nr-data",
        "facebook", "bing", "linkedin", "hotjar", "clarity", "tiktok", "cookielaw", "omtrdc", "everesttech",
        "didomi", "axeptio", "criteo", "contentsquare", "matomo", "piano", "xiti")
calls = []


def on_response(response):
    request = response.request
    if request.resource_type not in ("xhr", "fetch", "document", "script"):
        return
    if any(s in response.url for s in SKIP):
        return
    if request.resource_type == "script" and response.url.endswith(".js"):
        return  # librerie: inutili e pesanti
    entry = {"url": response.url, "status": response.status, "method": request.method,
             "type": request.resource_type,
             "post": (request.post_data or "")[:5000],
             "req_headers": {k: v for k, v in request.headers.items() if k.lower() not in ("cookie",)}}
    try:
        entry["body"] = response.text()[:200_000]
    except Exception as error:  # noqa: BLE001
        entry["body"] = f"<{error}>"
    calls.append(entry)
    print(f"   · {response.status} {request.method} {response.url[:120]}", flush=True)


def _dismiss(dialog):
    try:
        dialog.dismiss()
    except Exception:  # noqa: BLE001
        pass


def save_calls(network):
    path = OUT / f"scopri_{network}.json"
    path.write_text(json.dumps(calls, ensure_ascii=False, indent=1), encoding="utf-8")
    return path


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in NETWORKS:
        print("Uso: python scripts/scopri.py <rete>   reti: " + ", ".join(NETWORKS))
        return 1
    network = sys.argv[1]
    try:
        with sync_playwright() as p:
            choice = os.environ.get("SCOPRI_BROWSER", "").lower()
            if choice == "firefox":
                # serve: python -m playwright install firefox
                browser = p.firefox.launch(headless=False)
            elif choice == "chromium":
                # il Chromium di Playwright invece del Chrome installato
                browser = p.chromium.launch(headless=False)
            else:
                try:
                    browser = p.chromium.launch(channel="chrome", headless=False)
                except Exception:  # noqa: BLE001 - Chrome non installato: Chromium di Playwright
                    browser = p.chromium.launch(headless=False)
            context = browser.new_context(locale="de-DE", viewport={"width": 1280, "height": 900})
            # ogni scheda del contesto, nel caso il localizzatore si apra in una nuova
            context.on("response", on_response)
            # pop-up JavaScript (alert) del sito: neutralizzati, altrimenti bloccano il driver
            context.add_init_script("window.alert=()=>{};window.confirm=()=>true;window.prompt=()=>null;")
            context.on("page", lambda pg: pg.on("dialog", lambda d: _dismiss(d)))
            page = context.new_page()
            try:
                page.goto(os.environ.get("SCOPRI_URL", NETWORKS[network]), wait_until="domcontentloaded", timeout=90000)
            except Exception as error:  # noqa: BLE001 - pagina lenta o bloccata: si continua lo stesso
                print(f"   ⚠️  apertura della pagina: {str(error).splitlines()[0]}")
            print(f"\n👉 Nella finestra del browser ({network}): accetta i cookie, apri la ricerca dei")
            print("   punti di ritiro / Paketstationen, cerca \"Frankfurt\" e aspetta la lista dei punti.")
            print("   Se puoi, apri anche il dettaglio di un punto e poi sposta un po' la mappa.")
            print("   NON chiudere la finestra del browser: torna qui e premi Invio.")
            input("   Quando vedi i risultati (o se il sito non funziona), premi Invio... ")
            try:
                page = context.pages[-1]
                page.wait_for_timeout(2000)
                (OUT / f"scopri_{network}.png").write_bytes(page.screenshot())
                # la pagina com'è adesso (liste generate dal server o dal JavaScript)
                calls.append({"url": page.url, "type": "final-dom", "status": 0, "method": "",
                              "post": "", "body": page.content()[:1_500_000]})
            except Exception:  # noqa: BLE001 - finestra già chiusa
                pass
            try:
                browser.close()
            except Exception:  # noqa: BLE001
                pass
    except KeyboardInterrupt:
        print("\n⏸ interrotto")
    except Exception as error:  # noqa: BLE001 - si salva comunque quello che è stato registrato
        print(f"\n⚠️  errore: {str(error).splitlines()[0] if str(error) else type(error).__name__}")
    finally:
        path = save_calls(network)
        print(f"\n💾 {len(calls)} risposte registrate in {path}")
        print("   Allega questo file nella chat (non contiene i tuoi cookie).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
