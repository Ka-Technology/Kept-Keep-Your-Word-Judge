// A form field as the A3 mockups draw it (T107): one white card holding an outline icon, an optional
// small label over the input, the input itself with no box of its own (bareInputStyle()), and an
// optional end piece (the password's eye, "Available"). Unlike the mockups' borderless cards it keeps
// a 3:1 outline, so a field can be found (WCAG; theme.test.ts). An error shows under the card.

import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ErrorText } from '@/components/error-text';
import { ICON, RADIUS, SPACE, TEXT, useColors, useStyles, type Colors } from '@/lib/theme';

export function Field({
  icon,
  label,
  error,
  trailing,
  children,
}: {
  icon?: SymbolViewProps['name'];
  label?: string;
  error?: string | null;
  trailing?: ReactNode;
  children: ReactNode;
}) {
  const styles = useStyles(makeStyles);
  const colors = useColors();
  return (
    <View style={styles.wrap}>
      <View style={styles.card}>
        {icon && <SymbolView name={icon} size={ICON.row} tintColor={colors.secondaryText} />}
        <View style={styles.body}>
          {label && (
            <Text style={styles.label} importantForAccessibility="no" accessibilityElementsHidden>
              {label}
            </Text>
          )}
          <View style={styles.input}>{children}</View>
        </View>
        {trailing}
      </View>
      <ErrorText message={error} />
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    wrap: { gap: SPACE.xs },
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACE.md,
      minHeight: 52,
      paddingHorizontal: SPACE.lg,
      paddingVertical: SPACE.md,
      borderRadius: RADIUS.card,
      borderCurve: 'continuous',
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.card,
    },
    body: { flex: 1, gap: SPACE.xxs },
    label: { ...TEXT.caption, color: c.secondaryText },
    input: { flexDirection: 'row', alignItems: 'center' },
  });
