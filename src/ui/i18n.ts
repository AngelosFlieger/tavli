import { en } from './i18n/en';
import { el } from './i18n/el';
import type { Catalog, Locale, Params } from './i18n/types';

export type { Locale } from './i18n/types';

const storageKey = 'plakoto-locale';

const catalogs: Record<Locale, Catalog> = { en, el };
const fallback = en;

let current: Locale = 'en';

function interpolate(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (token, key: string) =>
    key in params ? String(params[key]) : token,
  );
}

export function setLocale(locale: Locale) {
  current = locale;
  try {
    localStorage.setItem(storageKey, locale);
  } catch {
    // Private mode or quota failures keep the in-memory choice.
  }
}

export function getLocale(): Locale {
  return current;
}

export function loadLocalePreference(): Locale {
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored === 'en' || stored === 'el') current = stored;
  } catch {
    // Keep the default.
  }
  return current;
}

export function t(key: string, params?: Params): string {
  const catalog = catalogs[current];
  return interpolate(catalog[key] ?? fallback[key] ?? key, params);
}

/** Count-aware helper for English plural suffixes; Greek translations choose their own wording. */
export function pluralSuffix(count: number): string {
  return count === 1 ? '' : 's';
}

/** Localizes static markup annotated with data-i18n attributes. */
export function translateDOM(root: ParentNode = document) {
  document.documentElement.lang = current;
  document.title = t('meta.title');
  root
    .querySelectorAll<HTMLElement>('[data-i18n]')
    .forEach((node) => (node.textContent = t(node.dataset.i18n!)));
  root
    .querySelectorAll<HTMLElement>('[data-i18n-title]')
    .forEach((node) => (node.title = t(node.dataset.i18nTitle!)));
  root
    .querySelectorAll<HTMLElement>('[data-i18n-aria]')
    .forEach((node) => node.setAttribute('aria-label', t(node.dataset.i18nAria!)));
  root
    .querySelectorAll<HTMLElement>('[data-i18n-placeholder]')
    .forEach((node) => node.setAttribute('placeholder', t(node.dataset.i18nPlaceholder!)));
}
