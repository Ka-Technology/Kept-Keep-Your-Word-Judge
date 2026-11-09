// Kept's notifications on the phone (SPEC-notifications.md): asking permission at the right
// moments, this phone's Expo push token and its switches (push_tokens, T34), the shield warnings
// scheduled on the phone (T35) with the free trackers' 8 pm reminder beside them, and opening the
// right screen when a notification is tapped. The pushes themselves come from the `notify` Edge Function.

import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { IosAuthorizationStatus } from 'expo-notifications';
import { router, type Href } from 'expo-router';
import { useEffect } from 'react';

import { CHALLENGE_COLUMNS, summarizeChallenge, type ChallengeRow } from './challenges';
import { shieldWarnings, WARNING_TITLE, WARNING_URL, warningText } from './shield-warnings';
import { supabase } from './supabase';
import { summarizeTracker, TRACKER_COLUMNS, TRACKER_REMINDER_TITLE, trackerReminders, trackerReminderText, type TrackerRow } from './trackers';

// With Kept open, a notification still shows as a banner and in the list; its own sound plays if it has one.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldPlaySound: true, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true }),
});

/** Where the phone's permission stands: iOS hasn't asked yet, it's allowed, or the person said no. */
export type PermissionState = 'not-asked' | 'on' | 'off';

/** The switches kept on this phone's push_tokens row, one per push (SPEC-notifications.md). */
export type PushSwitch = 'reviews' | 'check_ins' | 'pledges' | 'friends';

/** Reads Expo's permission answer. iOS's quiet ("provisional") permission counts as on. */
export function permissionState(p: { granted: boolean; canAskAgain: boolean; ios?: { status: number } }): PermissionState {
  if (p.granted || p.ios?.status === IosAuthorizationStatus.PROVISIONAL) return 'on';
  return p.canAskAgain ? 'not-asked' : 'off';
}

export async function notificationPermission(): Promise<PermissionState> {
  return permissionState(await Notifications.getPermissionsAsync());
}

// This phone's token, once known. It's the same for every account on the phone.
let token: string | null = null;

/** This phone's Expo push token, or null if it can't be had (offline, or no project id). */
async function pushToken(): Promise<string | null> {
  if (token) return token;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return null;
  try {
    token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  } catch {
    return null;
  }
  return token;
}

/** Stores this phone's token for the signed-in user, if notifications are on. Runs at launch (a token can change). */
export async function registerPushToken(): Promise<void> {
  if ((await notificationPermission()) !== 'on') return;
  const t = await pushToken();
  if (t) await supabase.rpc('register_push_token', { token: t });
}

/**
 * Shows iOS's prompt if it hasn't been shown yet, then registers the token. Called when notifications
 * become useful (the first challenge, a friend request) and from Settings. Never throws.
 */
export async function askForNotifications(): Promise<PermissionState> {
  try {
    let state = await notificationPermission();
    if (state === 'not-asked') state = permissionState(await Notifications.requestPermissionsAsync());
    if (state === 'on') {
      await registerPushToken();
      rescheduleShieldWarnings();
    }
    return state;
  } catch {
    return 'off';
  }
}

/** Deletes this phone's token before signing out, so the next account here gets nothing meant for this one. */
export async function forgetPushToken(): Promise<void> {
  const t = token ?? ((await notificationPermission()) === 'on' ? await pushToken() : null);
  if (t) await supabase.from('push_tokens').delete().eq('token', t);
}

/** This phone's switches, or null if its token isn't stored (notifications off, or offline). */
export async function loadPushSwitches(): Promise<Record<PushSwitch, boolean> | null> {
  const t = await pushToken();
  if (!t) return null;
  const { data, error } = await supabase.from('push_tokens').select('reviews, check_ins, pledges, friends').eq('token', t).maybeSingle();
  if (error) throw error;
  return data;
}

/** Turns one push on or off for this phone. */
export async function setPushSwitch(name: PushSwitch, on: boolean): Promise<void> {
  const t = await pushToken();
  if (!t) return;
  const { error } = await supabase.from('push_tokens').update({ [name]: on }).eq('token', t);
  if (error) throw error;
}

// The shield warnings' identifiers start with this, so rescheduling finds and replaces only them.
const WARNING_ID = 'shield-warning-';
// The 8 pm reminder ("Not checked in yet") is on unless this phone turned it off (a phone setting, not the account's).
const WARNINGS_OFF_KEY = 'kept.shieldWarningsOff';

export async function shieldWarningsOn(): Promise<boolean> {
  return (await AsyncStorage.getItem(WARNINGS_OFF_KEY).catch(() => null)) !== 'yes';
}

export async function setShieldWarningsOn(on: boolean): Promise<void> {
  await (on ? AsyncStorage.removeItem(WARNINGS_OFF_KEY) : AsyncStorage.setItem(WARNINGS_OFF_KEY, 'yes'));
  await rescheduleShieldWarnings();
}

