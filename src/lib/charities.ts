// Charity search through Every.org (the `charities` Edge Function, which holds the API key): the app asks it to
// search, and to make a picked nonprofit a row in `charities` so challenges and donations can point at it.
// Search is "unavailable" whenever the function can't answer (no key yet, Every.org down, no connection); the
// charity step then offers Kept's curated picks only.

import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';

import { supabase } from './supabase';
import type { Choice } from './use-choices';

/** The function needs at least this many letters. */
export const SEARCH_MIN_LETTERS = 3;
/** A searched charity sorts after Kept's curated picks (same number the function writes). */
const SEARCHED_POSITION = 1000;

export type SearchedCharity = { ein: string; name: string; description: string; logoUrl: string | null; slug: string | null };
/** A search result as a picker tile; `ein` is what's picked with. */
export type SearchedChoice = Choice & { ein: string };

/** Nonprofits matching `term`, or 'unavailable'. */
export async function searchCharities(term: string): Promise<SearchedCharity[] | 'unavailable'> {
  try {
    const { data, error } = await supabase.functions.invoke('charities', { body: { action: 'search', term } });
    return !error && Array.isArray(data?.results) ? data.results : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

/** Makes the nonprofit a `charities` row (if it isn't one) and gives its id and name, or null on any failure. */
export async function pickCharity(ein: string): Promise<{ id: string; name: string } | null> {
  try {
    const { data, error } = await supabase.functions.invoke('charities', { body: { action: 'pick', ein } });
    return !error && typeof data?.id === 'string' && typeof data?.name === 'string' ? { id: data.id, name: data.name } : null;
  } catch {
    return null;
  }
}

/** A search result as a tile. Its id is the one its row will have (`ein-<EIN>`, as the function writes it). */
export function searchedChoice(c: SearchedCharity): SearchedChoice {
  return { id: `ein-${c.ein}`, ein: c.ein, name: c.name, detail: c.description, logoUrl: c.logoUrl, slug: c.slug, position: SEARCHED_POSITION };
}

/** The charity's page on Every.org (what it does, where it works, its own site), or null without a plain slug. */
export function charityPageUrl(slug: string | null | undefined): string | null {
  return slug && /^[A-Za-z0-9-]+$/.test(slug) ? `https://www.every.org/${slug}` : null;
}

/** Opens the charity's Every.org page in the in-app browser (a sheet over the app), so the user never leaves Kept. */
export async function openCharityPage(slug: string | null | undefined): Promise<void> {
  const url = charityPageUrl(slug);
  if (!url) return;
  await WebBrowser.openBrowserAsync(url, { presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET }).catch(() => {});
}

/** `value`, once it has stopped changing for `ms` (so a search isn't sent for every letter typed). */
export function useDebounced<T>(value: T, ms = 400): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}
