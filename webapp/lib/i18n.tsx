'use client';

/**
 * Interface language: German (default), Italian, English.
 *
 * The choice comes from ?lang= in the URL, else the viewer's last choice
 * (localStorage), else the browser language, else German. Every UI string
 * lives in lib/messages/<lang>.ts; the German file defines the keys and the
 * other two are typed against it, so a missing translation fails the build.
 *
 *   const { t, tp, lang, setLang, fmt } = useI18n();
 *   t('filters.title')                         → "Filter"
 *   t('share.directLink', { name: 'Köln' })    → "Direkter Link zu Köln"  ({name} placeholders)
 *   tp('stats.communes', 3)                    → "3 communes"   (_one / _other keys)
 *   fmt(12345)                                 → "12 345"       (locale number format)
 *
 * Server code (API routes) uses translate() from lib/translate.ts.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  DEFAULT_LANG, LANGS, LANG_LABELS, LOCALES, isLang, translate, translatePlural,
  type Lang, type MessageKey, type Vars,
} from './translate';

export { LANGS, LANG_LABELS, LOCALES, translate, translatePlural };
export type { Lang, Vars };
const STORAGE_KEY = 'lang';

function initialLang(): Lang {
  if (typeof window === 'undefined') return DEFAULT_LANG;
  const fromUrl = new URLSearchParams(window.location.search).get('lang');
  if (isLang(fromUrl)) return fromUrl;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isLang(stored)) return stored;
  } catch {
    /* storage blocked: fall through */
  }
  const browser = (navigator.language || '').slice(0, 2).toLowerCase();
  return isLang(browser) ? browser : DEFAULT_LANG;
}

interface I18nValue {
  lang: Lang;
  locale: string;
  setLang: (lang: Lang) => void;
  /** Keys are checked against lib/messages/de.ts when written literally. */
  t: (key: MessageKey | `${string}.${string}`, vars?: Vars) => string;
  tp: (base: string, count: number, vars?: Vars) => string;
  fmt: (value: number, options?: Intl.NumberFormatOptions) => string;
  fmtDate: (value: string | number | Date, options?: Intl.DateTimeFormatOptions) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  // German on the server and on the first client render (no hydration
  // mismatch); the viewer's language is applied right after mount.
  const [lang, setLangState] = useState<Lang>(DEFAULT_LANG);

  useEffect(() => {
    const chosen = initialLang();
    // Deliberate: the server cannot know the viewer's language, so it renders
    // German and the choice is applied once, right after hydration
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (chosen !== DEFAULT_LANG) setLangState(chosen);
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage blocked: the choice lasts for this page only */
    }
    // Keep ?lang= in the URL when it is there, so a shared link keeps the language
    const url = new URL(window.location.href);
    if (url.searchParams.has('lang')) {
      url.searchParams.set('lang', next);
      window.history.replaceState(null, '', url.toString());
    }
  }, []);

  const value = useMemo<I18nValue>(() => {
    const locale = LOCALES[lang];
    return {
      lang,
      locale,
      setLang,
      t: (key, vars) => translate(lang, key, vars),
      tp: (base, count, vars) => translatePlural(lang, base, count, vars),
      fmt: (value, options) => value.toLocaleString(locale, options),
      fmtDate: (value, options) =>
        new Date(value).toLocaleDateString(locale, options ?? { day: 'numeric', month: 'long', year: 'numeric' }),
    };
  }, [lang, setLang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside <LanguageProvider>');
  return value;
}

/** Compact FR / IT / EN switcher. */
export function LanguageSwitcher({ className = '' }: { className?: string }) {
  const { lang, setLang, t } = useI18n();
  return (
    <div role="group" aria-label={t('lang.label')} className={`inline-flex rounded-md border border-gray-200 bg-white/90 p-0.5 text-xs ${className}`}>
      {LANGS.map((code) => (
        <button
          key={code}
          type="button"
          onClick={() => setLang(code)}
          aria-pressed={lang === code}
          title={LANG_LABELS[code]}
          className={`rounded px-1.5 py-0.5 font-semibold uppercase transition-colors ${
            lang === code ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          {code}
        </button>
      ))}
    </div>
  );
}
