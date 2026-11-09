// Charity search and pick through Every.org's nonprofit API (docs.every.org, v0.2). The app calls it with the
// user's token while they choose a charity for a challenge:
//   { action: 'search', term }: up to 20 nonprofits matching the term (3 to 60 characters), each with its
//     EIN, name, a short description, a logo and its Every.org slug. Answers are kept for 5 minutes, because
//     Every.org's rate limit (500 searches a minute) is shared by every Kept user.
//   { action: 'pick', ein }: makes sure a `charities` row exists for that EIN and answers `{ id, name }`. The row
//     is written from Every.org's own answer for the EIN, never from anything the app sends, so a searched
//     charity can't be given a made-up name. A row that already has the EIN (the curated ones, or an earlier
//     pick) is returned as it is.
// The key is the EVERY_ORG_API_KEY secret. Without it the search answers `not_configured` (503) and the app
// falls back to Kept's curated picks; a pick of an EIN that already has a row still works.

import { withSupabase } from 'npm:@supabase/server@^1';

import { charityId, cleanTerm, mapDetails, mapSearch, ttlCache, validEin, type SearchResult } from './every.ts';

const API = 'https://partners.every.org/v0.2';
/** A searched charity that isn't one of the curated picks sorts after them. */
const SEARCHED_POSITION = 1000;

const searches = ttlCache<SearchResult[]>(5 * 60_000, 200);

/** Every.org's JSON for a path, or the status it answered with. A timeout or a network error throws. */
async function every(path: string, apiKey: string): Promise<{ ok: true; json: unknown } | { ok: false; status: number }> {
  const response = await fetch(`${API}${path}${path.includes('?') ? '&' : '?'}apiKey=${encodeURIComponent(apiKey)}`, { signal: AbortSignal.timeout(8_000) });
  return response.ok ? { ok: true, json: await response.json() } : { ok: false, status: response.status };
}

export default {
  fetch: withSupabase({ auth: 'user' }, async (req, ctx) => {
    const body = await req.json().catch(() => null);
    const action = body?.action;

    if (action === 'pick') {
      const ein = validEin(body.ein);
      if (!ein) return Response.json({ error: 'ein_invalid' }, { status: 400 });
      const admin = ctx.supabaseAdmin;
      const existing = await admin.from('charities').select('id, name').eq('ein', ein).maybeSingle();
      if (existing.error) return Response.json({ error: 'pick_failed' }, { status: 500 });
      if (existing.data) return Response.json(existing.data);

      const apiKey = Deno.env.get('EVERY_ORG_API_KEY');
      if (!apiKey) return Response.json({ error: 'not_configured' }, { status: 503 });
      const reply = await every(`/nonprofit/${ein}`, apiKey).catch(() => null);
      if (!reply) return Response.json({ error: 'every_unavailable' }, { status: 502 });
      if (!reply.ok) return Response.json({ error: reply.status === 404 ? 'not_found' : 'every_unavailable' }, { status: reply.status === 404 ? 404 : 502 });
      const nonprofit = mapDetails(reply.json);
      // The EIN in the answer must be the one asked for.
      if (!nonprofit || nonprofit.ein !== ein) return Response.json({ error: 'not_found' }, { status: 404 });

      // ignoreDuplicates: two people picking the same new charity at once, or a curated row, are never overwritten.
      const written = await admin.from('charities').upsert(
        { id: charityId(ein), name: nonprofit.name, purpose: nonprofit.purpose, ein, slug: nonprofit.slug, logo_url: nonprofit.logoUrl, position: SEARCHED_POSITION, featured: false },
        { onConflict: 'id', ignoreDuplicates: true },
      );
      if (written.error) return Response.json({ error: 'pick_failed' }, { status: 500 });
      const row = await admin.from('charities').select('id, name').eq('ein', ein).single();
      if (row.error) return Response.json({ error: 'pick_failed' }, { status: 500 });
      return Response.json(row.data);
    }

    if (action === 'search') {
      const term = cleanTerm(body.term);
      if (!term) return Response.json({ error: 'term_invalid' }, { status: 400 });
      const apiKey = Deno.env.get('EVERY_ORG_API_KEY');
      if (!apiKey) return Response.json({ error: 'not_configured' }, { status: 503 });

      const cached = searches.get(term.toLowerCase());
      if (cached) return Response.json({ results: cached });
      const reply = await every(`/search/${encodeURIComponent(term)}?take=20`, apiKey).catch(() => null);
      if (!reply?.ok) return Response.json({ error: 'every_unavailable' }, { status: 502 });
      const results = mapSearch(reply.json);
      searches.set(term.toLowerCase(), results);
      return Response.json({ results });
    }

    return Response.json({ error: 'action_invalid' }, { status: 400 });
  }),
};
