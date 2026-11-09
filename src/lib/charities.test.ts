// Unit tests for charities.ts: the app's side of Every.org charity search (the `charities` Edge Function).

import * as WebBrowser from 'expo-web-browser';

import { charityPageUrl, openCharityPage, pickCharity, searchCharities, searchedChoice, SEARCH_MIN_LETTERS } from './charities';
import { supabase } from './supabase';

jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn().mockResolvedValue({ type: 'cancel' }), WebBrowserPresentationStyle: { PAGE_SHEET: 'pageSheet' } }));
jest.mock('./supabase', () => ({ supabase: { functions: { invoke: jest.fn() } } }));

const invoke = jest.mocked(supabase.functions.invoke);
beforeEach(() => invoke.mockReset());

const aspca = { ein: '131623829', name: 'ASPCA', description: 'Rescues animals.', logoUrl: 'https://res.cloudinary.com/x/aspca.png', slug: 'aspca' };

describe('searchCharities', () => {
  it('asks the function for the term and gives back its results', async () => {
    invoke.mockResolvedValueOnce({ data: { results: [aspca] }, error: null });
    expect(await searchCharities('pets')).toEqual([aspca]);
    expect(invoke).toHaveBeenCalledWith('charities', { body: { action: 'search', term: 'pets' } });
  });

  it('gives an empty list, not "unavailable", when nothing matches', async () => {
    invoke.mockResolvedValueOnce({ data: { results: [] }, error: null });
    expect(await searchCharities('zzzzzz')).toEqual([]);
  });

  it('says "unavailable" when the function fails (no key yet, Every.org down, offline)', async () => {
    invoke.mockResolvedValueOnce({ data: null, error: new Error('503') });
    expect(await searchCharities('pets')).toBe('unavailable');
    invoke.mockRejectedValueOnce(new Error('network'));
    expect(await searchCharities('pets')).toBe('unavailable');
  });

  it('says "unavailable" for a reply it does not understand', async () => {
    invoke.mockResolvedValueOnce({ data: { results: 'nope' }, error: null });
    expect(await searchCharities('pets')).toBe('unavailable');
    invoke.mockResolvedValueOnce({ data: null, error: null });
    expect(await searchCharities('pets')).toBe('unavailable');
  });
});

describe('pickCharity (makes sure the picked nonprofit is a row, then gives its id and name)', () => {
  it('returns the row the function answers with', async () => {
    invoke.mockResolvedValueOnce({ data: { id: 'ein-131623829', name: 'ASPCA' }, error: null });
    expect(await pickCharity('131623829')).toEqual({ id: 'ein-131623829', name: 'ASPCA' });
    expect(invoke).toHaveBeenCalledWith('charities', { body: { action: 'pick', ein: '131623829' } });
  });

  it('is null when it fails or answers with something else', async () => {
    invoke.mockResolvedValueOnce({ data: null, error: new Error('502') });
    expect(await pickCharity('131623829')).toBeNull();
    invoke.mockResolvedValueOnce({ data: { id: 5 }, error: null });
    expect(await pickCharity('131623829')).toBeNull();
    invoke.mockRejectedValueOnce(new Error('network'));
    expect(await pickCharity('131623829')).toBeNull();
  });
});

describe('searchedChoice (a search result as a picker tile)', () => {
  it('uses the id the database row will have, and keeps the EIN to pick with', () => {
    expect(searchedChoice(aspca)).toEqual({
      id: 'ein-131623829',
      ein: '131623829',
      name: 'ASPCA',
      detail: 'Rescues animals.',
      logoUrl: 'https://res.cloudinary.com/x/aspca.png',
      slug: 'aspca',
      position: 1000,
    });
  });
});

it('searches from 3 letters, as the function requires', () => {
  expect(SEARCH_MIN_LETTERS).toBe(3);
});

describe('charityPageUrl', () => {
  it('points a plain slug at its Every.org page', () => {
    expect(charityPageUrl('aspca')).toBe('https://www.every.org/aspca');
  });

  it('gives null for no slug or one that could change the address', () => {
    expect(charityPageUrl(null)).toBeNull();
    expect(charityPageUrl('')).toBeNull();
    expect(charityPageUrl('a/../b')).toBeNull();
    expect(charityPageUrl('climate.fund')).toBeNull();
  });
});

describe('openCharityPage', () => {
  it('opens the charity’s Every.org page in the in-app browser', async () => {
    await openCharityPage('aspca');
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith('https://www.every.org/aspca', expect.objectContaining({ presentationStyle: 'pageSheet' }));
  });

  it('opens nothing for a charity without a usable slug', async () => {
    jest.mocked(WebBrowser.openBrowserAsync).mockClear();
    await openCharityPage(null);
    await openCharityPage('a/b');
    expect(WebBrowser.openBrowserAsync).not.toHaveBeenCalled();
  });
});
