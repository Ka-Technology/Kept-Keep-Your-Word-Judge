// The code entry on the verify screen: one box per digit, like iOS's own code screens. A single
// see-through text box on top takes the typing and every touch, so a long press (or a second tap) brings up
// iOS's own Paste, and pasting a code or tapping iOS's "From Mail" suggestion fills every box at once
// (separate text boxes per digit would break all of those). As in the A3 mockup (T116): white boxes, a dash
// in each empty one, the next one outlined in green.

import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { Button } from '@/components/button';
import { codeFromText, OTP_LENGTH } from '@/lib/auth-state';
import { fieldBox, PLACEHOLDER_COLOR, RADIUS, SPACE, TEXT, TYPE, useStyles, type Colors } from '@/lib/theme';

// Guarded, so a development build made before expo-clipboard was added still opens (the button just isn't shown).
let Clipboard: typeof import('expo-clipboard') | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Clipboard = require('expo-clipboard');
} catch {}

/** What's on the clipboard; '' when it can't be read (a build without the module, or Paste refused). */
export async function readClipboard(): Promise<string> {
  return (await Clipboard?.getStringAsync().catch(() => '')) ?? '';
}

/** "Paste code": fills the boxes from a code copied out of an authenticator app or a message, and says so if the clipboard holds none. */
export function PasteCodeButton({ onCode }: { onCode: (code: string) => void }) {
  const styles = useStyles(makeStyles);
  const [none, setNone] = useState(false);
  if (!Clipboard) return null;
  return (
    <>
      <Button
        title="Paste code"
        variant="link"
        onPress={async () => {
          const code = codeFromText(await readClipboard());
          setNone(!code);
          if (code) onCode(code);
        }}
      />
      {none && (
        <Text style={styles.note} accessibilityRole="alert">
          No {OTP_LENGTH}-digit code on your clipboard. Copy it first, then tap Paste code.
        </Text>
      )}
    </>
  );
}

/** OTP_LENGTH digit boxes. Keeps only digits, so a pasted "123 456" becomes "123456", and finds the code in a pasted sentence. Opens the keyboard on arrival. */
export function CodeInput({ value, onChangeCode }: { value: string; onChangeCode: (code: string) => void }) {
  const styles = useStyles(makeStyles);
  const [focused, setFocused] = useState(false);
  // The box the next digit goes in (the last one once all are filled) is outlined in green.
  const active = Math.min(value.length, OTP_LENGTH - 1);

  return (
    <View>
      <View style={styles.row} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {Array.from({ length: OTP_LENGTH }, (_, i) => (
          <View key={i} style={[styles.box, focused && i === active && styles.activeBox]}>
            <Text style={value[i] ? styles.digit : styles.dash}>{value[i] ?? '–'}</Text>
          </View>
        ))}
      </View>
      <TextInput
        style={[StyleSheet.absoluteFill, styles.overlay]}
        accessibilityLabel={`${OTP_LENGTH}-digit code`}
        value={value}
        onChangeText={(text) => onChangeCode((text.length > OTP_LENGTH && codeFromText(text)) || text.replace(/\D/g, '').slice(0, OTP_LENGTH))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        selectionColor="transparent"
        cursorColor="transparent"
        autoFocus
      />
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    row: { flexDirection: 'row', gap: SPACE.sm },
    // minHeight, not height, so the digit still fits at the largest text sizes.
    box: { ...fieldBox(c), flex: 1, minHeight: 60, padding: 0, borderRadius: RADIUS.card, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center' },
    activeBox: { borderColor: c.stamp, borderWidth: 2 },
    digit: { ...TYPE.number, color: c.text },
    dash: { ...TYPE.number, color: PLACEHOLDER_COLOR },
    // See-through, not opacity 0: iOS passes touches through a view at opacity 0, and with them its Paste menu.
    overlay: { color: 'transparent', backgroundColor: 'transparent', letterSpacing: 0 },
    note: { ...TEXT.note, color: c.secondaryText, textAlign: 'center' },
  });
