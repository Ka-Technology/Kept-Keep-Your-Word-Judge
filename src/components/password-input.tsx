// A password box with an eye button that shows or hides what's typed (T85, plan.md decision 92), as a
// field card with a lock (A3, T114). Used by sign-in, change-password and NewPasswordFields (sign-up
// and reset-password); each box has its own eye.

import { SymbolView } from 'expo-symbols';
import { useState, type Ref } from 'react';
import { Pressable, StyleSheet, TextInput, type TextInputInstance, type TextInputProps } from 'react-native';

import { Field } from '@/components/field';
import { bareInputStyle, ICON, PLACEHOLDER_COLOR, useColors } from '@/lib/theme';

/**
 * A text box for a password, hidden until the eye is tapped. Takes TextInput's props (label,
 * value, autofill hints, keys); `secureTextEntry` is the eye's to decide. `label` puts a small label
 * over it (sign-up's "Password").
 */
export function PasswordInput({
  ref,
  label,
  ...props
}: Omit<TextInputProps, 'secureTextEntry' | 'style'> & { ref?: Ref<TextInputInstance>; label?: string }) {
  const colors = useColors();
  const [visible, setVisible] = useState(false);

  const eye = (
    <Pressable
      style={styles.eye}
      onPress={() => setVisible((v) => !v)}
      accessibilityRole="button"
      accessibilityLabel={visible ? 'Hide password' : 'Show password'}
      hitSlop={8}
    >
      <SymbolView
        name={visible ? { ios: 'eye.slash', android: 'visibility_off' } : { ios: 'eye', android: 'visibility' }}
        size={ICON.row}
        tintColor={colors.secondaryText}
      />
    </Pressable>
  );

  return (
    <Field icon={{ ios: 'lock', android: 'lock' }} label={label} trailing={eye}>
      <TextInput
        ref={ref}
        style={bareInputStyle(colors)}
        placeholderTextColor={PLACEHOLDER_COLOR}
        autoCapitalize="none"
        autoCorrect={false}
        {...props}
        secureTextEntry={!visible}
      />
    </Field>
  );
}

const styles = StyleSheet.create({
  eye: { paddingVertical: 6, paddingLeft: 6 },
});
