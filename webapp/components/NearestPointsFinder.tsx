'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Image from 'next/image';
import { CARRIER_BRAND, CARRIER_ORDER, CARRIER_SERIES_COLORS, carrierLabel } from '@/lib/carriers';
import {
  Municipality,
  PakketpuntData,
  PakketpuntFeature,
  PakketpuntProperties,
  Filters,
  getPointCategory,
} from '@/types/pakketpunten';
import { findNearestPoints, formatDistance, NearestPoint } from '@/utils/distanceUtils';
import { useI18n } from '@/lib/i18n';
import {
  DAY_KEYS,
  DayKey,
  dayKeyForDate,
  isOpenAt,
  minutesForDate,
  parseHHMM,
} from '@/utils/openingHoursUtils';

type TimeMode = 'all' | 'now' | 'custom';

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

function currentHHMM(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * Per-carrier drawing info, from the shared source in lib/carriers.
 *
 * The pin border keeps the real livery — a logo sits inside it. `color` is the
 * validated series colour because its only other use is the two-letter text
 * fallback shown when a logo fails to load, and several liveries (DHL, GLS
 * and La Poste yellow at 1.5:1) are unreadable as text on white.
 */
const PROVIDER_INFO: Record<string, { color: string; logoUrl: string; borderColor?: string }> =
  Object.fromEntries(
    CARRIER_ORDER.map((carrier) => [
      carrier,
      {
        color: CARRIER_SERIES_COLORS[carrier],
        logoUrl: CARRIER_BRAND[carrier].logoUrl,
        borderColor: CARRIER_BRAND[carrier].borderColor ?? CARRIER_BRAND[carrier].background,
      },
    ])
  );

interface SearchResult {
  id: string;
  displayName: string;
  type: string;
  municipality?: string;
  score: number;
}

interface NearestPointsFinderProps {
  isOpen: boolean;
  onClose: () => void;
  municipalities: Municipality[];
  currentMunicipalityData: PakketpuntData | null;
  filters: Filters;
  onMunicipalityChange: (slug: string) => void;
  onSearchLocationChange: (location: { latitude: number; longitude: number } | null) => void;
  onHighlightedPointsChange: (points: Set<string> | null) => void;
  onPointSelect: (coordinates: { latitude: number; longitude: number }) => void;
  initialSearch?: {
    coordinates: { latitude: number; longitude: number };
    displayName: string;
  } | null;
}

export default function NearestPointsFinder({
  isOpen,
  onClose,
  municipalities,
  currentMunicipalityData,
  filters,
  onMunicipalityChange,
  onSearchLocationChange,
  onHighlightedPointsChange,
  onPointSelect,
  initialSearch,
}: NearestPointsFinderProps) {
  const { t, tp, lang } = useI18n();
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const [searchLocation, setSearchLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [nearestPoints, setNearestPoints] = useState<NearestPoint[]>([]);
  const [pendingMunicipalitySlug, setPendingMunicipalitySlug] = useState<string | null>(null);
  const [timeMode, setTimeMode] = useState<TimeMode>('all');
  const [customDay, setCustomDay] = useState<DayKey>(() => dayKeyForDate(new Date()));
  const [customTime, setCustomTime] = useState<string>(() => currentHHMM(new Date()));
  // "Unknown" = include points whose hours can't be parsed or aren't published.
  const [includeUnknownHours, setIncludeUnknownHours] = useState<boolean>(true);
  // Counts of points filtered out at last evaluation, for footer messaging.
  const [excludedClosed, setExcludedClosed] = useState<number>(0);
  const [excludedUnknown, setExcludedUnknown] = useState<number>(0);
  const [isLocating, setIsLocating] = useState<boolean>(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const initialSearchUsedRef = useRef(false);

  // Handle initial search from main PDOK search bar when panel opens
  useEffect(() => {
    if (isOpen && initialSearch && !initialSearchUsedRef.current) {
      console.log('NearestPointsFinder: Using initial search from PDOK bar', initialSearch);
      // Set the query display
      setQuery(initialSearch.displayName);
      // Set the search location
      setSearchLocation(initialSearch.coordinates);
      onSearchLocationChange(initialSearch.coordinates);
      // Mark as used for this session so it doesn't re-trigger immediately
      initialSearchUsedRef.current = true;
      // Don't clear lastAddressSearch - keep it for re-toggling
    }
  }, [isOpen, initialSearch, onSearchLocationChange]);

  // Reset the ref when panel closes
  useEffect(() => {
    if (!isOpen) {
      initialSearchUsedRef.current = false;
    }
  }, [isOpen]);

  // Helper to check if point matches filters
  const matchesFilters = useCallback(
    (props: PakketpuntProperties): boolean => {
      // Provider filter
      if (!filters.providers.includes(props.vervoerder)) return false;

      // Category filter
      const category = getPointCategory(props.puntType);
      if (!filters.pointCategories.includes(category)) return false;

      // Service filter
      const wantsPickup = filters.serviceFilters.includes('pickup');
      const wantsDropoff = filters.serviceFilters.includes('dropoff');
      if (wantsPickup && wantsDropoff) {
        if (!props.canPickup && !props.canDropoff) return false;
      } else if (wantsPickup && !props.canPickup) {
        return false;
      } else if (wantsDropoff && !props.canDropoff) {
        return false;
      }

      return true;
    },
    [filters]
  );

  // Get filtered points from current municipality data
  const filteredPoints = useMemo(() => {
    if (!currentMunicipalityData) return [];
    return currentMunicipalityData.features.filter((f) => {
      if (f.properties.type !== 'pakketpunt') return false;
      return matchesFilters(f.properties as PakketpuntProperties);
    }) as PakketpuntFeature[];
  }, [currentMunicipalityData, matchesFilters]);

  // Resolve the (day, minute) used by the time filter.
  // For 'now', re-resolve at calc time so reopening the panel an hour later
  // works as expected.
  const resolveFilterTarget = useCallback((): { day: DayKey; minute: number } | null => {
    if (timeMode === 'all') return null;
    if (timeMode === 'now') {
      const now = new Date();
      return { day: dayKeyForDate(now), minute: minutesForDate(now) };
    }
    const minute = parseHHMM(customTime);
    if (minute == null) return null;
    return { day: customDay, minute };
  }, [timeMode, customDay, customTime]);

  // Calculate nearest points when search location or filtered points change
  // Limited to 500m max distance
  // Also re-runs when panel opens to re-apply highlighting
  useEffect(() => {
    // Only calculate when panel is open
    if (!isOpen) return;

    if (searchLocation && filteredPoints.length > 0) {
      const target = resolveFilterTarget();

      let candidates = filteredPoints;
      let droppedClosed = 0;
      let droppedUnknown = 0;
      if (target) {
        const kept: PakketpuntFeature[] = [];
        for (const f of filteredPoints) {
          const props = f.properties as PakketpuntProperties;
          const open = isOpenAt(props.openingstijden ?? null, target.day, target.minute);
          if (open === true) {
            kept.push(f);
          } else if (open === false) {
            droppedClosed += 1;
          } else if (includeUnknownHours) {
            kept.push(f);
          } else {
            droppedUnknown += 1;
          }
        }
        candidates = kept;
      }
      setExcludedClosed(droppedClosed);
      setExcludedUnknown(droppedUnknown);

      const nearest = findNearestPoints(searchLocation, candidates, 10, 500);
      setNearestPoints(nearest);

      // Create set of highlighted point keys
      const highlightedSet = new Set<string>();
      nearest.forEach((np) => {
        const props = np.feature.properties as PakketpuntProperties;
        highlightedSet.add(`${props.latitude.toFixed(6)},${props.longitude.toFixed(6)}`);
      });
      onHighlightedPointsChange(highlightedSet);
    } else {
      setNearestPoints([]);
      setExcludedClosed(0);
      setExcludedUnknown(0);
      onHighlightedPointsChange(null);
    }
  }, [
    isOpen,
    searchLocation,
    filteredPoints,
    onHighlightedPointsChange,
    resolveFilterTarget,
    includeUnknownHours,
  ]);

  // When municipality data loads after a pending switch, recalculate
  useEffect(() => {
    if (pendingMunicipalitySlug && currentMunicipalityData) {
      if (currentMunicipalityData.metadata.slug === pendingMunicipalitySlug) {
        setPendingMunicipalitySlug(null);
        // The useEffect above will recalculate nearest points
      }
    }
  }, [currentMunicipalityData, pendingMunicipalitySlug]);

  // Find municipality by PDOK name
  // The geocode API resolves the comune by point-in-polygon and returns its slug
  const findMunicipality = useCallback(
    (slug: string | null | undefined): Municipality | null =>
      (slug && municipalities.find((m) => m.slug === slug)) || null,
    [municipalities]
  );

  // Debounced search function
  const searchAddress = useCallback(async (searchQuery: string) => {
    if (searchQuery.length < 2) {
      setSearchResults([]);
      setShowDropdown(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/geocode?q=${encodeURIComponent(searchQuery)}&lang=${lang}`);
      if (!response.ok) throw new Error('Geocoding failed');

      const data = await response.json();
      setSearchResults(data.results || []);
      setShowDropdown(true);
      setSelectedIndex(-1);
    } catch (err) {
      console.error('Geocoding error:', err);
      setError(t('address.searchFailed'));
      setSearchResults([]);
      setShowDropdown(false);
    } finally {
      setIsLoading(false);
    }
  }, [lang, t]);

  // Handle input change with debouncing
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuery(value);

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      searchAddress(value);
    }, 300);
  };

  // Process search result and switch municipality
  const processSearchResult = async (result: SearchResult) => {
    setQuery(result.displayName);
    setShowDropdown(false);
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/geocode?id=${encodeURIComponent(result.id)}&name=${encodeURIComponent(result.displayName)}`);
      if (!response.ok) throw new Error('Address lookup failed');

      const details = await response.json();

      if (!details.coordinates) {
        setError(t('address.noCoordinates'));
        setIsLoading(false);
        return;
      }

      // Find and switch to the municipality
      const municipality = findMunicipality(details.municipalitySlug);
      if (!municipality) {
        setError(t('nearest.notCountry'));
        setIsLoading(false);
        return;
      }

      // Set search location and marker
      setSearchLocation(details.coordinates);
      onSearchLocationChange(details.coordinates);

      // Switch municipality if needed
      if (currentMunicipalityData?.metadata.slug !== municipality.slug) {
        setPendingMunicipalitySlug(municipality.slug);
        onMunicipalityChange(municipality.slug);
      }
    } catch (err) {
      console.error('Address lookup error:', err);
      setError(t('address.lookupFailed'));
    } finally {
      setIsLoading(false);
    }
  };

  // Use the device's current location (geolocation API + reverse geocode).
  const handleUseMyLocation = () => {
    if (typeof window === 'undefined' || !('geolocation' in navigator)) {
      setError(t('nearest.geoUnsupported'));
      return;
    }

    setError(null);
    setIsLocating(true);

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        try {
          const response = await fetch(
            `/api/geocode?lat=${latitude}&lon=${longitude}&lang=${lang}`
          );
          if (!response.ok) {
            throw new Error(`Reverse geocode failed: ${response.status}`);
          }
          const details = await response.json();

          const municipality = findMunicipality(details.municipalitySlug);
          if (!municipality) {
            setError(t('nearest.noCommuneHere'));
            setIsLocating(false);
            return;
          }

          const coords = details.coordinates || { latitude, longitude };
          setQuery(details.displayName || t('nearest.myLocation'));
          setShowDropdown(false);
          setSearchLocation(coords);
          onSearchLocationChange(coords);

          if (currentMunicipalityData?.metadata.slug !== municipality.slug) {
            setPendingMunicipalitySlug(municipality.slug);
            onMunicipalityChange(municipality.slug);
          }
        } catch (err) {
          console.error('Reverse geocode error:', err);
          setError(t('nearest.reverseFailed'));
        } finally {
          setIsLocating(false);
        }
      },
      (err) => {
        setIsLocating(false);
        if (err.code === err.PERMISSION_DENIED) {
          setError(t('nearest.denied'));
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          setError(t('nearest.unavailable'));
        } else if (err.code === err.TIMEOUT) {
          setError(t('nearest.timeout'));
        } else {
          setError(t('nearest.locateFailed'));
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  };

  // Handle direct search (Enter without dropdown selection)
  const handleDirectSearch = async () => {
    if (query.length < 2) return;

    setIsLoading(true);
    setError(null);
    setShowDropdown(false);

    try {
      const suggestResponse = await fetch(`/api/geocode?q=${encodeURIComponent(query)}&lang=${lang}`);
      if (!suggestResponse.ok) throw new Error('Geocoding failed');

      const suggestData = await suggestResponse.json();
      const results = suggestData.results || [];

      if (results.length === 0) {
        setError(t('nearest.noResults'));
        setIsLoading(false);
        return;
      }

      // Auto-select first result
      await processSearchResult(results[0]);
    } catch (err) {
      console.error('Direct search error:', err);
      setError(t('address.searchFailed'));
      setIsLoading(false);
    }
  };

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (showDropdown && selectedIndex >= 0 && selectedIndex < searchResults.length) {
        processSearchResult(searchResults[selectedIndex]);
      } else {
        handleDirectSearch();
      }
      return;
    }

    if (!showDropdown || searchResults.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex((prev) => (prev < searchResults.length - 1 ? prev + 1 : prev));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : -1));
        break;
      case 'Escape':
        setShowDropdown(false);
        setSelectedIndex(-1);
        break;
    }
  };

  // Handle clicking on a result row
  const handlePointClick = (point: NearestPoint) => {
    const props = point.feature.properties as PakketpuntProperties;
    onPointSelect({ latitude: props.latitude, longitude: props.longitude });
  };

  // Clear search
  const handleClear = () => {
    setQuery('');
    setSearchResults([]);
    setShowDropdown(false);
    setError(null);
    setSearchLocation(null);
    setNearestPoints([]);
    onSearchLocationChange(null);
    onHighlightedPointsChange(null);
    inputRef.current?.focus();
  };

  // Click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(event.target as Node)
      ) {
        setShowDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  if (!isOpen) return null;

  return (
    <div className="fixed right-4 top-20 z-30 w-80 max-h-[calc(100vh-120px)] bg-card rounded-lg shadow-xl border border-border flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 bg-muted border-b border-border flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
          <span className="font-medium text-foreground text-sm">{t('nearest.title')}</span>
        </div>
        <button
          onClick={onClose}
          aria-label={t('common.close')}
          className="p-1 text-subtle-foreground hover:text-muted-foreground transition"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="p-4 flex-1 overflow-y-auto">
        {/* Search input */}
        <div className="relative">
          <div className="relative">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={t('nearest.placeholder')}
              className="w-full px-3 py-2.5 pr-10 border border-input rounded-lg focus:ring-2 focus:ring-ring focus:border-transparent text-foreground text-sm"
            />
            {isLoading && (
              <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                <svg className="animate-spin h-4 w-4 text-subtle-foreground" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              </div>
            )}
            {!isLoading && query && (
              <button
                onClick={handleClear}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-subtle-foreground hover:text-muted-foreground"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          {/* Use my location */}
          <button
            type="button"
            onClick={handleUseMyLocation}
            disabled={isLocating}
            className="mt-2 w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-primary bg-accent border border-primary/30 rounded-md hover:bg-accent disabled:opacity-60 disabled:cursor-not-allowed transition"
          >
            {isLocating ? (
              <svg className="animate-spin h-3.5 w-3.5" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 11a3 3 0 100-6 3 3 0 000 6z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 22s8-6.5 8-13a8 8 0 10-16 0c0 6.5 8 13 8 13z" />
              </svg>
            )}
            {isLocating ? t('nearest.locating') : t('nearest.useMyLocation')}
          </button>

          {/* Error message */}
          {error && <div className="mt-2 text-xs text-destructive">{error}</div>}

          {/* Dropdown results */}
          {showDropdown && searchResults.length > 0 && (
            <div
              ref={dropdownRef}
              className="absolute z-50 w-full mt-1 bg-card border border-input rounded-lg shadow-lg max-h-48 overflow-y-auto"
            >
              {searchResults.map((result, index) => (
                <button
                  key={result.id}
                  onClick={() => processSearchResult(result)}
                  className={`w-full px-3 py-2 text-left hover:bg-accent transition ${
                    index === selectedIndex ? 'bg-accent' : ''
                  } ${index !== searchResults.length - 1 ? 'border-b border-border' : ''}`}
                >
                  <div className="text-sm text-foreground truncate">{result.displayName}</div>
                  {result.municipality && (
                    <div className="text-xs text-subtle-foreground">{result.municipality}</div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Time filter */}
        <div className="mt-3 pt-3 border-t border-border">
          <div className="text-xs font-medium text-muted-foreground mb-1.5">{t('nearest.hours')}</div>
          <div className="flex gap-1">
            {([
              { mode: 'all', label: t('nearest.all') },
              { mode: 'now', label: t('nearest.openNow') },
              { mode: 'custom', label: t('nearest.atTime') },
            ] as { mode: TimeMode; label: string }[]).map(({ mode, label }) => (
              <button
                key={mode}
                onClick={() => setTimeMode(mode)}
                className={`flex-1 px-2 py-1 text-xs rounded-md border transition ${
                  timeMode === mode
                    ? 'bg-primary text-white border-primary'
                    : 'bg-card text-muted-foreground border-input hover:bg-muted'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {timeMode === 'custom' && (
            <div className="mt-2 flex gap-2">
              <select
                value={customDay}
                onChange={(e) => setCustomDay(e.target.value as DayKey)}
                className="flex-1 px-2 py-1.5 text-xs border border-input rounded-md bg-card text-foreground focus:ring-2 focus:ring-ring focus:border-transparent"
              >
                {DAY_KEYS.map((d) => (
                  <option key={d} value={d}>
                    {t(`day.${d}`)}
                  </option>
                ))}
              </select>
              <input
                type="time"
                value={customTime}
                onChange={(e) => setCustomTime(e.target.value)}
                className="w-24 px-2 py-1.5 text-xs border border-input rounded-md bg-card text-foreground focus:ring-2 focus:ring-ring focus:border-transparent"
              />
            </div>
          )}

          {timeMode !== 'all' && (
            <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={includeUnknownHours}
                onChange={(e) => setIncludeUnknownHours(e.target.checked)}
                className="rounded text-primary focus:ring-ring"
              />
              {t('nearest.includeUnknown')}
            </label>
          )}
        </div>

        {/* No results within 500m */}
        {searchLocation && !pendingMunicipalitySlug && nearestPoints.length === 0 && (
          <div className="mt-4 text-sm text-subtle-foreground text-center py-4">
            <svg className="w-8 h-8 mx-auto mb-2 text-subtle-foreground/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {timeMode === 'all' ? t('nearest.none') : t('nearest.noneOpen')}
            {(excludedClosed > 0 || excludedUnknown > 0) && (
              <div className="mt-1 text-xs text-subtle-foreground">
                {excludedClosed > 0 && tp('nearest.closed', excludedClosed)}
                {excludedClosed > 0 && excludedUnknown > 0 && ' · '}
                {excludedUnknown > 0 && t('nearest.noHours', { count: excludedUnknown })}
              </div>
            )}
          </div>
        )}

        {/* Results list */}
        {searchLocation && nearestPoints.length > 0 && (
          <div className="mt-4 space-y-1">
            <div className="text-xs text-subtle-foreground mb-2 flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              {tp('nearest.within', nearestPoints.length)}
              {timeMode === 'now' && t('nearest.openNowSuffix')}
              {timeMode === 'custom' && t('nearest.openAtSuffix', { day: t(`day.${customDay}`).toLowerCase(), time: customTime })}
            </div>
            {timeMode !== 'all' && (excludedClosed > 0 || excludedUnknown > 0) && (
              <div className="text-[11px] text-subtle-foreground mb-2 -mt-1">
                {excludedClosed > 0 && tp('nearest.closed', excludedClosed)}
                {excludedClosed > 0 && excludedUnknown > 0 && ' · '}
                {excludedUnknown > 0 && t('nearest.noHoursExcluded', { count: excludedUnknown })}
              </div>
            )}
            {nearestPoints.map((point, index) => {
              const props = point.feature.properties as PakketpuntProperties;
              const providerInfo = PROVIDER_INFO[props.vervoerder] || { color: '#666', logoUrl: '' };

              return (
                <button
                  key={`${props.vervoerder}-${props.latitude}-${props.longitude}-${index}`}
                  onClick={() => handlePointClick(point)}
                  className="w-full text-left p-2 rounded-lg hover:bg-accent transition group border border-transparent hover:border-primary/30"
                >
                  <div className="flex items-start gap-2">
                    {/* Rank number */}
                    <div className="flex-shrink-0 w-5 h-5 rounded-full bg-primary flex items-center justify-center text-xs font-bold text-white">
                      {index + 1}
                    </div>

                    {/* Provider logo */}
                    <div
                      className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center bg-card border-2 overflow-hidden"
                      style={{ borderColor: providerInfo.borderColor || providerInfo.color }}
                      title={carrierLabel(props.vervoerder)}
                    >
{providerInfo.logoUrl ? (
                        <Image
                          src={providerInfo.logoUrl}
                          alt={props.vervoerder}
                          width={16}
                          height={16}
                          className="object-contain"
                        />
                      ) : (
                        <span className="text-[7px] font-bold" style={{ color: providerInfo.color }}>
                          {(CARRIER_BRAND[props.vervoerder as keyof typeof CARRIER_BRAND]?.initials || props.vervoerder.substring(0, 2)).toUpperCase()}
                        </span>
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-foreground truncate group-hover:text-primary">
                        {props.locatieNaam}
                      </div>
                      <div className="text-xs text-subtle-foreground truncate">
                        {props.straatNaam} {props.straatNr}
                      </div>
                    </div>

                    {/* Distance badge */}
                    <div className="flex-shrink-0">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-accent text-primary">
                        {formatDistance(point.distance)}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Loading state while waiting for municipality data */}
        {searchLocation && pendingMunicipalitySlug && (
          <div className="mt-4 text-sm text-subtle-foreground text-center py-4">
            <svg className="animate-spin h-5 w-5 mx-auto mb-2 text-primary" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            {t('map.loadingArea')}
          </div>
        )}

        {/* Helper text */}
        {!searchLocation && !query && (
          <div className="mt-3 text-xs text-subtle-foreground">
            {t('nearest.help')}
          </div>
        )}
      </div>
    </div>
  );
}
