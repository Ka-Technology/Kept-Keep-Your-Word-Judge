// Reading Every.org's nonprofit API (docs.every.org, v0.2): the pure parts of the `charities` function.
// Everything from Every.org or from the app is untrusted: each reader checks what it takes and drops the rest.

export type SearchResult = { ein: string; name: string; description: string; logoUrl: string | null; slug: string | null };
/** What a `charities` row is written from, after Every.org's own answer for one EIN. */
export type Nonprofit = { ein: string; name: string; purpose: string; slug: string | null; logoUrl: string | null };

const FALLBACK_PURPOSE = 'A US nonprofit found through Every.org.';
const PURPOSE_MAX = 140;

function obj(x: unknown): Record<string, unknown> | null {
  return x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : null;
}

/** A search term from the app: 3 to 60 characters once trimmed, or null. */
export function cleanTerm(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const term = raw.replace(/\s+/g, ' ').trim();
  return term.length >= 3 && term.length <= 60 ? term : null;
}

/** An EIN as 9 digits (a dash after the first two is fine), or null. */
export function validEin(raw: unknown): string | null {
  return typeof raw === 'string' && /^\d{2}-?\d{7}$/.test(raw) ? raw.replace('-', '') : null;
}

/** The slug of an every.org page address (search results carry that, not the slug), or null. */
export function slugFromProfileUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  try {
    const url = new URL(raw);
    if (url.hostname !== 'www.every.org' && url.hostname !== 'every.org') return null;
    const slug = url.pathname.split('/')[1];
    return slug && /^[A-Za-z0-9-]+$/.test(slug) ? slug : null;
  } catch {
    return null;
  }
}

/** The one-line "what it does": the description cut at a word, or a plain line when there is none. */
export function purposeOf(raw: unknown): string {
  const text = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
  if (!text) return FALLBACK_PURPOSE;
  if (text.length <= PURPOSE_MAX) return text;
  const cut = text.slice(0, PURPOSE_MAX);
  const at = cut.lastIndexOf(' ');
  return `${(at > PURPOSE_MAX / 2 ? cut.slice(0, at) : cut).trimEnd()}…`;
}

/** The `charities.id` of a searched charity. The prefix keeps it clear of the curated ids. */
export function charityId(ein: string): string {
  return `ein-${ein}`;
}

/** Only https addresses are passed on as a logo. */
function httpsOrNull(raw: unknown): string | null {
  return typeof raw === 'string' && raw.startsWith('https://') ? raw : null;
}

/** Search results the picker can show: a name and a valid EIN are required. */
export function mapSearch(json: unknown): SearchResult[] {
  const list = obj(json)?.nonprofits;
  if (!Array.isArray(list)) return [];
  return list.flatMap((item): SearchResult[] => {
    const n = obj(item);
    const ein = validEin(n?.ein);
    const name = typeof n?.name === 'string' ? n.name.trim().slice(0, 120) : '';
    if (!n || !ein || !name) return [];
    return [{ ein, name, description: purposeOf(n.description), logoUrl: httpsOrNull(n.logoUrl), slug: slugFromProfileUrl(n.profileUrl) }];
  });
}

/** One nonprofit from `/nonprofit/:ein`, or null if Every.org's answer lacks a name or a valid EIN. */
export function mapDetails(json: unknown): Nonprofit | null {
  const n = obj(obj(obj(json)?.data)?.nonprofit);
  const ein = validEin(n?.ein);
  const name = typeof n?.name === 'string' ? n.name.trim().slice(0, 120) : '';
  if (!n || !ein || !name) return null;
  const slug = typeof n.primarySlug === 'string' && /^[A-Za-z0-9-]+$/.test(n.primarySlug) ? n.primarySlug : null;
  return { ein, name, purpose: purposeOf(n.description), slug, logoUrl: httpsOrNull(n.logoUrl) };
}

/** A small cache that forgets entries after `ttlMs` and never holds more than `max` (people choose the keys). */
export function ttlCache<T>(ttlMs: number, max: number, now: () => number = Date.now) {
  const entries = new Map<string, { value: T; expires: number }>();
  return {
    get(key: string): T | undefined {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (entry.expires < now()) {
        entries.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set(key: string, value: T): void {
      entries.delete(key);
      if (entries.size >= max) entries.delete(entries.keys().next().value!);
      entries.set(key, { value, expires: now() + ttlMs });
    },
  };
}
