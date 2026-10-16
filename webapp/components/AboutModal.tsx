'use client';

import { useState, useEffect, useRef } from 'react';
import { useI18n } from '@/lib/i18n';
import { CARRIER_BRAND, CARRIER_LABELS, CARRIER_ORDER, CARRIER_SOURCE, type Carrier } from '@/lib/carriers';

interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/** Where each network's points come from (scripts/fetch_*.py). */
const SOURCES: Record<Carrier, { endpoint: string; url: string }> = {
  DHL: { endpoint: 'api-gw.dhlparcel.nl/parcel-shop-locations/DE/by-geo · api.dhl.com/location-finder/v1 · OpenStreetMap', url: 'https://www.dhl.de/de/privatkunden/dhl-standorte-finden.html' },
  Hermes: { endpoint: 'paketshop.myhermes.de/api/v1/parcelshops/search', url: 'https://www.myhermes.de/paketshopfinder/' },
  DPD: { endpoint: 'pickup.dpd.cz/api/getAll?country=276', url: 'https://www.dpd.com/de/de/' },
  GLS: { endpoint: 'api.gls-group.net/parcel-shop-management/v2/available-public-parcel-shops-pse-bulk', url: 'https://gls-group.com/DE/de/paketshop-finden/' },
  UPS: { endpoint: 'widgets.ups.com/api/ups.app/xml/Locator', url: 'https://www.ups.com/de' },
  Amazon: { endpoint: 'www.amazon.de/location_selector/fetch_locations', url: 'https://www.amazon.de' },
  FedEx: { endpoint: 'local.fedex.com/en/search', url: 'https://www.fedex.com/de-de' },
  myflexbox: { endpoint: 'api.myflexbox.de/api/1/lockers', url: 'https://www.myflexbox.com' },
  DeinFach: { endpoint: 'standortfinder.deinfach.de/location-finder-widget.es.js (Standortfinder)', url: 'https://www.deinfach.de' },
  MBE: { endpoint: 'OpenStreetMap (Overpass API)', url: 'https://www.mbe.de' },
  NovaPost: { endpoint: 'OpenStreetMap (Overpass API)', url: 'https://novapost.com/de-de/' },
  Parcelly: { endpoint: 'OpenStreetMap (Overpass API)', url: 'https://www.parcelly.com' },
};

const TABS = ['about', 'sources', 'usage', 'links'] as const;
type Tab = (typeof TABS)[number];

