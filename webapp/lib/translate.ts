/**
 * Pure translation helpers, usable on the server (API routes) and the client.
 * The React side (provider, hook, switcher) is in lib/i18n.tsx.
 */
import { de, type MessageKey } from './messages/de';
import { it } from './messages/it';
import { en } from './messages/en';

export type { MessageKey };
export type Lang = 'de' | 'it' | 'en';
export const LANGS: Lang[] = ['de', 'it', 'en'];
export const LANG_LABELS: Record<Lang, string> = { de: 'Deutsch', it: 'Italiano', en: 'English' };
export const LOCALES: Record<Lang, string> = { de: 'de-DE', it: 'it-IT', en: 'en-GB' };
export const DEFAULT_LANG: Lang = 'de';

const DICTIONARIES: Record<Lang, Record<MessageKey, string>> = { de, it, en };

export type Vars = Record<string, string | number>;

export function isLang(value: string | null | undefined): value is Lang {
  return !!value && (LANGS as string[]).includes(value);
}

function interpolate(text: string, vars?: Vars, locale?: string): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, name) => {
    const value = vars[name];
    if (value === undefined) return match;
    return typeof value === 'number' ? value.toLocaleString(locale) : value;
  });
}

export function translate(lang: Lang, key: MessageKey | string, vars?: Vars): string {
  const k = key as MessageKey;
  return interpolate(DICTIONARIES[lang][k] ?? de[k] ?? key, vars, LOCALES[lang]);
}

export function translatePlural(lang: Lang, base: string, count: number, vars?: Vars): string {
  const rule = new Intl.PluralRules(LOCALES[lang]).select(count) === 'one' ? 'one' : 'other';
  return translate(lang, `${base}_${rule}`, { count, ...vars });
}