/** The signed-in user's unended challenges (only those can warn), as the screens summarize them. Null when signed out. */
async function myChallenges() {
  const userId = (await supabase.auth.getSession()).data.session?.user.id;
  if (!userId) return null;
  const { data, error } = await supabase.from('challenges').select(CHALLENGE_COLUMNS).eq('user_id', userId).is('outcome', null);
  if (error) throw error;
  const now = new Date();
  return (data as unknown as ChallengeRow[]).map((row) => summarizeChallenge(row, now));
}

/** The signed-in user's running trackers (0040). Empty on any error: a reminder is never worth failing over. */
async function myTrackers() {
  const { data } = await supabase.from('trackers').select(TRACKER_COLUMNS).is('archived_at', null);
  const now = new Date();
  return ((data ?? []) as TrackerRow[]).map((row) => summarizeTracker(row, now));
}

async function cancelShieldWarnings(): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(scheduled.filter((n) => n.identifier.startsWith(WARNING_ID)).map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)));
}

async function reschedule(): Promise<void> {
  await cancelShieldWarnings();
  if ((await notificationPermission()) !== 'on' || !(await shieldWarningsOn())) return;
  const challenges = await myChallenges();
  if (!challenges) return;
  const warnings = shieldWarnings(challenges, new Date());
  for (const w of warnings) {
    await Notifications.scheduleNotificationAsync({
      identifier: `${WARNING_ID}${w.at.toISOString()}`,
      content: { title: w.title, body: w.body, data: { url: w.url }, sound: 'default' },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: w.at },
    });
  }
  // Free trackers' reminders, under the same switch, within iOS's 64 scheduled notifications.
  for (const r of trackerReminders(await myTrackers(), new Date()).slice(0, 60 - warnings.length)) {
    await Notifications.scheduleNotificationAsync({
      identifier: `${WARNING_ID}tracker-${r.at.toISOString()}`,
      content: { title: TRACKER_REMINDER_TITLE, body: r.body, data: { url: '/challenges' }, sound: 'default' },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: r.at },
    });
  }
}

// One reschedule at a time, so two close together (a check-in, then Kept going to the background)
// can't interleave their cancelling and scheduling.
let queue: Promise<void> = Promise.resolve();

/**
 * Cancels the shield warnings and schedules them again from the challenges as they are now. Runs at
 * launch and whenever Kept comes to the front, and after a check-in, a start, a quit or cancel, or
 * "Next day". Never throws: a failure just leaves the previous schedule.
 */
export function rescheduleShieldWarnings(): Promise<void> {
  queue = queue.then(reschedule).catch(() => {});
  return queue;
}

/** Signed out: this phone stops warning about that account's challenges. */
export function stopShieldWarnings(): Promise<void> {
  queue = queue.then(cancelShieldWarnings).catch(() => {});
  return queue;
}

/**
 * Demo builds: the warning's real text for every running challenge (or, with none, the reminder's
 * for every running free tracker), in a minute, as if none were done yet. Returns false if there's
 * nothing running to remind about.
 */
export async function sendTestShieldWarning(): Promise<boolean> {
  const running = ((await myChallenges()) ?? []).filter((c) => c.state === 'active');
  const trackers = (await myTrackers()).filter((t) => t.state === 'active').map((t) => t.name);
  const content = running.length
    ? { title: WARNING_TITLE, body: warningText(running), data: { url: WARNING_URL } }
    : trackers.length
      ? { title: TRACKER_REMINDER_TITLE, body: trackerReminderText(trackers), data: { url: '/challenges' } }
      : null;
  if (!content) return false;
  await Notifications.scheduleNotificationAsync({
    identifier: `${WARNING_ID}test`,
    content: { ...content, sound: 'default' },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(Date.now() + 60_000) },
  });
  return true;
}

/** The screen a tapped notification opens: only Kept's own paths ("/review/…"), never another site or app. */
export function tapUrl(data: unknown): string | null {
  const url = (data as { url?: unknown } | null | undefined)?.url;
  return typeof url === 'string' && url.startsWith('/') && !url.startsWith('//') ? url : null;
}

/**
 * Opens a tapped notification's screen, including the tap that launched Kept (Expo Router's
 * documented pattern). Mount it once, beside the navigator, so a launch tap isn't replayed.
 */
export function useNotificationTaps() {
  useEffect(() => {
    function open(n: Notifications.Notification) {
      const url = tapUrl(n.request.content.data);
      if (url) router.push(url as Href);
    }
    const launch = Notifications.getLastNotificationResponse();
    if (launch?.notification) {
      open(launch.notification);
      Notifications.clearLastNotificationResponse();
    }
    const subscription = Notifications.addNotificationResponseReceivedListener((r) => open(r.notification));
    return () => subscription.remove();
  }, []);
}
