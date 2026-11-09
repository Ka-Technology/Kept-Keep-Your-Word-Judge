// The signed-in app's tab bar: Home · Challenges · Check in · Wallet · Friends (SPEC-app-shell.md;
// Friends replaced Me on 2026-10-17, T88: your profile opens from your photo at the top right of each tab).
// Native tabs give the system tab bar on each platform (Liquid Glass on iOS 26, shrinking while a
// screen scrolls down), and VoiceOver reads each tab by its label.
// NativeTabs comes from 'expo-router/native-tabs' since SDK 58 (it was `unstable-native-tabs` before).
// The Friends tab shows a red dot while friend requests are waiting (T22). While a check-in is due today, a floating pill
// above the bar offers the soonest one (iOS 26's bottom accessory; components/next-check-in.tsx).

import { NativeTabs } from 'expo-router/native-tabs';

import { NextCheckIn, type NextDue } from '@/components/next-check-in';
import { useColors } from '@/lib/theme';
import { dueSoonest, timeLeft } from '@/lib/today';
import { useFriendRequestCount } from '@/lib/use-friend-requests';
import { useMyChallenges } from '@/lib/use-my-challenges';
import { useNow } from '@/lib/use-now';

/**
 * Five tabs. Icons are SF Symbols on iOS (outline, filled when selected; a trophy for Challenges and
 * a wallet for Wallet, as in the A3 mockups) and Material icons on Android; the selected tab takes
 * the green, the others pencil gray.
 */
export default function TabLayout() {
  const colors = useColors();
  const friendRequests = useFriendRequestCount();
  const next = useNextDue();

  return (
    <NativeTabs
      tintColor={colors.link}
      iconColor={{ default: colors.secondaryText, selected: colors.link }}
      badgeBackgroundColor={colors.error}
      minimizeBehavior="onScrollDown"
    >
      {next && (
        <NativeTabs.BottomAccessory>
          <NextCheckIn next={next} />
        </NativeTabs.BottomAccessory>
      )}
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'house', selected: 'house.fill' }} md="home" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="challenges">
        <NativeTabs.Trigger.Label>Challenges</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'trophy', selected: 'trophy.fill' }} md="emoji_events" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="check-in">
        <NativeTabs.Trigger.Label>Check in</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'checkmark.circle', selected: 'checkmark.circle.fill' }} md="check_circle" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="wallet">
        <NativeTabs.Trigger.Label>Wallet</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'wallet.bifold', selected: 'wallet.bifold.fill' }} md="account_balance_wallet" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="friends">
        <NativeTabs.Trigger.Label>Friends</NativeTabs.Trigger.Label>
        {friendRequests > 0 && <NativeTabs.Trigger.Badge />}
        <NativeTabs.Trigger.Icon sf={{ default: 'person.2', selected: 'person.2.fill' }} md="group" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

/**
 * The check-in to show on the floating pill (one to redo first, else the soonest still due today),
 * with how many are due in all; null when nothing is due. Reloads whenever the tabs come back into
 * view (e.g. after checking in).
 */
function useNextDue(): NextDue | null {
  const { challenges } = useMyChallenges();
  const now = useNow();
  const due = dueSoonest(challenges ?? [], now);
  const lead = due.find((d) => d.action === 'redo') ?? due[0];
  if (!lead) return null;
  const { challenge: c, minutes, action } = lead;
  return { challengeId: c.id, habitId: c.habitId, title: c.title, left: timeLeft(minutes), count: due.length, redo: action === 'redo' };
}
