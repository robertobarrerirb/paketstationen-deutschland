'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Municipality } from '@/types/pakketpunten';
import { useI18n } from '@/lib/i18n';

interface SearchResult {
  id: string;
  displayName: string;
  type: string;
  municipality?: string;
  score: number;
}

interface AddressDetails {
  id: string;
  displayName: string;
  municipality: string | null;
  municipalitySlug: string | null;
  street?: string;
  houseNumber?: string;
  postalCode?: string;
  city?: string;
  coordinates: {
    latitude: number;
    longitude: number;
  } | null;
}

interface AddressSearchInputProps {
  municipalities: Municipality[];
  onAddressSelected: (
    municipalitySlug: string,
    coordinates: { latitude: number; longitude: number },
    displayName: string
  ) => void;
}

export default function AddressSearchInput({
  municipalities,
  onAddressSelected,
}: AddressSearchInputProps) {
  const { t, lang } = useI18n();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Debounced search function
  const searchAddress = useCallback(async (searchQuery: string) => {
    if (searchQuery.length < 3) {
      setResults([]);
      setShowDropdown(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/geocode?q=${encodeURIComponent(searchQuery)}&lang=${lang}`
      );

      if (!response.ok) {
        throw new Error('Geocoding failed');
      }

      const data = await response.json();
      setResults(data.results || []);
      setShowDropdown(true);
      setSelectedIndex(-1);
    } catch (err) {
      console.error('Geocoding error:', err);
      setError(t('address.searchFailed'));
      setResults([]);
      setShowDropdown(false);
    } finally {
      setIsLoading(false);
    }
  }, [lang, t]);

  // Handle input change with debouncing
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuery(value);

    // Clear previous timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // Set new timeout (300ms debounce)
    timeoutRef.current = setTimeout(() => {
      searchAddress(value);
    }, 300);
  };

  // Handle result selection
  const handleSelectResult = async (result: SearchResult) => {
    setQuery(result.displayName);
    setShowDropdown(false);
    setIsLoading(true);
    setError(null);

    try {
      // Lookup full details for the selected address
      const response = await fetch(`/api/geocode?id=${encodeURIComponent(result.id)}&name=${encodeURIComponent(result.displayName)}`);

      if (!response.ok) {
        throw new Error('Address lookup failed');
      }

      const details: AddressDetails = await response.json();

      if (!details.coordinates) {
        setError(t('address.noCoordinates'));
        setIsLoading(false);
        return;
      }

      // The API resolves the commune by point-in-polygon, so the slug is exact
      const municipality = details.municipalitySlug
        ? municipalities.find((m) => m.slug === details.municipalitySlug)
        : undefined;

      if (!municipality) {
        setError(t('address.notInCountry'));
        setIsLoading(false);
        return;
      }

      // Notify parent component
      onAddressSelected(municipality.slug, details.coordinates, details.displayName);
    } catch (err) {
      console.error('Address lookup error:', err);
      setError(t('address.lookupFailed'));
    } finally {
      setIsLoading(false);
    }
  };

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showDropdown || results.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev < results.length - 1 ? prev + 1 : prev
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : -1));
        break;
      case 'Enter':
        e.preventDefault();
        if (selectedIndex >= 0 && selectedIndex < results.length) {
          handleSelectResult(results[selectedIndex]);
        }
        break;
      case 'Escape':
        setShowDropdown(false);
        setSelectedIndex(-1);
        break;
    }
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
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return (
    <div className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder={t('address.placeholder')}
          className="w-full px-3 md:px-4 py-2.5 md:py-2 pr-10 border border-input rounded-lg focus:ring-2 focus:ring-ring focus:border-transparent text-foreground text-sm"
        />
        {isLoading && (
          <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
            <svg
              className="animate-spin h-5 w-5 text-subtle-foreground"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              ></circle>
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              ></path>
            </svg>
          </div>
        )}
        {!isLoading && query && (
          <button
            onClick={() => {
              setQuery('');
              setResults([]);
              setShowDropdown(false);
              setError(null);
              inputRef.current?.focus();
            }}
            className="absolute right-3 top-1/2 transform -translate-y-1/2 text-subtle-foreground hover:text-muted-foreground"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        )}
      </div>

      {/* Error message */}
      {error && (
        <div className="mt-2 text-sm text-destructive">{error}</div>
      )}

      {/* Dropdown results */}
      {showDropdown && results.length > 0 && (
        <div
          ref={dropdownRef}
          className="absolute z-50 w-full mt-1 bg-card border border-input rounded-lg shadow-lg max-h-[50vh] md:max-h-96 overflow-y-auto"
        >
          {results.map((result, index) => (
            <button
              key={result.id}
              onClick={() => handleSelectResult(result)}
              className={`w-full px-3 md:px-4 py-3 text-left hover:bg-accent active:bg-accent transition ${
                index === selectedIndex ? 'bg-accent' : ''
              } ${index !== results.length - 1 ? 'border-b border-border' : ''}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-foreground truncate">
                    {result.displayName}
                  </div>
                  {result.municipality && (
                    <div className="text-xs text-subtle-foreground mt-0.5 truncate">
                      {result.municipality}
                    </div>
                  )}
                </div>
                <div className="flex-shrink-0">
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-secondary text-foreground">
                    {result.type === 'house' ? t('address.type.house') :
                     result.type === 'street' ? t('address.type.street') :
                     result.type === 'city' || result.type === 'town' || result.type === 'village' ? t('address.type.city') :
                     result.type === 'district' || result.type === 'locality' ? t('address.type.district') : t('address.type.other')}
                  </span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* No results message */}
      {showDropdown && !isLoading && query.length >= 3 && results.length === 0 && (
        <div
          ref={dropdownRef}
          className="absolute z-50 w-full mt-1 bg-card border border-input rounded-lg shadow-lg px-3 md:px-4 py-3"
        >
          <div className="text-sm text-subtle-foreground">
            {t('address.noResults', { query })}
          </div>
        </div>
      )}
    </div>
  );
}
