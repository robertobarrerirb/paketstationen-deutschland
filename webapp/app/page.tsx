'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import dynamic from 'next/dynamic';
import MunicipalitySelector from '@/components/MunicipalitySelector';
import AddressSearchInput from '@/components/AddressSearchInput';
import FilterPanel from '@/components/FilterPanel';
import StatsPanel from '@/components/StatsPanel';
import AboutModal from '@/components/AboutModal';
import ShareModal from '@/components/ShareModal';
import NearestPointsFinder from '@/components/NearestPointsFinder';
import { Municipality, PakketpuntData, Filters, PakketpuntProperties, PakketpuntFeature, PointCategory, ServiceFilter, getPointCategory } from '@/types/pakketpunten';
import { loadDepartmentOutlines, loadCommuneOutlines, BoundaryLoadProgress } from '@/utils/boundaryLoader';
import { useI18n, LanguageSwitcher } from '@/lib/i18n';
import { CARRIER_ORDER } from '@/lib/carriers';
import { NATIONAL_SLUG, DEFAULT_SLUG, isAggregateSlug, isNationalSlug, isRegionSlug, isDepartmentSlug, slugFromSearchParams, slugToUrl } from '@/lib/territory';
import { loadResidentsData, residentsByCarrier, typesForCategories, type ResidentsData } from '@/lib/residents';
import { buildPlaceIndex, countSharedPlaces } from '@/lib/sharedPlaces';

// Mobile menu icon component
function MenuIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

// Close icon component
function CloseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

// Filter icon component
function FilterIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
    </svg>
  );
}

// Dynamically import Map component to avoid SSR issues with Leaflet
// Named MapView to avoid collision with JavaScript's native Map class
function MapLoading() {
  const { t } = useI18n();
  return (
    <div className="w-full h-full flex items-center justify-center bg-secondary">
      <p className="text-subtle-foreground">{t('common.loadingMap')}</p>
    </div>
  );
}

const MapView = dynamic(() => import('@/components/Map'), {
  ssr: false,
  loading: () => <MapLoading />,
});

