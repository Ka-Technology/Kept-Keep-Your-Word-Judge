// Report and Block (T53; SPEC-friends.md, "Reports and blocks"), shown together wherever someone
// might need them: a friend's profile, a check-in under review, a public challenge and a friend
// request. Report opens the report screen; Block asks first, then blocks through the database
// (block_user or block_challenger, migration 0035), which ends any friendship or request and hides
// the two people from each other. The blocked person isn't told.

import { router } from 'expo-router';
import { Alert, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { moderationErrorMessage } from '@/lib/moderation';
import { supabase } from '@/lib/supabase';
import { SPACE } from '@/lib/theme';

/** What to report: a person, a check-in, or a challenge (the database works out whose). */
export type ReportTarget = { reportedId?: string; checkInId?: string; challengeId?: string };

type ReportBlockProps = {
  report: ReportTarget;
  /** A person by id, or a challenge's challenger (anonymous on a stranger's public challenge). */
  block: { user: string } | { challenge: string };
  /** How the screens name them: "@ben", or "this challenger" when they're anonymous. */
  name: string;
  /** Runs before the report screen opens, e.g. to close a sheet. */
  onReport?: () => void;
  onBlocked: () => void;
};

/** Report and Block as two links. */
export function ReportBlock(props: ReportBlockProps) {
  const { openReport, confirmBlock } = reportBlockActions(props);
  return (
    <View style={styles.row}>
      <Button title="Report" onPress={openReport} variant="link" />
      <Button title="Block" onPress={confirmBlock} variant="destructiveLink" />
    </View>
  );
}

/** The two actions, for screens that show them their own way (a friend's page has red rows, T123). */
export function reportBlockActions({ report, block, name, onReport, onBlocked }: ReportBlockProps) {
  function openReport() {
    onReport?.();
    router.push({ pathname: '/report', params: report });
  }

  function confirmBlock() {
    Alert.alert(
      `Block ${name}?`,
      'You won’t see each other on Kept: they can’t find you, send you a request or back your challenges, and they aren’t told. You can unblock them in Settings → Privacy & security.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          onPress: async () => {
            const { error } =
              'user' in block
                ? await supabase.rpc('block_user', { person: block.user })
                : await supabase.rpc('block_challenger', { challenge: block.challenge });
            if (error) return Alert.alert('Couldn’t block', moderationErrorMessage(error));
            onBlocked();
          },
        },
      ],
    );
  }

  return { openReport, confirmBlock };
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'center', gap: SPACE.xxl },
});
