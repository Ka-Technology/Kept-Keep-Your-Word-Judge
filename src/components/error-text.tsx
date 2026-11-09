// An error message in red under a field or form, marked as an alert for VoiceOver. Renders nothing
// without a message, so screens can pass their error state straight in.

import { StyleSheet, Text } from 'react-native';

import { TEXT, useStyles, type Colors } from '@/lib/theme';

export function ErrorText({ message }: { message?: string | null }) {
  const styles = useStyles(makeStyles);
  if (!message) return null;
  return (
    <Text style={styles.error} accessibilityRole="alert">
      {message}
    </Text>
  );
}

const makeStyles = (c: Colors) => StyleSheet.create({ error: { ...TEXT.note, color: c.error } });
