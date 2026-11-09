// Settings → Notifications (T48; SPEC-notifications.md): turning notifications on, and a switch for
// each notification on this phone: the shield warning (T35, kept on the phone) and the four pushes
// (T34, T59, T55, T56, kept on the phone's push_tokens row). Demo builds can send a test warning.
// As in the A3 mockup since T131 (full-set/ui-set-4-notifications.jpg): "Notifications" large, each
// switch its own card with an outline icon (the shield warning is "Daily reminder at 8 PM"), and
// "Open Settings" at the end.

import { useEffect, useState } from 'react';
import { Alert, AppState, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { ErrorText } from '@/components/error-text';
import { ListRow, ListScreen, ListSection } from '@/components/list';
import { LoadingScreen } from '@/components/step-screen';
import { PageTitle } from '@/components/tab-title';
import { demoClockEnabled } from '@/lib/challenges';
import {
  askForNotifications,
  loadPushSwitches,
  notificationPermission,
  registerPushToken,
  sendTestShieldWarning,
  setPushSwitch,
  setShieldWarningsOn,
  shieldWarningsOn,
  type PushSwitch,
} from '@/lib/notifications';
import { SPACE, TEXT, useStyles, type Colors } from '@/lib/theme';
import { useFocusLoad } from '@/lib/use-focus-load';

const SWITCH_FAILED_MESSAGE = "Couldn't change that. Check your connection and try again.";

/**
 * Where notifications stand on this phone, and its switches once they're on. Turned on in the iPhone's
 * Settings, the token isn't stored yet, so it's stored first.
 */
async function loadState() {
  const permission = await notificationPermission();
  const warnings = await shieldWarningsOn();
  if (permission !== 'on') return { permission, warnings, switches: null };
  const switches = (await loadPushSwitches()) ?? (await registerPushToken().then(loadPushSwitches));
  return { permission, warnings, switches };
}

export default function NotificationSettings() {
  const styles = useStyles(makeStyles);
  const { data, failed, reload } = useFocusLoad(loadState);
  // Switches changed on this visit, shown at once over what was loaded.
  const [changed, setChanged] = useState<Partial<Record<PushSwitch, boolean>>>({});
  const [warnings, setWarnings] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Back from the iPhone's Settings (where notifications are turned on or off): look again.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => state === 'active' && reload());
    return () => subscription.remove();
  }, [reload]);

  if (!data) return <LoadingScreen failed={failed} onRetry={reload} message="Couldn’t load your notifications. Check your connection and try again." />;
  const switches = data.switches && { ...data.switches, ...changed };

  /** The shield warning is kept on the phone, so it can't fail to save; turning it off cancels the scheduled ones. */
  function toggleWarnings(on: boolean) {
    setWarnings(on);
    setShieldWarningsOn(on);
  }

  async function testWarning() {
    const sent = await sendTestShieldWarning().catch(() => false);
    Alert.alert(sent ? 'A test reminder comes in a minute. Lock the phone to see it.' : 'Start a challenge or a free tracker first, then try again.');
  }

  /** Shows the change at once, and puts it back if it can't be saved. */
  async function toggle(name: PushSwitch, on: boolean) {
    setError(null);
    setChanged((c) => ({ ...c, [name]: on }));
    try {
      await setPushSwitch(name, on);
    } catch {
      setChanged((c) => ({ ...c, [name]: !on }));
      setError(SWITCH_FAILED_MESSAGE);
    }
  }

  return (
    <ListScreen>
      <PageTitle title="Notifications" />
      {data.permission === 'not-asked' && (
        <ListSection footer="Kept tells you when a friend's check-in needs you, and at 8 pm on a day you haven't checked in.">
          <View style={styles.action}>
            <Button title="Turn on notifications" onPress={() => askForNotifications().then(reload)} />
          </View>
        </ListSection>
      )}
      {data.permission === 'off' && (
        <ListSection footer="Notifications are off for Kept. Turn them on in the iPhone's Settings.">
          <View style={styles.action}>
            <Button title="Open iPhone Settings" onPress={() => Linking.openSettings()} variant="secondary" />
          </View>
        </ListSection>
      )}
      {data.permission === 'on' && switches && (
        <>
          <ListSection footer="On this phone, on a day you haven't checked in to a challenge or marked a free tracker done.">
            <ListRow
              label="Daily reminder at 8 PM"
              icon={{ ios: 'bell', android: 'notifications' }}
              toggle={{ value: warnings ?? data.warnings, onValueChange: toggleWarnings }}
              first
            />
            {demoClockEnabled() && (
              <View style={styles.action}>
                <Button title="Send a test reminder in 1 minute" onPress={testWarning} variant="secondary" />
              </View>
            )}
          </ListSection>
          <ListSection footer="When your quiz opens, when a friend asks for a new photo, and when Kept's AI decides a day: it approves it, counts it, asks for a new photo, or doesn't approve it.">
            <ListRow
              label="Your check-ins"
              icon={{ ios: 'calendar.badge.clock', android: 'event' }}
              toggle={{ value: switches.check_ins, onValueChange: (on) => toggle('check_ins', on) }}
              first
            />
          </ListSection>
          <ListSection footer="When a friend checks in and needs you to confirm it, before Kept’s AI steps in (10 pm unless they chose later).">
            <ListRow
              label="Reviews to do"
              icon={{ ios: 'star.bubble', android: 'rate_review' }}
              toggle={{ value: switches.reviews, onValueChange: (on) => toggle('reviews', on) }}
              first
            />
          </ListSection>
          <ListSection footer="When a friend or a backer pledges behind your challenge. Without a sound.">
            <ListRow
              label="Someone backs you"
              icon={{ ios: 'heart', android: 'favorite_border' }}
              toggle={{ value: switches.pledges, onValueChange: (on) => toggle('pledges', on) }}
              first
            />
          </ListSection>
          <ListSection footer="When someone asks to be your friend.">
            <ListRow
              label="Friend requests"
              icon={{ ios: 'person.badge.plus', android: 'person_add' }}
              toggle={{ value: switches.friends, onValueChange: (on) => toggle('friends', on) }}
              first
            />
          </ListSection>
          <View style={styles.settingsLine}>
            <Text style={styles.settingsText}>Notifications are on in iOS Settings.</Text>
            <Pressable onPress={() => Linking.openSettings()} accessibilityRole="link" hitSlop={12}>
              <Text style={styles.settingsLink}>Open Settings</Text>
            </Pressable>
          </View>
        </>
      )}
      <ErrorText message={error} />
    </ListScreen>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    action: { padding: SPACE.md },
    settingsLine: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: SPACE.sm,
      paddingTop: SPACE.lg,
      marginHorizontal: SPACE.xs,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.separator,
    },
    settingsText: { ...TEXT.note, color: c.secondaryText },
    settingsLink: { ...TEXT.note, color: c.secondaryText, fontWeight: '600', textDecorationLine: 'underline' },
  });