export default function Home() {
  const { t, fmtDate } = useI18n();
  const [municipalities, setMunicipalities] = useState<Municipality[]>([]);
  const [selectedMunicipality, setSelectedMunicipality] = useState<string>('');
  const [data, setData] = useState<PakketpuntData | null>(null);
  const [loading, setLoading] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [boundariesLoaded, setBoundariesLoaded] = useState(false);
  const [boundariesLoading, setBoundariesLoading] = useState(false);
  const [boundaryLoadProgress, setBoundaryLoadProgress] = useState<BoundaryLoadProgress | null>(null);
  const [tilesLoading, setTilesLoading] = useState(false);
  const [targetCoordinates, setTargetCoordinates] = useState<{ latitude: number; longitude: number } | null>(null);
  const [searchLocationMarker, setSearchLocationMarker] = useState<{ latitude: number; longitude: number } | null>(null);
  const [highlightedPoints, setHighlightedPoints] = useState<Set<string> | null>(null);

  // Mobile UI state
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // Nearest Points Finder state
  const [nearestPointsOpen, setNearestPointsOpen] = useState(false);
  const [lastAddressSearch, setLastAddressSearch] = useState<{
    coordinates: { latitude: number; longitude: number };
    displayName: string;
  } | null>(null);

  // Track previous municipality to detect manual changes vs address search changes
  const previousMunicipality = useRef<string>(selectedMunicipality);

  // Close mobile menu when clicking outside or pressing escape
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMobileMenuOpen(false);
        setMobileSidebarOpen(false);
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, []);
  const [filters, setFilters] = useState<Filters>({
    providers: [...CARRIER_ORDER],
    showBuffer300: false,
    showBuffer400: true,
    showBuffer500: false,
    showBufferFill: true,
    bufferMerged: true,
    showBoundary: false,
    useSimpleMarkers: false,
    minOccupancy: 0,
    maxOccupancy: 100,
    showMockData: false,
    pointCategories: ['locker', 'shop'],
    showOnlySharedLocations: false,
    serviceFilters: ['pickup', 'dropoff'],
  });

  // Load municipalities on mount
  useEffect(() => {
    fetch('/municipalities.json')
      .then((res) => {
        if (!res.ok) {
          throw new Error(`HTTP error! status: ${res.status}`);
        }
        return res.json();
      })
      .then((data) => {
        // Sort alphabetically, but put Germany at the bottom
        const sortedData = data.sort((a: Municipality, b: Municipality) => {
          if (a.slug === NATIONAL_SLUG) return 1;
          if (b.slug === NATIONAL_SLUG) return -1;
          return a.name.localeCompare(b.name, 'de');
        });

        setMunicipalities(sortedData);

        // Priority: 1) URL ?gemeinde= param, 2) localStorage, 3) default Frankfurt am Main
        const urlParams = new URLSearchParams(window.location.search);
        const gemeenteParam = slugFromSearchParams(urlParams);
        const lastSelected = localStorage.getItem('lastSelectedMunicipality');

        if (gemeenteParam && sortedData.find((m: Municipality) => m.slug === gemeenteParam)) {
          setSelectedMunicipality(gemeenteParam);
        } else if (lastSelected && sortedData.find((m: Municipality) => m.slug === lastSelected)) {
          // Use last selected if it exists in the data
          setSelectedMunicipality(lastSelected);
        } else {
          // Default to Frankfurt am Main on first visit
          const fallback = sortedData.find((m: Municipality) => m.slug === DEFAULT_SLUG);
          if (fallback) {
            setSelectedMunicipality(DEFAULT_SLUG);
          } else if (sortedData.length > 0) {
            setSelectedMunicipality(sortedData[0].slug);
          }
        }
      })
      .catch((err) => console.error('Error loading municipalities:', err));
  }, []);

  // Save selected municipality to localStorage and update URL
  // Only runs after municipalities are loaded to avoid overwriting URL params on initial render
  useEffect(() => {
    if (selectedMunicipality && municipalities.length > 0) {
      localStorage.setItem('lastSelectedMunicipality', selectedMunicipality);
      const url = new URL(window.location.href);
      // Use URL-friendly alias for the national view
      url.searchParams.delete('gemeente');
      url.searchParams.delete('comune');
      url.searchParams.delete('commune');
      url.searchParams.set('gemeinde', slugToUrl(selectedMunicipality));
      window.history.replaceState({}, '', url.toString());
    }
  }, [selectedMunicipality, municipalities]);

  // Clear target coordinates when municipality changes manually (not from address search)
  useEffect(() => {
    if (previousMunicipality.current !== selectedMunicipality && !targetCoordinates) {
      // Municipality changed without targetCoordinates being set
      // This means it was a manual change via dropdown
      // Clear any old coordinates
      setTargetCoordinates(null);
    }
    previousMunicipality.current = selectedMunicipality;
  }, [selectedMunicipality, targetCoordinates]);

  // Load data when municipality changes
  useEffect(() => {
    if (!selectedMunicipality) {
      setData(null);
      return;
    }

    setLoading(true);
    fetch(`/data/${selectedMunicipality}.geojson`)
      .then(async (res) => {
        console.log('Response status:', res.status);
        console.log('Content-Type:', res.headers.get('content-type'));

        if (!res.ok) {
          const text = await res.text();
          console.error('Response body:', text.substring(0, 200));
          throw new Error(`HTTP error! status: ${res.status}`);
        }

        // Check content type
        const contentType = res.headers.get('content-type');
        if (!contentType || (!contentType.includes('json') && !contentType.includes('geo'))) {
          const text = await res.text();
          console.error('Wrong content type. First 500 chars:', text.substring(0, 500));
          throw new Error(`Expected JSON but got: ${contentType}`);
        }

        return res.json();
      })
      .then((data) => {
        console.log('Data loaded successfully!', data.metadata);
        setData(data);
        // Reset boundaries loaded state when changing municipality
        setBoundariesLoaded(false);
        // NOTE: Don't clear searchLocationMarker here - it should persist when
        // NearestPointsFinder triggers a municipality change. It's cleared when:
        // 1. User manually changes municipality via dropdown
        // 2. User uses main address search
        // 3. User closes the NearestPointsFinder panel

        // Reset filters when changing municipality
        // Logos by default everywhere: with too many places in view the map draws dots by
        // itself (autoSimple in Map.tsx) and switches to logos when zooming in
        // Don't automatically show boundaries - user must click checkbox to load them
        setFilters({
          providers: data.metadata.providers || [...CARRIER_ORDER],
          showBuffer300: false,
          showBuffer400: true,
          showBuffer500: false,
          showBufferFill: true,
          bufferMerged: true,
          showBoundary: false,
          useSimpleMarkers: false,
          minOccupancy: 0,
          maxOccupancy: 100,
          showMockData: false,
          pointCategories: ['locker', 'shop'],
          showOnlySharedLocations: false,
          serviceFilters: ['pickup', 'dropoff'],
        });
      })
      .catch((err) => {
        console.error('Error loading data:', err);
        console.error('Failed to load:', `/data/${selectedMunicipality}.geojson`);
      })
      .finally(() => setLoading(false));
  }, [selectedMunicipality]);

  // Load boundaries separately when user enables them for Nederland view
  // Germany: one small file of Kreis outlines; Länder and Kreise: commune outlines per Kreis
  useEffect(() => {
    // Only load boundaries for Nederland view when user clicks checkbox
    if (!isAggregateSlug(selectedMunicipality) || !filters.showBoundary || boundariesLoaded || boundariesLoading) {
      return;
    }

    setBoundariesLoading(true);
    setBoundaryLoadProgress(null);
    console.log('Loading boundaries...');

    const onProgress = (progress: BoundaryLoadProgress) => {
      setBoundaryLoadProgress(progress);
    };
    // Germany: the ~400 Kreis outlines; Land / Kreis: its commune outlines
    (isNationalSlug(selectedMunicipality)
      ? loadDepartmentOutlines(onProgress)
      : loadCommuneOutlines(selectedMunicipality, onProgress))
      .then((boundariesData) => {
        console.log(`✅ Boundaries loaded: ${boundariesData.metadata.total_boundaries} outlines from ${boundariesData.metadata.files_loaded} files`);
        // Merge boundary features into existing data
        if (data) {
          setData({
            ...data,
            features: [...data.features, ...boundariesData.features]
          });
        }
        setBoundariesLoaded(true);
        setBoundaryLoadProgress(null);
      })
      .catch((err) => {
        console.error('Error loading boundaries:', err);
        setBoundaryLoadProgress(null);
      })
      .finally(() => setBoundariesLoading(false));
  }, [selectedMunicipality, filters.showBoundary, data, boundariesLoaded, boundariesLoading]);

  // Helper: Check if a point matches service filters
  const matchesServiceFilters = (props: PakketpuntProperties): boolean => {
    const wantsPickup = filters.serviceFilters.includes('pickup');
    const wantsDropoff = filters.serviceFilters.includes('dropoff');

    // If both filters selected, show locations that support at least one
    // If only pickup selected, show locations that support pickup
    // If only dropoff selected, show locations that support dropoff
    if (wantsPickup && wantsDropoff) {
      return props.canPickup || props.canDropoff;
    } else if (wantsPickup) {
      return props.canPickup;
    } else if (wantsDropoff) {
      return props.canDropoff;
    }
    return false; // No service filters selected
  };

  // Calculate provider counts for filtered data (considering category + service filters)
  // Residents within 5 minutes on foot, recomputed for the selected networks and point types
  const [residentsData, setResidentsData] = useState<ResidentsData | null>(null);
  useEffect(() => {
    loadResidentsData().then(setResidentsData).catch(() => setResidentsData(null));
  }, []);
  const residentsArea = useMemo(() => {
    const meta = (data?.metadata ?? {}) as { departement?: string; region?: string };
    return {
      comune: isAggregateSlug(selectedMunicipality) ? null : selectedMunicipality,
      dipartimento: isDepartmentSlug(selectedMunicipality) ? meta.departement ?? null : null,
      regione: isRegionSlug(selectedMunicipality) ? meta.region ?? null : null,
    };
  }, [data, selectedMunicipality]);
  const providerResidents = useMemo(() => {
    if (!data) return undefined;
    if (!residentsData) return data.metadata.abitanti_serviti;
    return residentsByCarrier(residentsData, {
      ...residentsArea,
      carriers: filters.providers,
      types: typesForCategories(filters.pointCategories),
    });
  }, [data, residentsData, residentsArea, filters.providers, filters.pointCategories]);

  // Residents of the territory and those within 5 minutes of a point of any type (selected networks)
  const territoryResidents = useMemo(() => {
    if (!data || !residentsData) return null;
    const reached = residentsByCarrier(residentsData, {
      ...residentsArea,
      carriers: filters.providers,
      types: ['locker', 'pickup_point', 'post_office'],
    });
    return { popolazione: reached._popolazione, conPunto: reached._tutte };
  }, [data, residentsData, residentsArea, filters.providers]);

  const providerCounts = useMemo(() => {
    if (!data) return {};

    const points = data.features.filter(f => f.properties.type === 'pakketpunt');
    const filteredPoints = points.filter((feature) => {
      const props = feature.properties as PakketpuntProperties;
      const category = getPointCategory(props.puntType);
      return (
        filters.providers.includes(props.vervoerder) &&
        filters.pointCategories.includes(category) &&
        matchesServiceFilters(props) &&
        props.bezettingsgraad >= filters.minOccupancy &&
        props.bezettingsgraad <= filters.maxOccupancy
      );
    });

    return filteredPoints.reduce((acc, feature) => {
      const props = feature.properties as PakketpuntProperties;
      acc[props.vervoerder] = (acc[props.vervoerder] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  }, [data, filters]);

  // Calculate category counts for filtered data (considering provider + service filters)
  const categoryCounts = useMemo(() => {
    if (!data) return { locker: 0, shop: 0 } as Record<PointCategory, number>;

    const points = data.features.filter(f => f.properties.type === 'pakketpunt');
    const filteredPoints = points.filter((feature) => {
      const props = feature.properties as PakketpuntProperties;
      const category = getPointCategory(props.puntType);
      return (
        filters.providers.includes(props.vervoerder) &&
        filters.pointCategories.includes(category) &&
        matchesServiceFilters(props) &&
        props.bezettingsgraad >= filters.minOccupancy &&
        props.bezettingsgraad <= filters.maxOccupancy
      );
    });

    return filteredPoints.reduce((acc, feature) => {
      const props = feature.properties as PakketpuntProperties;
      const category = getPointCategory(props.puntType);
      acc[category] = (acc[category] || 0) + 1;
      return acc;
    }, { locker: 0, shop: 0 } as Record<PointCategory, number>);
  }, [data, filters]);

  // Calculate service counts for filtered data (considering provider + category filters)
  const serviceCounts = useMemo(() => {
    if (!data) return { pickup: 0, dropoff: 0 } as Record<ServiceFilter, number>;

    const points = data.features.filter(f => f.properties.type === 'pakketpunt');
    const filteredPoints = points.filter((feature) => {
      const props = feature.properties as PakketpuntProperties;
      const category = getPointCategory(props.puntType);
      return (
        filters.providers.includes(props.vervoerder) &&
        filters.pointCategories.includes(category) &&
        props.bezettingsgraad >= filters.minOccupancy &&
        props.bezettingsgraad <= filters.maxOccupancy
      );
    });

    return filteredPoints.reduce((acc, feature) => {
      const props = feature.properties as PakketpuntProperties;
      if (props.canPickup) acc.pickup = (acc.pickup || 0) + 1;
      if (props.canDropoff) acc.dropoff = (acc.dropoff || 0) + 1;
      return acc;
    }, { pickup: 0, dropoff: 0 } as Record<ServiceFilter, number>);
  }, [data, filters]);

  // Number of places served by two or more networks
  const sharedLocationCount = useMemo(() => {
    if (!data) return 0;

    const points = data.features.filter(f => f.properties.type === 'pakketpunt');
    const filteredPoints = points.filter((feature) => {
      const props = feature.properties as PakketpuntProperties;
      const category = getPointCategory(props.puntType);
      return (
        filters.providers.includes(props.vervoerder) &&
        filters.pointCategories.includes(category) &&
        props.bezettingsgraad >= filters.minOccupancy &&
        props.bezettingsgraad <= filters.maxOccupancy
      );
    });

    // Places served by two or more networks (lib/sharedPlaces)
    return countSharedPlaces(filteredPoints as PakketpuntFeature[], buildPlaceIndex(points as PakketpuntFeature[]));
  }, [data, filters]);

  // Handle address selection from main search (NOT NearestPointsFinder)
  const handleAddressSelected = (
    municipalitySlug: string,
    coordinates: { latitude: number; longitude: number },
    displayName: string
  ) => {
    console.log('Address selected:', coordinates, 'Municipality:', municipalitySlug);
    // Close the top 10 panel and clear highlighting (new search cancels filtering)
    setNearestPointsOpen(false);
    setHighlightedPoints(null);
    // Show marker at the searched location
    setSearchLocationMarker(coordinates);
    // Store the address search for potential use by NearestPointsFinder
    setLastAddressSearch({ coordinates, displayName });
    // Store coordinates BEFORE changing municipality
    // This way the coordinates persist through the municipality change
    setTargetCoordinates(coordinates);
    // Then change municipality (will trigger data load)
    setSelectedMunicipality(municipalitySlug);
  };

  // Clear target coordinates after map has zoomed to them
  const handleMapZoomedToTarget = () => {
    console.log('Map zoomed to target, clearing coordinates');
    setTargetCoordinates(null);
  };

  return (
    <div className="h-screen flex flex-col">
      {/* Header - Desktop */}
      <header className="bg-card shadow-sm z-20">
        {/* Main header row */}
        <div className="px-3 py-2 md:px-4 md:py-3 flex items-center gap-2 md:gap-4">
          {/* Logo */}
          <div className="flex-shrink-0">
            <h1 className="text-lg md:text-xl font-bold text-foreground">📦 <span className="hidden sm:inline">{t('app.title')}</span></h1>
          </div>

          {/* Municipality Selector - always visible but responsive width */}
          <div className="flex-1 min-w-0 max-w-[200px] sm:max-w-xs md:max-w-md">
            <MunicipalitySelector
              municipalities={municipalities}
              selected={selectedMunicipality}
              onChange={(slug) => {
                // Close top 10 panel and clear search state when manually changing municipality
                setNearestPointsOpen(false);
                setSearchLocationMarker(null);
                setHighlightedPoints(null);
                setLastAddressSearch(null);
                setSelectedMunicipality(slug);
                setMobileSidebarOpen(false);
              }}
            />
          </div>

          {/* Address Search - hidden on mobile, shown on tablet+ */}
          <div className="hidden md:block flex-1 max-w-md">
            <AddressSearchInput
              municipalities={municipalities}
              onAddressSelected={handleAddressSelected}
            />
          </div>

          {/* Nearest Points Finder toggle button */}
          <button
            onClick={() => {
              if (nearestPointsOpen) {
                // Closing - only clear highlighting, keep marker visible
                setNearestPointsOpen(false);
                setHighlightedPoints(null);
              } else {
                // Opening
                setNearestPointsOpen(true);
              }
            }}
            className={`hidden md:flex items-center justify-center w-10 h-10 rounded-lg transition ${
              nearestPointsOpen
                ? 'bg-primary text-white'
                : lastAddressSearch
                  ? 'bg-accent text-primary hover:bg-accent/70 ring-2 ring-ring'
                  : 'bg-secondary text-muted-foreground hover:bg-border'
            }`}
            title={lastAddressSearch
              ? t('header.nearestTitleWith', { name: lastAddressSearch.displayName })
              : t('header.nearestTitle')
            }
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          </button>

          {/* Loading indicator */}
          {loading && (
            <div className="flex items-center gap-1 md:gap-2 text-xs md:text-sm text-subtle-foreground">
              <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <span className="hidden sm:inline">{t('common.loading')}</span>
            </div>
          )}

          {/* Desktop action buttons - hidden on mobile */}
          <div className="hidden lg:flex gap-2 ml-auto items-center">
            <LanguageSwitcher />
            <a
              href="/data-export"
              className="px-3 py-2 text-sm font-medium text-muted-foreground bg-secondary rounded-lg hover:bg-border transition flex items-center"
            >
              <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              {t('header.data')}
            </a>
            <a
              href="/api/v1/docs"
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-2 text-sm font-medium text-muted-foreground bg-secondary rounded-lg hover:bg-border transition flex items-center"
            >
              <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
              </svg>
              API
            </a>
            <button
              onClick={() => setShowShare(true)}
              className="px-3 py-2 text-sm font-medium text-muted-foreground bg-secondary rounded-lg hover:bg-border transition flex items-center"
            >
              <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
              </svg>
              {t('header.share')}
            </button>
            <button
              onClick={() => setShowAbout(true)}
              className="px-3 py-2 text-sm font-medium text-muted-foreground bg-secondary rounded-lg hover:bg-border transition flex items-center"
            >
              <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {t('header.info')}
            </button>
          </div>

          {/* Mobile menu button */}
          <LanguageSwitcher className="lg:hidden ml-auto" />
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="lg:hidden p-2 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg transition"
            aria-label={t('header.openMenu')}
          >
            {mobileMenuOpen ? <CloseIcon className="w-6 h-6" /> : <MenuIcon className="w-6 h-6" />}
          </button>
        </div>

        {/* Mobile dropdown menu */}
        {mobileMenuOpen && (
          <div className="lg:hidden border-t border-border bg-card">
            {/* Mobile address search */}
            <div className="md:hidden px-3 py-2 border-b border-border">
              <AddressSearchInput
                municipalities={municipalities}
                onAddressSelected={(slug, coords, displayName) => {
                  handleAddressSelected(slug, coords, displayName);
                  setMobileMenuOpen(false);
                }}
              />
            </div>
            {/* Mobile menu items */}
            <div className="px-3 py-2 space-y-1">
              <button
                onClick={() => {
                  setNearestPointsOpen(true);
                  setMobileMenuOpen(false);
                }}
                className="w-full flex items-center px-3 py-3 text-sm font-medium text-muted-foreground hover:bg-secondary rounded-lg transition"
              >
                <svg className="w-5 h-5 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                {t('header.nearest')}
              </button>
              <a
                href="/data-export"
                className="flex items-center px-3 py-3 text-sm font-medium text-muted-foreground hover:bg-secondary rounded-lg transition"
              >
                <svg className="w-5 h-5 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                {t('header.data')}
              </a>
              <a
                href="/api/v1/docs"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center px-3 py-3 text-sm font-medium text-muted-foreground hover:bg-secondary rounded-lg transition"
              >
                <svg className="w-5 h-5 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                </svg>
                {t('header.apiDocs')}
              </a>
              <button
                onClick={() => {
                  setShowShare(true);
                  setMobileMenuOpen(false);
                }}
                className="w-full flex items-center px-3 py-3 text-sm font-medium text-muted-foreground hover:bg-secondary rounded-lg transition"
              >
                <svg className="w-5 h-5 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                </svg>
                {t('header.shareEmbed')}
              </button>
              <button
                onClick={() => {
                  setShowAbout(true);
                  setMobileMenuOpen(false);
                }}
                className="w-full flex items-center px-3 py-3 text-sm font-medium text-muted-foreground hover:bg-secondary rounded-lg transition"
              >
                <svg className="w-5 h-5 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {t('header.about')}
              </button>
            </div>
          </div>
        )}
      </header>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Mobile sidebar overlay */}
        {mobileSidebarOpen && (
          <div
            className="md:hidden fixed inset-0 bg-black/50 z-30"
            onClick={() => setMobileSidebarOpen(false)}
          />
        )}

        {/* Sidebar - desktop: always visible, mobile: slide-in drawer */}
        <aside
          className={`
            fixed md:relative inset-y-0 left-0 z-40 md:z-auto
            w-[85vw] max-w-[320px] md:w-80
            bg-muted p-3 md:p-4 overflow-y-auto space-y-3 md:space-y-4
            transform transition-transform duration-300 ease-in-out
            ${mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
            shadow-xl md:shadow-none
          `}
        >
          {/* Mobile sidebar header */}
          <div className="md:hidden flex items-center justify-between pb-2 border-b border-border mb-2">
            <h2 className="text-lg font-semibold text-foreground">{t('sidebar.title')}</h2>
            <button
              onClick={() => setMobileSidebarOpen(false)}
              className="p-2 text-subtle-foreground hover:text-muted-foreground hover:bg-border rounded-lg transition"
              aria-label={t('common.close')}
            >
              <CloseIcon className="w-5 h-5" />
            </button>
          </div>

          {data && (
            <>
              <StatsPanel data={data} filters={filters} residents={territoryResidents} />
              <FilterPanel
                filters={filters}
                onChange={setFilters}
                availableProviders={data.metadata.providers}
                providerCounts={providerCounts}
                providerResidents={providerResidents}
                categoryCounts={categoryCounts}
                serviceCounts={serviceCounts}
                sharedLocationCount={sharedLocationCount}
                boundariesLoading={boundariesLoading}
                boundaryLoadProgress={boundaryLoadProgress}
                totalPoints={data.metadata.total_points}
                nationalView={isNationalSlug(selectedMunicipality)}
              />
            </>
          )}
        </aside>

        {/* Map */}
        <main className="flex-1 relative">
          <MapView
            data={data}
            filters={filters}
            targetCoordinates={targetCoordinates}
            onZoomedToTarget={handleMapZoomedToTarget}
            searchLocationMarker={searchLocationMarker}
            highlightedPoints={highlightedPoints}
            onTilesLoading={setTilesLoading}
          />

          {/* Loading overlay on map - shown while fetching data or tiles loading */}
          {(loading || tilesLoading) && data && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-card/60 pointer-events-none">
              <div className="flex flex-col items-center gap-2">
                <svg className="animate-spin h-10 w-10 text-subtle-foreground" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <span className="text-sm font-medium text-subtle-foreground">{t('common.loading')}</span>
              </div>
            </div>
          )}

          {/* Mobile floating filter button */}
          <button
            onClick={() => setMobileSidebarOpen(true)}
            className="md:hidden fixed bottom-20 left-4 z-20 bg-primary text-white p-4 rounded-full shadow-lg hover:bg-primary/90 active:bg-primary/80 transition"
            aria-label={t('sidebar.openFilters')}
          >
            <FilterIcon className="w-6 h-6" />
            {data && (
              <span className="absolute -top-1 -right-1 bg-card text-primary text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center border-2 border-primary">
                {Object.keys(providerCounts).length}
              </span>
            )}
          </button>

          {/* Nearest Points Finder - right side panel */}
          <NearestPointsFinder
            isOpen={nearestPointsOpen}
            onClose={() => {
              // Only clear highlighting, keep marker visible for re-toggling
              setNearestPointsOpen(false);
              setHighlightedPoints(null);
            }}
            municipalities={municipalities}
            currentMunicipalityData={data}
            filters={filters}
            onMunicipalityChange={setSelectedMunicipality}
            onSearchLocationChange={setSearchLocationMarker}
            onHighlightedPointsChange={setHighlightedPoints}
            onPointSelect={(coords) => setTargetCoordinates(coords)}
            initialSearch={lastAddressSearch}
          />
        </main>
      </div>

      {/* Footer */}
      <footer className="bg-card border-t border-border px-3 md:px-4 py-2">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-1 sm:gap-0 text-xs text-subtle-foreground">
          <button
            onClick={() => setShowAbout(true)}
            className="text-primary hover:text-primary hover:underline focus:outline-none py-1"
          >
            {t('footer.sources')}
          </button>
          {data && (
            <p className="text-center sm:text-right">
              {t('footer.updated', { date: fmtDate(data.metadata.generated_at) })}
            </p>
          )}
        </div>
      </footer>

      {/* About Modal */}
      <AboutModal isOpen={showAbout} onClose={() => setShowAbout(false)} />

      {/* Share Modal */}
      <ShareModal
        isOpen={showShare}
        onClose={() => setShowShare(false)}
        municipality={selectedMunicipality}
        municipalityName={
          municipalities.find(m => m.slug === selectedMunicipality)?.name || selectedMunicipality
        }
      />
    </div>
  );
}
