'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import { Municipality } from '@/types/pakketpunten';
import { NATIONAL_SLUG } from '@/lib/territory';
import { useI18n } from '@/lib/i18n';

// Rendering all ~10,800 Gemeinden as buttons makes the dropdown sluggish; past
// this many matches the list asks the reader to keep typing.
const MAX_VISIBLE = 250;

// Lowercase, accents stripped, hyphens and apostrophes as spaces:
// 'saint etienne' finds 'Saint-Étienne'
function fold(text: string): string {
  return text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[-'’]/g, ' ').toLowerCase();
}

interface MunicipalitySelectorProps {
  municipalities: Municipality[];
  selected: string;
  onChange: (slug: string) => void;
}

type SortOrder = 'asc' | 'desc';

export default function MunicipalitySelector({
  municipalities,
  selected,
  onChange,
}: MunicipalitySelectorProps) {
  const { t, tp, fmt } = useI18n();
  const [searchTerm, setSearchTerm] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Get selected municipality display name
  const selectedMunicipality = municipalities.find(m => m.slug === selected);
  const displayValue = selectedMunicipality
    ? selectedMunicipality.kind === 'commune'
      ? `${selectedMunicipality.name} · ${selectedMunicipality.department} (${selectedMunicipality.department_code})`
      : selectedMunicipality.name
    : '';

  // Germany separately (always shown as sticky footer)
  const nederland = useMemo(() =>
    municipalities.find(m => m.slug === NATIONAL_SLUG),
    [municipalities]
  );

  // Régions first, then Kreise, then communes; filtered by name,
  // Kreis (name or code) or Land
  const { filteredMunicipalities, totalMatches } = useMemo(() => {
    let filtered = municipalities.filter(m => m.slug !== NATIONAL_SLUG);

    if (searchTerm) {
      const term = fold(searchTerm.trim());
      filtered = filtered.filter(m =>
        fold(m.name).includes(term) ||
        (m.department ? fold(m.department).includes(term) : false) ||
        (m.department_code ? m.department_code.toLowerCase() === term : false) ||
        (m.region ? fold(m.region).includes(term) : false)
      );
    }

    const rank = (m: Municipality) => (m.kind === 'region' ? 0 : m.kind === 'department' ? 1 : 2);
    filtered = [...filtered].sort((a, b) => {
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      // Names that start with the term first: 'Bonn' before 'Königswinter-Bonn'
      if (searchTerm) {
        const term = fold(searchTerm.trim());
        const sa = fold(a.name).startsWith(term) ? 0 : 1;
        const sb = fold(b.name).startsWith(term) ? 0 : 1;
        if (sa !== sb) return sa - sb;
      }
      return sortOrder === 'asc'
        ? a.name.localeCompare(b.name, 'de')
        : b.name.localeCompare(a.name, 'de');
    });

    return { filteredMunicipalities: filtered.slice(0, MAX_VISIBLE), totalMatches: filtered.length };
  }, [municipalities, searchTerm, sortOrder]);

  // Reset highlighted index when search term or dropdown visibility changes
  useEffect(() => {
    setHighlightedIndex(-1);
  }, [searchTerm, showDropdown]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightedIndex >= 0 && dropdownRef.current) {
      const highlightedElement = dropdownRef.current.querySelector(
        `[data-index="${highlightedIndex}"]`
      );
      if (highlightedElement) {
        highlightedElement.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }, [highlightedIndex]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
        setSearchTerm('');
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Global keyboard shortcut (Cmd/Ctrl + K) to focus search
  useEffect(() => {
    const handleGlobalKeydown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setShowDropdown(true);
      }
    };

    document.addEventListener('keydown', handleGlobalKeydown);
    return () => document.removeEventListener('keydown', handleGlobalKeydown);
  }, []);

  const handleSelect = (slug: string) => {
    onChange(slug);
    setShowDropdown(false);
    setSearchTerm('');
    setHighlightedIndex(-1);
  };

  const toggleSort = () => {
    setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
  };

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showDropdown) {
      // Open dropdown on ArrowDown when closed
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setShowDropdown(true);
      }
      return;
    }

    // Total items including sticky Germany
    const totalItems = filteredMunicipalities.length + (nederland ? 1 : 0);

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex(prev =>
          prev < totalItems - 1 ? prev + 1 : prev
        );
        break;

      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex(prev => (prev > 0 ? prev - 1 : -1));
        break;

      case 'Enter':
        e.preventDefault();
        if (highlightedIndex >= 0 && highlightedIndex < filteredMunicipalities.length) {
          handleSelect(filteredMunicipalities[highlightedIndex].slug);
        } else if (highlightedIndex === filteredMunicipalities.length && nederland) {
          // Germany is selected (sticky footer)
          handleSelect(nederland.slug);
        } else if (filteredMunicipalities.length === 1) {
          // Auto-select if only one result
          handleSelect(filteredMunicipalities[0].slug);
        }
        break;

      case 'Escape':
        e.preventDefault();
        setShowDropdown(false);
        setSearchTerm('');
        setHighlightedIndex(-1);
        inputRef.current?.blur();
        break;

      case 'Tab':
        // Close dropdown on Tab
        setShowDropdown(false);
        setSearchTerm('');
        setHighlightedIndex(-1);
        break;
    }
  };

  return (
    <div className="relative" ref={containerRef}>
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          id="municipality"
          value={showDropdown ? searchTerm : displayValue}
          onChange={(e) => {
            setSearchTerm(e.target.value);
            setShowDropdown(true);
          }}
          onFocus={() => setShowDropdown(true)}
          onKeyDown={handleKeyDown}
          placeholder={selectedMunicipality ? displayValue : t('selector.placeholder')}
          className="w-full px-3 md:px-4 py-2.5 md:py-2 pr-10 border border-input rounded-lg focus:ring-2 focus:ring-ring focus:border-transparent text-foreground text-sm"
          autoComplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showDropdown}
          aria-controls="municipality-listbox"
          aria-activedescendant={
            highlightedIndex >= 0 ? `municipality-option-${highlightedIndex}` : undefined
          }
        />
        <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
          <svg className="w-4 h-4 text-subtle-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>

        {showDropdown && (
          <div
            ref={dropdownRef}
            id="municipality-listbox"
            role="listbox"
            className="absolute z-50 w-full mt-1 bg-card border border-input rounded-lg shadow-lg max-h-[60vh] md:max-h-96 overflow-y-auto"
          >
            {/* Header */}
            <div className="sticky top-0 bg-muted px-3 py-2 text-xs text-subtle-foreground border-b flex items-center justify-between z-10">
              <span>{tp('selector.results', totalMatches)}{totalMatches > filteredMunicipalities.length ? t('selector.firstN', { n: fmt(filteredMunicipalities.length) }) : ''}</span>
              <div className="flex items-center gap-2">
                <kbd className="hidden md:inline-block px-1.5 py-0.5 text-xs font-mono bg-card border border-input rounded">
                  ⌘K
                </kbd>
                <button
                  onClick={toggleSort}
                  className="text-primary hover:text-primary flex items-center gap-1 p-1 -m-1"
                  title={sortOrder === 'asc' ? t('selector.sortZA') : t('selector.sortAZ')}
                  tabIndex={-1}
                >
                  {sortOrder === 'asc' ? 'A-Z' : 'Z-A'}
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={sortOrder === 'asc' ? "M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" : "M3 4h13M3 8h9m-9 4h9m5-4v12m0 0l-4-4m4 4l4-4"} />
                  </svg>
                </button>
              </div>
            </div>

            {/* Municipality list */}
            {filteredMunicipalities.length > 0 ? (
              filteredMunicipalities.map((m, index) => (
                <button
                  key={m.slug}
                  id={`municipality-option-${index}`}
                  role="option"
                  aria-selected={m.slug === selected}
                  data-index={index}
                  onClick={() => handleSelect(m.slug)}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  className={`w-full text-left px-3 md:px-4 py-3 md:py-2 transition-colors ${
                    index === highlightedIndex
                      ? 'bg-accent'
                      : m.slug === selected
                      ? 'bg-accent'
                      : 'hover:bg-muted active:bg-secondary'
                  }`}
                  tabIndex={-1}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium text-foreground">{m.name}</div>
                      <div className="text-xs text-subtle-foreground">
                        {m.kind === 'region'
                          ? t('selector.regionOverview')
                          : m.kind === 'department'
                          ? t('selector.departmentOverview', { code: m.department_code ?? '', region: m.region ?? '' })
                          : `${m.department} (${m.department_code})${m.region ? ` · ${m.region}` : ''}`}
                      </div>
                    </div>
                    {m.slug === selected && (
                      <svg className="w-4 h-4 text-primary flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                  </div>
                </button>
              ))
            ) : (
              <div className="px-4 py-6 md:py-8 text-center text-sm text-subtle-foreground">
                {t('selector.noneFound', { term: searchTerm })}
              </div>
            )}

            {totalMatches > filteredMunicipalities.length && (
              <div className="px-4 py-2 text-center text-xs text-subtle-foreground border-t border-border">
                {t('selector.keepTyping')}
              </div>
            )}

            {/* Sticky Germany footer */}
            {nederland && (
              <div className="sticky bottom-0 border-t border-border bg-card shadow-[0_-2px_4px_rgba(0,0,0,0.05)]">
                <button
                  id={`municipality-option-national`}
                  role="option"
                  aria-selected={nederland.slug === selected}
                  data-index={filteredMunicipalities.length}
                  onClick={() => handleSelect(nederland.slug)}
                  onMouseEnter={() => setHighlightedIndex(filteredMunicipalities.length)}
                  className={`w-full text-left px-3 md:px-4 py-3 md:py-2 transition-colors ${
                    highlightedIndex === filteredMunicipalities.length
                      ? 'bg-accent'
                      : nederland.slug === selected
                      ? 'bg-accent'
                      : 'hover:bg-muted active:bg-secondary'
                  }`}
                  tabIndex={-1}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium text-foreground">{nederland.name}</div>
                      <div className="text-xs text-subtle-foreground">{t('selector.nationalOverview')}</div>
                    </div>
                    {nederland.slug === selected && (
                      <svg className="w-4 h-4 text-primary flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                  </div>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
