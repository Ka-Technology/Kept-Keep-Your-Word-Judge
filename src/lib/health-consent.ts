// The separate consent for health habits (T179; plan.md decision 119; the privacy policy's "Consumer health
// data"). Some habits say something about health, which Washington, Nevada and Connecticut call consumer health
// data, so Kept asks before the first challenge or tracker with one: Allow or Don't allow, neither preselected,
// saved on the profile as `health_allowed` (migration 0075), like the AI answer (privacy-note.ts). Don't allow
// keeps those habits off; Settings → Privacy & security changes it.
// ponytail: the app asks; the database doesn't refuse yet, since builds before this one don't ask. Add a check on
// challenges and trackers once no older build can start one.

import { Alert } from 'react-native';

/** Kept's habits that say something about health: the Body and Food groups, and Meditate. */
const HEALTH_HABITS = new Set(['workout', 'walk-run', 'steps', 'bike', 'stretch', 'cook', 'greens', 'meditate']);

export function isHealthHabit(habitId: string): boolean {
  return HEALTH_HABITS.has(habitId);
}

/**
 * Whether a tracker's name is one of Kept's health habits (picked from the tiles, or typed the same).
 * ponytail: a name of the person's own ("Sleep 8 hours") isn't recognized; a word list if counsel asks for it.
 */
export function healthHabitNamed(name: string, habits: { id: string; name: string }[]): boolean {
  const typed = name.trim().toLowerCase();
  return habits.some((h) => isHealthHabit(h.id) && h.name.toLowerCase() === typed);
}

/** Before a health habit: ask (never asked), go ahead, or stop (they said no). */
export function healthGate(allowed: boolean | null): 'ask' | 'ok' | 'blocked' {
  return allowed === null ? 'ask' : allowed ? 'ok' : 'blocked';
}

/** The question, as the choice's title, and what each answer means. */
export const HEALTH_CHOICE_TITLE = 'Let Kept keep health habits?';
export const HEALTH_CHOICE_MESSAGE =
  'Work out, walking, steps, cycling, stretching, cooking, greens and meditation say something about your health. ' +
  'Kept keeps what you add to them (the habit, your check-ins and photos, and whether you did each day) only to run them. ' +
  'It never sells it or uses it for ads.\n\nWithout it, those habits stay off. Change it any time in Settings.';

/** When a "no" stops a health habit. */
export const HEALTH_BLOCKED_MESSAGE = 'You chose not to let Kept keep health habits. Turn it on in Settings → Privacy & security to start this one.';

/**
 * Before starting a challenge or tracker with a health habit: true once it may go ahead. Asks if never asked
 * (saving the answer with `save`), and says so if the answer was no.
 */
export async function confirmHealthHabit(allowed: boolean | null, save: (allowed: boolean) => Promise<'saved' | string>): Promise<boolean> {
  const gate = healthGate(allowed);
  if (gate === 'ok') return true;
  if (gate === 'blocked') {
    Alert.alert('Health habits are off', HEALTH_BLOCKED_MESSAGE);
    return false;
  }
  const yes = await new Promise<boolean>((resolve) =>
    Alert.alert(
      HEALTH_CHOICE_TITLE,
      HEALTH_CHOICE_MESSAGE,
      [
        { text: 'Don’t allow', onPress: () => resolve(false) },
        { text: 'Allow', onPress: () => resolve(true) },
      ],
      { cancelable: false },
    ),
  );
  if ((await save(yes)) !== 'saved') {
    Alert.alert('Couldn’t save that', 'Check your connection and try again.');
    return false;
  }
  return yes;
}

/** Where the person stands, in a sentence, for Settings. */
export function healthChoiceSummary(allowed: boolean | null): string {
  if (allowed === null) return 'You’ll be asked before your first challenge or tracker with a health habit.';
  return allowed
    ? 'Kept keeps what you add to health habits only to run your challenges and trackers. Turning it off stops new ones; end a running one to withdraw it.'
    : 'Health habits are off: Kept won’t start a challenge or tracker with one.';
}
