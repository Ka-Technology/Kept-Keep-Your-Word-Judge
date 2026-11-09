// The frame the signed-out screens share (sign-in, sign-up, forgot-password, verify and
// reset-password, complete-profile): a column that scrolls and moves up for the keyboard, with an
// optional `top` (a step's progress bar), a title at the top left as the A3 mockups set it (T115),
// an optional line under it, and the form. Also the email box three of them share, a field card
// with an envelope (A3, T114). On sign-in the title ("Welcome back") sits under Kept's K stamp.

import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DayStamp } from '@/components/big-stamp';
import { Field } from '@/components/field';
import { bareInputStyle, COLUMN, HERO_MAX_SCALE, RADIUS, PLACEHOLDER_COLOR, SPACE, TEXT, TYPE, useColors, useStyles, type Colors } from '@/lib/theme';

/** `large` is for the sign-in screen's "Welcome back": centered, a hero title under Kept's K stamp (A3, T114). */
export function AuthScreen({
  title,
  subtitle,
  large,
  top,
  icon,
  boxed,
  children,
}: {
  title: string;
  subtitle?: string;
  large?: boolean;
  /** Above the title, e.g. sign-up's progress bar. */
  top?: ReactNode;
  /** An outline icon (or Kept's stamp) in a white square beside the title (A3, T116–T118). */
  icon?: ReactNode;
  /** The title and its line in a card, as verify's "Check your email" (T116). */
  boxed?: boolean;
  children: ReactNode;
}) {
  const styles = useStyles(makeStyles);
  const colors = useColors();
  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.safe} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={[styles.container, large && styles.centered]} keyboardShouldPersistTaps="handled">
          {top}
          {large && (
            <View style={styles.mark} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <DayStamp kind="kept" color={colors.stamp} size={88} />
            </View>
          )}
          {icon ? (
            <View style={[styles.heading, boxed && styles.boxed, styles.spaced]}>
              <View style={styles.iconTile}>{icon}</View>
              <View style={styles.headingText}>
                <Text style={[styles.title, styles.headingTitle]} accessibilityRole="header">
                  {title}
                </Text>
                {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
              </View>
            </View>
          ) : (
            <>
              <Text style={[styles.title, large && styles.large, !subtitle && styles.spaced]} accessibilityRole="header" maxFontSizeMultiplier={large ? HERO_MAX_SCALE : undefined}>
                {title}
              </Text>
              {subtitle && <Text style={[styles.subtitle, large && styles.centeredText, styles.spaced]}>{subtitle}</Text>}
            </>
          )}
          <View style={styles.form}>{children}</View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/**
 * The email box on sign-in, sign-up and forgot-password, as a field card with an envelope; each adds
 * its value, Return key and checks. `label` puts a small label over it (sign-up's "Email address").
 */
export function EmailInput({ label, ...props }: TextInputProps & { label?: string }) {
  const colors = useColors();
  return (
    <Field icon={{ ios: 'envelope', android: 'mail' }} label={label}>
      <TextInput
        style={bareInputStyle(colors)}
        placeholder="Email address"
        placeholderTextColor={PLACEHOLDER_COLOR}
        accessibilityLabel="Email"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
        {...props}
      />
    </Field>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    safe: { flex: 1 },
    container: { ...COLUMN, flexGrow: 1, paddingHorizontal: SPACE.xxl, paddingTop: SPACE.lg, paddingBottom: SPACE.xxl, gap: SPACE.sm },
    centered: { justifyContent: 'center', paddingTop: SPACE.xxl },
    mark: { alignSelf: 'center', marginBottom: SPACE.sm },
    title: { ...TYPE.display, color: c.text, marginTop: SPACE.sm },
    large: { ...TYPE.hero, textAlign: 'center', marginTop: 0 },
    subtitle: { ...TEXT.body, color: c.secondaryText },
    centeredText: { textAlign: 'center' },
    heading: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACE.md, marginTop: SPACE.sm },
    boxed: { padding: SPACE.lg, borderRadius: RADIUS.tile, borderCurve: 'continuous', backgroundColor: c.card, boxShadow: c.tileShadow || undefined },
    iconTile: {
      width: 52,
      height: 52,
      borderRadius: RADIUS.field,
      borderCurve: 'continuous',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.card,
      boxShadow: c.tileShadow || undefined,
    },
    headingText: { flex: 1, gap: SPACE.xs },
    headingTitle: { marginTop: 0 },
    spaced: { marginBottom: SPACE.xxl },
    form: { gap: SPACE.md },
  });
