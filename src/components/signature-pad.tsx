// The sign step's signature (T203, plan.md decision 171): drawn with a finger, or "Use my name instead" to adopt
// the full name in script, as DocuSign does. The pad is 3:1, the shape of the box a drawn signature is stored in
// (signaturePath(), src/lib/signature.ts), so SignatureMark draws it back the same anywhere. While a finger is
// down the step can't scroll (`onDrawing`), or a stroke down the pad would move the page instead. VoiceOver can't
// draw, so the pad reads as one element and points to the adopt button.

import { useMemo, useState } from 'react';
import { PanResponder, Platform, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { Button } from '@/components/button';
import { SIGNATURE_BOX, SIGNATURE_PATH_MAX, signaturePath, type Point } from '@/lib/signature';
import { RADIUS, SPACE, TEXT, TYPE, useColors, useStyles, type Colors } from '@/lib/theme';

export type Signature = { kind: 'drawn'; strokes: string } | { kind: 'adopted' };

/** The ink of a signature, filling its box: the drawn path, or the name in script. */
function Ink({ strokes, adoptedName }: { strokes: string; adoptedName?: string }) {
  const styles = useStyles(makeStyles);
  const colors = useColors();
  if (adoptedName) {
    return (
      <Text style={styles.adopted} numberOfLines={1} adjustsFontSizeToFit>
        {adoptedName}
      </Text>
    );
  }
  return (
    <Svg viewBox={`0 0 ${SIGNATURE_BOX.width} ${SIGNATURE_BOX.height}`} style={StyleSheet.absoluteFill}>
      <Path d={strokes} stroke={colors.text} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Svg>
  );
}

/** A signature as it was signed, for reading back (Your signed promise, T204). */
export function SignatureMark({ signature, name }: { signature: Signature; name: string }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.box} accessible accessibilityLabel={signature.kind === 'drawn' ? `Signature, drawn by ${name}` : `Signature: ${name}`}>
      <Ink strokes={signature.kind === 'drawn' ? signature.strokes : ''} adoptedName={signature.kind === 'adopted' ? name : undefined} />
    </View>
  );
}

/**
 * The strokes a finger draws on a pad: each touch adds a point, each new touch a stroke, and the ink so far goes to
 * `onInk` as a path. A path that would pass what the database keeps takes no more points. Lifting the finger signs
 * with the drawing. Outside the component, since its handlers only run on touches.
 */
function drawGesture(onInk: (path: string) => void, onDrawing: (drawing: boolean) => void, onSigned: (signature: Signature) => void) {
  let size = { width: 1, height: 1 };
  let strokes: Point[][] = [];
  let path = '';
  const at = (e: GestureResponderEvent): Point => ({ x: e.nativeEvent.locationX, y: e.nativeEvent.locationY });
  const add = (point: Point, newStroke: boolean) => {
    const next = newStroke ? [...strokes, [point]] : [...strokes.slice(0, -1), [...(strokes.at(-1) ?? []), point]];
    const d = signaturePath(next, size.width, size.height);
    if (d.length > SIGNATURE_PATH_MAX) return;
    strokes = next;
    path = d;
    onInk(d);
  };
  const finish = () => {
    onDrawing(false);
    if (path) onSigned({ kind: 'drawn', strokes: path });
  };
  const handlers = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => {
      onDrawing(true);
      add(at(e), true);
    },
    onPanResponderMove: (e) => add(at(e), false),
    onPanResponderRelease: finish,
    onPanResponderTerminate: finish,
  }).panHandlers;
  return {
    handlers,
    resize: (width: number, height: number) => (size = { width, height }),
    clear: () => {
      strokes = [];
      path = '';
      onInk('');
    },
  };
}

export function SignaturePad({
  name,
  value,
  onChange,
  onDrawing,
}: {
  /** The full name the adopted signature shows. */
  name: string;
  value: Signature | null;
  /** Kept stable (a state setter), or a new one would drop the strokes drawn so far. */
  onChange: (signature: Signature | null) => void;
  /** True while a finger is on the pad; also stable. */
  onDrawing: (drawing: boolean) => void;
}) {
  const styles = useStyles(makeStyles);
  const [path, setPath] = useState('');
  const gesture = useMemo(() => drawGesture(setPath, onDrawing, onChange), [onDrawing, onChange]);

  function clear() {
    gesture.clear();
    onChange(null);
  }

  function adopt() {
    gesture.clear();
    onChange({ kind: 'adopted' });
  }

  const adopted = value?.kind === 'adopted';
  return (
    <View style={styles.pad}>
      <View
        style={styles.box}
        onLayout={(e) => gesture.resize(e.nativeEvent.layout.width, e.nativeEvent.layout.height)}
        {...gesture.handlers}
        accessible
        accessibilityLabel={value ? (adopted ? `Signed: ${name}` : 'Signed with your drawn signature') : 'Signature pad'}
        accessibilityHint={value ? undefined : 'Draw your signature with one finger, or use your name instead, below.'}
      >
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <Ink strokes={path} adoptedName={adopted ? name : undefined} />
          {!value && !path && <Text style={styles.hint}>Sign here with your finger</Text>}
        </View>
      </View>
      <View style={styles.actions}>
        {!adopted && <Button variant="link" title="Use my name instead" onPress={adopt} />}
        {(!!value || !!path) && <Button variant="link" title="Clear" onPress={clear} />}
      </View>
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    pad: { gap: SPACE.xs },
    box: { aspectRatio: SIGNATURE_BOX.width / SIGNATURE_BOX.height, borderRadius: RADIUS.field, backgroundColor: c.background, justifyContent: 'center', overflow: 'hidden' },
    hint: { ...TEXT.caption, color: c.secondaryText, textAlign: 'center', marginTop: 'auto', marginBottom: 'auto' },
    // Handwriting-style font on iPhone (built into iOS), as the typed signature had.
    adopted: {
      fontSize: TYPE.title.fontSize * 1.4,
      color: c.text,
      textAlign: 'center',
      paddingHorizontal: SPACE.lg,
      marginTop: 'auto',
      marginBottom: 'auto',
      fontFamily: Platform.select({ ios: 'Snell Roundhand', default: undefined }),
      fontStyle: Platform.OS === 'ios' ? 'normal' : 'italic',
    },
    actions: { flexDirection: 'row', justifyContent: 'space-between' },
  });
