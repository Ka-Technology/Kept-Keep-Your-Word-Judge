// The new-password part of a form: a password box and a confirm box, each with an eye to show it
// (PasswordInput, T85), and a live checklist of the password rules. Used by sign-up, reset-password
// and change-password.
// The parent screen owns the values; isStrongPassword() and a match check decide if they can be sent.

import { SymbolView } from 'expo-symbols';
import { useRef, useState, type Ref } from 'react';
import { StyleSheet, Text, View, type TextInputInstance } from 'react-native';

import { PasswordInput } from '@/components/password-input';
import { PASSWORD_MISMATCH_MESSAGE, passwordChecks } from '@/lib/auth-state';
import { ICON, SPACE, TEXT, useColors, useStyles, type Colors } from '@/lib/theme';

/**
 * Password + confirm-password boxes. The checklist appears once typing starts and ticks off each
 * rule as it's met. `showErrors` (set after a submit attempt) turns unmet rules and a mismatch red.
 */
export function NewPasswordFields({
  password,
  confirm,
  onChangePassword,
  onChangeConfirm,
  showErrors,
  passwordRef,
  label = 'Password',
}: {
  password: string;
  confirm: string;
  onChangePassword: (text: string) => void;
  onChangeConfirm: (text: string) => void;
  showErrors: boolean;
  /** Lets the screen move focus here, e.g. from the email box's Next key. */
  passwordRef?: Ref<TextInputInstance>;
  /** The first card's label: "New password" when one replaces another (T118). */
  label?: string;
}) {
  const styles = useStyles(makeStyles);
  const colors = useColors();
  const [confirmChecked, setConfirmChecked] = useState(false);
  const confirmRef = useRef<TextInputInstance>(null);

  const mismatch = (confirmChecked || showErrors) && confirm !== '' && confirm !== password;
  const missingConfirm = showErrors && confirm === '';

  return (
    <View style={styles.group}>
      <PasswordInput
        ref={passwordRef}
        label={label}
        placeholder="At least 8 characters"
        accessibilityLabel={label}
        value={password}
        onChangeText={onChangePassword}
        autoComplete="new-password"
        textContentType="newPassword"
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => confirmRef.current?.focus()}
      />

      {(password !== '' || showErrors) && (
        <View accessibilityRole="summary">
          {passwordChecks(password).map(({ rule, met }) => (
            <View key={rule} style={styles.rule} accessible accessibilityLabel={`${rule}, ${met ? 'done' : 'not yet'}`}>
              <SymbolView
                name={met ? { ios: 'checkmark.circle.fill', android: 'check_circle' } : { ios: 'circle', android: 'radio_button_unchecked' }}
                size={ICON.inline - 2}
                tintColor={met ? colors.success : showErrors ? colors.error : colors.secondaryText}
              />
              <Text style={met ? styles.met : showErrors ? styles.error : styles.unmet}>{rule}</Text>
            </View>
          ))}
        </View>
      )}

      <PasswordInput
        ref={confirmRef}
        label="Confirm password"
        placeholder="Type it again"
        accessibilityLabel="Confirm password"
        value={confirm}
        onChangeText={onChangeConfirm}
        autoComplete="new-password"
        textContentType="newPassword"
        onBlur={() => setConfirmChecked(true)}
      />
      {(mismatch || missingConfirm) && (
        <Text style={styles.error} accessibilityRole="alert">
          {missingConfirm ? 'Type your password again to confirm it.' : PASSWORD_MISMATCH_MESSAGE}
        </Text>
      )}
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    group: { gap: SPACE.md },
    rule: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs },
    met: { ...TEXT.note, color: c.success },
    unmet: { ...TEXT.note, color: c.secondaryText },
    error: { ...TEXT.note, color: c.error },
  });
