// Loads one of Kept's lists (habits, or its curated charities) for a dropdown, in list order, with a retry. Each
// choice keeps its place in the list, which groups the habits under their headings (T109). A charity row can
// also come from an Every.org search (0054); only the featured ones are Kept's picks, and they carry a logo.

import { supabase } from '@/lib/supabase';
import { must, useFocusLoad } from '@/lib/use-focus-load';

/** Which list, and which column explains each option. */
const LISTS = {
  habits: 'check_summary',
  charities: 'purpose',
} as const;

/** One option: `detail` is its explanation, shown under the choice. */
export type ChoiceOption = { id: string; name: string; detail?: string };

export type Choice = ChoiceOption & { position: number; logoUrl?: string | null; slug?: string | null };

/** `choices` is null while loading; `failed` offers a retry. */
export function useChoices(list: keyof typeof LISTS): { choices: Choice[] | null; failed: boolean; retry: () => void } {
  const detail = LISTS[list];
  const { data, failed, reload } = useFocusLoad(async () => {
    const query = supabase.from(list).select(`id, name, position, ${detail}${list === 'charities' ? ', logo_url, slug' : ''}`).order('position');
    const rows = must(await (list === 'charities' ? query.eq('featured', true) : query)) as unknown as Record<string, string | number | null>[];
    return rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      detail: String(row[detail]),
      position: Number(row.position),
      logoUrl: typeof row.logo_url === 'string' ? row.logo_url : null,
      slug: typeof row.slug === 'string' ? row.slug : null,
    }));
  }, list);
  return { choices: data, failed, retry: reload };
}
