// Unit tests for every.ts: how Kept reads Every.org's nonprofit API (search and details). Run with the app's jest.
import { charityId, cleanTerm, mapDetails, mapSearch, purposeOf, slugFromProfileUrl, ttlCache, validEin } from './every';

describe('cleanTerm (what a person typed into the charity search)', () => {
  it('trims and collapses spaces', () => {
    expect(cleanTerm('  clean   water ')).toBe('clean water');
  });

  it('needs 3 to 60 characters', () => {
    expect(cleanTerm('ab')).toBeNull();
    expect(cleanTerm('abc')).toBe('abc');
    expect(cleanTerm('a'.repeat(60))).toBe('a'.repeat(60));
    expect(cleanTerm('a'.repeat(61))).toBeNull();
  });

  it('refuses anything that is not text', () => {
    expect(cleanTerm(undefined)).toBeNull();
    expect(cleanTerm(12345)).toBeNull();
    expect(cleanTerm({ term: 'water' })).toBeNull();
  });
});

describe('validEin (a nonprofit’s tax ID)', () => {
  it('takes 9 digits, with or without the dash', () => {
    expect(validEin('131623829')).toBe('131623829');
    expect(validEin('13-1623829')).toBe('131623829');
  });

  it('refuses anything else', () => {
    expect(validEin('12345678')).toBeNull();
    expect(validEin('1234567890')).toBeNull();
    expect(validEin('feeding-america')).toBeNull();
    expect(validEin('13/../1623829')).toBeNull();
    expect(validEin(131623829)).toBeNull();
  });
});

describe('slugFromProfileUrl (search results carry the page address, not the slug)', () => {
  it('reads the slug from an every.org address', () => {
    expect(slugFromProfileUrl('https://www.every.org/feeding-america')).toBe('feeding-america');
    expect(slugFromProfileUrl('https://www.every.org/feeding-america?utm=x#donate')).toBe('feeding-america');
  });

  it('gives null for anything that is not an every.org page', () => {
    expect(slugFromProfileUrl('https://evil.example/feeding-america')).toBeNull();
    expect(slugFromProfileUrl('https://www.every.org/')).toBeNull();
    expect(slugFromProfileUrl('not a url')).toBeNull();
    expect(slugFromProfileUrl(undefined)).toBeNull();
  });
});

describe('purposeOf (the one-line "what it does" shown under a charity)', () => {
  it('keeps a short description whole', () => {
    expect(purposeOf('Clean water for everyone.')).toBe('Clean water for everyone.');
  });

  it('cuts a long one at a word and adds an ellipsis', () => {
    const out = purposeOf('word '.repeat(100));
    expect(out.length).toBeLessThanOrEqual(141);
    expect(out.endsWith('…')).toBe(true);
    expect(out).not.toMatch(/\s…$/);
  });

  it('has a plain fallback when there is no description', () => {
    expect(purposeOf(undefined)).toBe('A US nonprofit found through Every.org.');
    expect(purposeOf('   ')).toBe('A US nonprofit found through Every.org.');
  });
});

describe('charityId (the row id of a searched charity)', () => {
  it('is the EIN with a prefix, so it never collides with the curated ids', () => {
    expect(charityId('131623829')).toBe('ein-131623829');
  });
});

describe('mapSearch (Every.org’s search reply)', () => {
  const reply = {
    nonprofits: [
      { name: 'ASPCA', ein: '131623829', description: 'Rescues animals.', logoUrl: 'https://res.cloudinary.com/x/aspca.png', profileUrl: 'https://www.every.org/aspca', matchedTerms: ['pet'] },
      { name: 'No EIN Org', description: 'x', profileUrl: 'https://www.every.org/no-ein' },
      { name: '', ein: '111111111' },
      { name: 'Odd Logo', ein: '222222222', logoUrl: 'javascript:alert(1)', profileUrl: 'https://www.every.org/odd-logo' },
    ],
  };

  it('keeps what the picker shows and drops rows without a name and a valid EIN', () => {
    const results = mapSearch(reply);
    expect(results.map((r) => r.ein)).toEqual(['131623829', '222222222']);
    expect(results[0]).toEqual({
      ein: '131623829',
      name: 'ASPCA',
      description: 'Rescues animals.',
      logoUrl: 'https://res.cloudinary.com/x/aspca.png',
      slug: 'aspca',
    });
  });

  it('only passes on https logo addresses', () => {
    expect(mapSearch(reply)[1].logoUrl).toBeNull();
  });

  it('is empty for a reply it does not understand', () => {
    expect(mapSearch(null)).toEqual([]);
    expect(mapSearch({})).toEqual([]);
    expect(mapSearch({ nonprofits: 'nope' })).toEqual([]);
  });
});

describe('mapDetails (Every.org’s nonprofit reply, the only source a new charity row is written from)', () => {
  const reply = {
    data: {
      nonprofit: {
        name: 'Feeding America',
        ein: '363673599',
        primarySlug: 'feeding-america',
        description: 'A network of food banks.',
        logoUrl: 'https://res.cloudinary.com/x/fa.png',
      },
    },
  };

  it('gives the fields a charities row needs', () => {
    expect(mapDetails(reply)).toEqual({
      ein: '363673599',
      name: 'Feeding America',
      purpose: 'A network of food banks.',
      slug: 'feeding-america',
      logoUrl: 'https://res.cloudinary.com/x/fa.png',
    });
  });

  it('is null without a name or a valid EIN', () => {
    expect(mapDetails({ data: { nonprofit: { ein: '363673599' } } })).toBeNull();
    expect(mapDetails({ data: { nonprofit: { name: 'X', ein: 'nope' } } })).toBeNull();
    expect(mapDetails({})).toBeNull();
    expect(mapDetails(null)).toBeNull();
  });
});

describe('ttlCache (so repeat searches do not spend Every.org’s shared rate limit)', () => {
  it('returns a value until it expires', () => {
    let now = 1000;
    const cache = ttlCache<string>(5_000, 10, () => now);
    cache.set('water', 'a');
    expect(cache.get('water')).toBe('a');
    now = 5_999;
    expect(cache.get('water')).toBe('a');
    now = 6_001;
    expect(cache.get('water')).toBeUndefined();
  });

  it('never grows past its limit, since people choose the keys', () => {
    const cache = ttlCache<number>(60_000, 3, () => 0);
    ['a', 'b', 'c', 'd'].forEach((k, i) => cache.set(k, i));
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('d')).toBe(3);
  });
});
