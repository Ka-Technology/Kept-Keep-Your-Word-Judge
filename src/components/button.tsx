// The app's button, a capsule in four styles so it's clear what can be tapped and what each tap does:
// - primary: solid green, the screen's main action (Sign in, Continue). One per screen.
// - secondary: a green-tinted fill, another real choice (Create an account, Send a new code).
// - link: plain green text, small ways out (Forgot password?, Back to sign in, Cancel).
// - destructive: solid seal red, for actions that delete something (Delete account).
// - destructiveLink: plain red text, for a small way to cancel, remove or delete something (Cancel this
//   challenge, Remove photo, Withdraw pledge, Decline): anything that cancels or deletes is red (owner, 2026-10-26).
// Labels are set in the display font, bold (A3, T100), except links, which read as plain text.
// `compact` sizes the capsule to its label, for a button that sits inside a tile (Home's Check in).

import { Pressable, StyleSheet, Text } from 'react-native';

import { DANGER_COLOR, FONTS, RADIUS, SPACE, TEXT, WHITE, useStyles, type Colors } from '@/lib/theme';

type Variant = 'primary' | 'secondary' | 'link' | 'destructive' | 'destructiveLink';

/** Takes the same props as React Native's Button, plus `variant` (primary if left out) and `compact`. */
export function Button({
  title,
  onPress,
  disabled = false,
  variant = 'primary',
  compact = false,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: Variant;
  compact?: boolean;
}) {
  const { styles, textStyles } = useStyles(makeStyles);
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      style={({ pressed }) => [styles.base, compact && styles.compact, styles[variant], pressed && styles.pressed, disabled && styles.disabled]}
    >
      <Text style={[styles.text, textStyles[variant]]}>{title}</Text>
    </Pressable>
  );
}

const makeStyles = (c: Colors) => ({
  styles: StyleSheet.create({
    // 52pt tall (links and compact ones 44pt): at or above Apple's 44pt minimum tap target.
    base: { minHeight: 52, borderRadius: RADIUS.pill, paddingHorizontal: SPACE.xl, alignItems: 'center', justifyContent: 'center' },
    compact: { minHeight: 44, alignSelf: 'center', paddingHorizontal: SPACE.lg },
    primary: { backgroundColor: c.primary },
    secondary: { backgroundColor: c.selected },
    link: { minHeight: 44 },
    destructive: { backgroundColor: DANGER_COLOR },
    destructiveLink: { minHeight: 44 },
    pressed: { opacity: 0.7 },
    disabled: { opacity: 0.4 },
    text: { ...TEXT.row, textAlign: 'center' },
  }),
  textStyles: StyleSheet.create({
    primary: { color: c.onPrimary, fontFamily: FONTS.title },
    secondary: { color: c.link, fontFamily: FONTS.title },
    link: { ...TEXT.body, color: c.link, fontWeight: '600' },
    destructive: { color: WHITE, fontFamily: FONTS.title },
    destructiveLink: { ...TEXT.body, color: c.error, fontWeight: '600' },
  }),
});
