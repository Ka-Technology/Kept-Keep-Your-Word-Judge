// The time Kept's AI steps in for this user (profiles.ai_from_minutes: 9:00 pm to midnight, any minute (migration 0086); 10 pm
// unless they chose later in Settings → Privacy & security; plan.md decision 180). It is read on its own, not with the
// rest of the profile, so an app built before the database has the column (migration 0085) still works: it reads
// 10 pm, and saving a new time says it couldn't. Reloaded whenever a screen comes into view.

import { DEFAULT_STEP_IN, stepInOrDefault } from '../../supabase/functions/_shared/ai-limit';
import { useAuth } from './auth';
import { supabase } from './supabase';
import { useFocusLoad } from './use-focus-load';

export function useStepIn(): { stepIn: number; save: (minutes: number) => Promise<boolean> } {
  const { session } = useAuth();
  const userId = session?.user.id;
  const { data, reload } = useFocusLoad(async () => {
    const { data: row, error } = await supabase.from('profiles').select('ai_from_minutes').eq('id', userId!).maybeSingle();
    return error ? DEFAULT_STEP_IN : stepInOrDefault(row?.ai_from_minutes);
  }, userId);

  /** Saves a new time; false when it couldn't be saved (no connection, or the database doesn't have the column yet). */
  async function save(minutes: number): Promise<boolean> {
    if (!userId) return false;
    const { error } = await supabase.from('profiles').update({ ai_from_minutes: minutes }).eq('id', userId);
    if (!error) reload();
    return !error;
  }

  return { stepIn: data ?? DEFAULT_STEP_IN, save };
}
