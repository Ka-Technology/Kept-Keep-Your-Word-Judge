// The line that makes the agreement (T50): "By continuing, you agree to Kept's Terms of Service and
// Privacy Policy", each a link to its page. Sign-in shows it under Continue with Apple
// and Google (T10, T97), where signing in can create the account. Sign-up and complete-profile ask
// with a tick box instead (decision 99, profile-fields.tsx).

import { router } from 'expo-router';
import { StyleSheet, Text } from 'react-native';

import { TEXT, useStyles, type Colors } from '@/lib/theme';

export function Agreement() {
  const styles = useStyles(makeStyles);
  return (
    <Text style={styles.consent}>
      By continuing, you agree to Kept’s{' '}
      <Text style={styles.link} accessibilityRole="link" onPress={() => router.push({ pathname: '/policy/[doc]', params: { doc: 'terms' } })}>
        Terms of Service
      </Text>{' '}
      and{' '}
      <Text style={styles.link} accessibilityRole="link" onPress={() => router.push({ pathname: '/policy/[doc]', params: { doc: 'privacy' } })}>
        Privacy Policy
      </Text>
      .
    </Text>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    consent: { ...TEXT.note, textAlign: 'center', color: c.secondaryText },
    link: { color: c.link, fontWeight: '600' },
  });