export default function AboutModal({ isOpen, onClose }: AboutModalProps) {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<Tab>('about');
  const contentRef = useRef<HTMLDivElement>(null);

  // Reset scroll position when tab changes
  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollTop = 0;
    }
  }, [activeTab]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-card rounded-t-xl sm:rounded-lg shadow-xl w-full sm:max-w-3xl max-h-[70vh] sm:max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-border flex justify-between items-center bg-card flex-shrink-0">
          <h2 className="text-xl sm:text-2xl font-bold text-foreground">{t('about.title')}</h2>
          <button
            onClick={onClose}
            className="p-2 -mr-2 text-subtle-foreground hover:text-muted-foreground hover:bg-secondary rounded-full transition"
            aria-label={t('common.close')}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs - scrollable on mobile */}
        <div className="flex border-b border-border px-2 sm:px-6 overflow-x-auto scrollbar-hide bg-card flex-shrink-0">
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`py-3 px-3 sm:px-4 font-medium text-xs sm:text-sm border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab
                  ? 'border-primary text-primary'
                  : 'border-transparent text-subtle-foreground hover:text-muted-foreground'
              }`}
            >
              {t(`about.tab.${tab}`)}
            </button>
          ))}
        </div>

        {/* Content */}
        <div ref={contentRef} className="flex-1 overflow-y-auto px-4 sm:px-6 py-3 sm:py-4">
          {activeTab === 'about' && (
            <div className="space-y-4">
              <section>
                <h3 className="text-lg font-semibold text-foreground mb-2">{t('about.heading')}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed mb-3">{t('about.p1')}</p>
                <p className="text-muted-foreground text-sm leading-relaxed">{t('about.p2')}</p>
              </section>

              <section>
                <h4 className="text-md font-semibold text-foreground mb-2">{t('about.features')}</h4>
                <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
                  {(['f1', 'f2', 'f3', 'f4', 'f5', 'f6'] as const).map((f) => (
                    <li key={f}>{t(`about.${f}`)}</li>
                  ))}
                </ul>
              </section>

              <section>
                <h4 className="text-md font-semibold text-foreground mb-2">{t('about.origin')}</h4>
                <p className="text-sm text-muted-foreground leading-relaxed mb-2">{t('about.originText')}</p>
                <a
                  href="https://github.com/robbertj85/pakketpunten"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center text-sm text-primary hover:text-primary font-medium"
                >
                  {t('about.originLink')}
                </a>
              </section>
            </div>
          )}

          {activeTab === 'sources' && (
            <div className="space-y-4">
              <section>
                <h3 className="text-lg font-semibold text-foreground mb-3">{t('about.sourcesTitle')}</h3>
                <p className="text-sm text-muted-foreground mb-4">{t('about.sourcesIntro')}</p>
              </section>

              <div className="space-y-3">
                {CARRIER_ORDER.map((carrier) => (
                  <DataSourceCard
                    key={carrier}
                    name={CARRIER_LABELS[carrier]}
                    endpoint={SOURCES[carrier].endpoint}
                    type={t(`about.src.${CARRIER_SOURCE[carrier]}`)}
                    note={['DHL', 'DeinFach'].includes(carrier) ? t(`about.note.${carrier}`) : undefined}
                    url={SOURCES[carrier].url}
                    color={CARRIER_BRAND[carrier].background}
                  />
                ))}
              </div>

              <section className="border-t pt-4 mt-4">
                <h4 className="text-md font-semibold text-foreground mb-2">{t('about.more')}</h4>
                <ul className="text-sm text-muted-foreground space-y-1">
                  {(['more1', 'more2', 'more3', 'more4'] as const).map((k) => (
                    <li key={k}>• {t(`about.${k}`)}</li>
                  ))}
                </ul>
              </section>

              <section className="bg-accent border border-primary/30 rounded-lg p-4">
                <h4 className="text-sm font-semibold text-accent-foreground mb-2">{t('about.frequency')}</h4>
                <p className="text-sm text-primary">{t('about.frequencyText')}</p>
              </section>
            </div>
          )}

          {activeTab === 'usage' && (
            <div className="space-y-4">
              <section>
                <h3 className="text-lg font-semibold text-foreground mb-3">{t('about.terms')}</h3>
                <div className="space-y-2">
                  <UsageItem allowed>{t('about.u1')}</UsageItem>
                  <UsageItem allowed>{t('about.u2')}</UsageItem>
                  <UsageItem allowed={false}>{t('about.u3')}</UsageItem>
                  <UsageItem allowed={false}>{t('about.u4')}</UsageItem>
                </div>
              </section>

              <section className="border-t pt-4 mt-4">
                <h4 className="text-md font-semibold text-foreground mb-2">{t('about.attribution')}</h4>
                <pre className="p-3 bg-muted border border-border rounded text-xs whitespace-pre-wrap text-muted-foreground">{t('about.attributionText')}</pre>
              </section>

              <section className="bg-muted border border-input rounded-lg p-4">
                <h4 className="text-sm font-semibold text-foreground mb-2">{t('about.disclaimer')}</h4>
                <p className="text-sm text-muted-foreground leading-relaxed">{t('about.disclaimerText')}</p>
              </section>
            </div>
          )}

          {activeTab === 'links' && (
            <div className="space-y-4">
              <section>
                <h3 className="text-lg font-semibold text-foreground mb-3">{t('about.linksTitle')}</h3>
              </section>
              <div className="space-y-3">
                <ExternalLink title="Bundesnetzagentur — Post" description={t('about.l.bnetza')} url="https://www.bundesnetzagentur.de/DE/Fachthemen/Post/start.html" />
                <ExternalLink title="BKG — Verwaltungsgebiete VG250" description={t('about.l.bkg')} url="https://gdz.bkg.bund.de/index.php/default/verwaltungsgebiete-1-250-000-mit-einwohnerzahlen-stand-31-12-vg250-ew-31-12.html" />
                <ExternalLink title="Zensus 2022" description={t('about.l.zensus')} url="https://www.zensus2022.de" />
                <ExternalLink title="Pakketpunten" description={t('about.l.pakketpunten')} url="https://github.com/robbertj85/pakketpunten" />
                <ExternalLink title="OpenStreetMap" description={t('about.l.osm')} url="https://www.openstreetmap.org" />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 sm:px-6 py-3 sm:py-4 border-t border-border bg-card flex-shrink-0">
          <button
            onClick={onClose}
            className="w-full px-4 py-3 sm:py-2 bg-primary text-white rounded-lg hover:bg-primary/90 active:bg-primary/80 transition font-medium text-base sm:text-sm"
          >
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  );
}

// Helper component for data source cards
function DataSourceCard({
  name,
  endpoint,
  type,
  note,
  url,
  color
}: {
  name: string;
  endpoint: string;
  type: string;
  note?: string;
  url: string;
  color: string;
}) {
  const { t } = useI18n();
  return (
    <div className="border border-border rounded-lg p-3 hover:border-input transition">
      <div className="flex items-start">
        <div
          className="w-4 h-4 rounded-full mt-0.5 mr-3 flex-shrink-0"
          style={{ backgroundColor: color }}
        />
        <div className="flex-1 min-w-0">
          <h5 className="font-semibold text-sm text-foreground">{name}</h5>
          <p className="text-xs text-muted-foreground mt-1">
            <span className="font-medium">{t('about.type')}</span> {type}
          </p>
          {note && <p className="text-xs text-muted-foreground mt-0.5">{note}</p>}
          <p className="text-xs text-subtle-foreground mt-0.5 font-mono break-all">
            {endpoint}
          </p>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-primary hover:text-primary mt-1 inline-block"
          >
            {url} ↗
          </a>
        </div>
      </div>
    </div>
  );
}

// Helper component for usage items
function UsageItem({ allowed, children }: { allowed: boolean; children: React.ReactNode }) {
  return (
    <div className="flex items-start text-sm">
      <span className={`mr-2 mt-0.5 ${allowed ? 'text-success' : 'text-destructive'}`}>
        {allowed ? '✓' : '✗'}
      </span>
      <span className={allowed ? 'text-muted-foreground' : 'text-muted-foreground'}>{children}</span>
    </div>
  );
}

// Helper component for external links
function ExternalLink({ title, description, url }: { title: string; description: string; url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="block border border-border rounded-lg p-3 hover:border-input hover:bg-muted transition"
    >
      <h5 className="font-semibold text-sm text-foreground">{title} ↗</h5>
      <p className="text-xs text-muted-foreground mt-1">{description}</p>
    </a>
  );
}
