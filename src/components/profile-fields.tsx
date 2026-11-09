// The profile part of a form, as field cards (A3, T115): first and last name (decision 100: only the
// user sees them), username with a live "Available" (username_available(), 0011), date of birth,
// state, whether Kept's AI may check your days (decision 96: Allow or Don't allow, nothing
// preselected), and the 18+ tick box with the Terms and the Privacy Policy (decision 99, never ticked
// to start). Used by the sign-up screen and by complete-profile, so both ask for (and check) exactly
// the same things. The parent screen owns the values and decides when to show errors (see
// profileErrors() in lib/profile.ts).

import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Animated,
  Button,
  FlatList,
  Keyboard,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ErrorText } from '@/components/error-text';
import { Field } from '@/components/field';
import { Segmented } from '@/components/segmented';
import { Tile } from '@/components/tile';
import { isObjectionable } from '@/lib/moderation';
import { AI_CHOICE_MESSAGE, AI_CHOICE_TITLE } from '@/lib/privacy-note';
import { USERNAME_RE, type ProfileErrors, type ProfileInput } from '@/lib/profile';
import { shouldDismissSheet } from '@/lib/sheet';
import { supabase } from '@/lib/supabase';
import { bareInputStyle, ICON, PLACEHOLDER_COLOR, RADIUS, SPACE, TEXT, TYPE, useColors, useStyles, type Colors } from '@/lib/theme';
import { US_STATES } from '@/lib/us-states';

// Where the date wheels start before anything is picked, and the range they allow.
const START_DATE = new Date(2000, 0, 1);
const EARLIEST_DATE = new Date(1900, 0, 1);

const AI_OPTIONS = [
  { value: 'allow', label: 'Allow' },
  { value: 'deny', label: 'Don’t allow' },
] as const;

/**
 * Whether a well-formed username is free, asked a moment after typing stops (username_available(),
 * callable signed out or in). Null until there's an answer for what's typed now.
 */
function useUsernameFree(username: string): boolean | null {
  const [answer, setAnswer] = useState<{ name: string; free: boolean } | null>(null);
  const ready = USERNAME_RE.test(username) && !isObjectionable(username);
  useEffect(() => {
    if (!ready) return;
    let current = true;
    const timer = setTimeout(() => {
      supabase.rpc('username_available', { name: username }).then(({ data }) => {
        if (current && typeof data === 'boolean') setAnswer({ name: username, free: data });
      });
    }, 400);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [username, ready]);
  return ready && answer?.name === username ? answer.free : null;
}

/**
 * "✓ Available" or "Taken" for a well-formed username, a moment after typing stops; nothing until
 * then. Sign-up, complete-profile and Your username (T125) show it at the end of the username card.
 */
export function UsernameAvailability({ username }: { username: string }) {
  const styles = useStyles(makeStyles);
  const colors = useColors();
  const free = useUsernameFree(username);
  if (free === null) return null;
  return (
    <View style={styles.available} accessible accessibilityLiveRegion="polite" accessibilityLabel={free ? 'Available' : 'Taken'}>
      {free && <SymbolView name={{ ios: 'checkmark.circle.fill', android: 'check_circle' }} size={ICON.inline} tintColor={colors.success} />}
      <Text style={free ? styles.availableText : styles.takenText}>{free ? 'Available' : 'Taken'}</Text>
    </View>
  );
}

/**
 * Name, username, date of birth, state, AI and tick-box fields. `value` and `onChange` work like a
 * controlled input for all of them at once; `errors` puts a message under each field that needs fixing.
 */
export function ProfileFields({
  value,
  onChange,
  errors,
}: {
  value: ProfileInput;
  onChange: (next: ProfileInput) => void;
  errors: ProfileErrors;
}) {
  const styles = useStyles(makeStyles);
  const colors = useColors();
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showStates, setShowStates] = useState(false);

  const stateName = US_STATES.find((s) => s.code === value.stateCode)?.name;
  const dobText = value.dob?.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  const input = bareInputStyle(colors);

  /** Opens the date picker. The field shows the date the wheels start on straight away, so what you see is what's saved. */
  function openDatePicker() {
    Keyboard.dismiss(); // The wheels sit where the keyboard would be.
    const dob = value.dob ?? START_DATE;
    if (!value.dob) onChange({ ...value, dob });
    if (Platform.OS === 'android') {
      // ponytail: Android is after the demo (T13); this path is untested until then.
      DateTimePickerAndroid.open({
        value: dob,
        mode: 'date',
        maximumDate: new Date(),
        minimumDate: EARLIEST_DATE,
        onValueChange: (_event, date) => onChange({ ...value, dob: date }),
      });
    } else {
      setShowDatePicker(true);
    }
  }

  return (
    <View style={styles.group}>
      <Field icon={{ ios: 'person', android: 'person' }} label="Name" error={errors.firstName ?? errors.lastName}>
        <TextInput
          style={input}
          placeholder="First name"
          placeholderTextColor={PLACEHOLDER_COLOR}
          accessibilityLabel="First name"
          accessibilityHint="Only you see your name. It's for donation receipts."
          value={value.firstName}
          onChangeText={(firstName) => onChange({ ...value, firstName })}
          autoCapitalize="words"
          autoCorrect={false}
          autoComplete="given-name"
          textContentType="givenName"
        />
        <View style={styles.nameDivider} />
        <TextInput
          style={input}
          placeholder="Last name"
          placeholderTextColor={PLACEHOLDER_COLOR}
          accessibilityLabel="Last name"
          value={value.lastName}
          onChangeText={(lastName) => onChange({ ...value, lastName })}
          autoCapitalize="words"
          autoCorrect={false}
          autoComplete="family-name"
          textContentType="familyName"
        />
      </Field>

      <Field icon={{ ios: 'at', android: 'alternate_email' }} label="Username" error={errors.username} trailing={<UsernameAvailability username={value.username} />}>
        <TextInput
          style={input}
          placeholder="Your username"
          placeholderTextColor={PLACEHOLDER_COLOR}
          accessibilityLabel="Username"
          accessibilityHint="3 to 30 lowercase letters, numbers, periods, underscores or hyphens"
          value={value.username}
          onChangeText={(text) => onChange({ ...value, username: text.toLowerCase() })}
          autoCapitalize="none"
          autoCorrect={false}
          // iOS Passwords saves the email as the sign-in name; keep it from saving the username instead.
          autoComplete="off"
          textContentType="none"
        />
      </Field>

      <Pressable
        onPress={openDatePicker}
        accessibilityRole="button"
        accessibilityLabel={dobText ? `Date of birth, ${dobText}` : 'Date of birth'}
        accessibilityHint="Opens a date picker"
      >
        <Field icon={{ ios: 'calendar', android: 'calendar_today' }} label="Date of birth" error={errors.dob}>
          <Text style={dobText ? styles.fieldText : styles.placeholder}>{dobText ?? 'Choose your date of birth'}</Text>
        </Field>
      </Pressable>
      <DatePickerSheet
        visible={showDatePicker}
        value={value.dob ?? START_DATE}
        onChange={(dob) => onChange({ ...value, dob })}
        onDone={() => setShowDatePicker(false)}
      />

      <Pressable
        onPress={() => {
          Keyboard.dismiss();
          setShowStates(true);
        }}
        accessibilityRole="button"
        accessibilityLabel={stateName ? `State, ${stateName}` : 'State'}
        accessibilityHint="Opens the list of states"
      >
        <Field
          icon={{ ios: 'mappin.and.ellipse', android: 'location_on' }}
          label="State"
          error={errors.state}
          trailing={<SymbolView name={{ ios: 'chevron.down', android: 'expand_more' }} size={ICON.inline} tintColor={colors.secondaryText} />}
        >
          <Text style={stateName ? styles.fieldText : styles.placeholder}>{stateName ?? 'Choose your state'}</Text>
        </Field>
      </Pressable>
      <StatePicker
        visible={showStates}
        selected={value.stateCode}
        onPick={(stateCode) => {
          onChange({ ...value, stateCode });
          setShowStates(false);
        }}
        onClose={() => setShowStates(false)}
      />

      <Tile style={styles.ai}>
        <Text style={styles.aiTitle}>{AI_CHOICE_TITLE}</Text>
        <Text style={styles.aiNote}>{AI_CHOICE_MESSAGE}</Text>
        <Segmented
          label={AI_CHOICE_TITLE}
          options={AI_OPTIONS}
          value={value.aiAllowed === null ? null : value.aiAllowed ? 'allow' : 'deny'}
          onChange={(choice) => onChange({ ...value, aiAllowed: choice === 'allow' })}
        />
      </Tile>
      <ErrorText message={errors.ai} />

      <TickBox checked={value.agreed} onChange={(agreed) => onChange({ ...value, agreed })} />
      <ErrorText message={errors.agreed} />
    </View>
  );
}

/**
 * The 18+ tick box (decision 99): a 44 pt box VoiceOver reads as a checkbox, beside its sentence,
 * whose Terms and Privacy Policy open those pages. Tapping the sentence ticks it too.
 */
function TickBox({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  const styles = useStyles(makeStyles);
  const colors = useColors();
  return (
    <View style={styles.tickCard}>
      <Pressable
        style={styles.tickTarget}
        onPress={() => onChange(!checked)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        accessibilityLabel="I’m 18 or older and I agree to the Terms and the Privacy Policy"
        hitSlop={4}
      >
        <View style={[styles.box, checked && styles.boxChecked]}>
          {checked && <SymbolView name={{ ios: 'checkmark', android: 'check' }} size={ICON.inline - 3} weight="bold" tintColor={colors.onPrimary} />}
        </View>
      </Pressable>
      <Text style={styles.tickText} onPress={() => onChange(!checked)}>
        I’m 18 or older and I agree to the{' '}
        <Text style={styles.link} accessibilityRole="link" onPress={() => router.push({ pathname: '/policy/[doc]', params: { doc: 'terms' } })}>
          Terms
        </Text>{' '}
        and the{' '}
        <Text style={styles.link} accessibilityRole="link" onPress={() => router.push({ pathname: '/policy/[doc]', params: { doc: 'privacy' } })}>
          Privacy Policy
        </Text>
      </Text>
    </View>
  );
}

/**
 * A sheet that slides up from the bottom over a dimmed backdrop, like iOS 26's sheets: a grabber,
 * rounded top corners, a title and one button (Done or Cancel) at the top. The backdrop only fades, while the
 * panel slides. Tapping the dimmed area, or swiping the grabber and title down, also closes it.
 */
export function BottomPanel({
  visible,
  title,
  buttonTitle,
  onClose,
  panelStyle,
  children,
}: {
  visible: boolean;
  title: string;
  buttonTitle: string;
  onClose: () => void;
  panelStyle?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const styles = useStyles(makeStyles);
  const colors = useColors();
  const { height } = useWindowDimensions();
  // 0 = hidden, 1 = shown. Drives the backdrop's opacity and the panel's position.
  const [progress] = useState(() => new Animated.Value(0));
  // The modal stays open while the closing animation plays, then closes.
  const [mounted, setMounted] = useState(visible);
  if (visible && !mounted) setMounted(true);
  // How far a swipe has pulled the panel down, on top of the slide.
  const [drag] = useState(() => new Animated.Value(0));
  const swipe = useMemo(() => PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => g.dy > 6 && g.dy > Math.abs(g.dx),
      onPanResponderMove: (_, g) => drag.setValue(Math.max(0, g.dy)),
      onPanResponderRelease: (_, g) => {
        if (shouldDismissSheet(g.dy, g.vy)) onClose();
        else Animated.spring(drag, { toValue: 0, useNativeDriver: true }).start();
      },
      onPanResponderTerminate: () => Animated.spring(drag, { toValue: 0, useNativeDriver: true }).start(),
    }), [drag, onClose]);

  useEffect(() => {
    if (visible) drag.setValue(0);
    Animated.timing(progress, {
      toValue: visible ? 1 : 0,
      duration: visible ? 250 : 200,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished && !visible) setMounted(false);
    });
  }, [visible, progress, drag]);

  const translateY = Animated.add(progress.interpolate({ inputRange: [0, 1], outputRange: [height, 0] }), drag);

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.bottom}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.dim, { opacity: progress }]}>
          <Pressable style={styles.fill} onPress={onClose} accessibilityRole="button" accessibilityLabel={`Close ${title}`} />
        </Animated.View>
        <Animated.View style={[panelStyle, { transform: [{ translateY }] }]}>
          <SafeAreaView style={[styles.panel, panelStyle ? styles.fill : null]} edges={['bottom']}>
            <View {...swipe.panHandlers}>
              <View style={styles.grabber} />
              <View style={styles.panelHeader}>
                <Text style={styles.panelTitle} accessibilityRole="header">
                  {title}
                </Text>
                <Button title={buttonTitle} onPress={onClose} color={colors.link} />
              </View>
            </View>
            {children}
          </SafeAreaView>
        </Animated.View>
      </View>
    </Modal>
  );
}

/** The iOS date wheels in a BottomPanel with a Done button. (Android uses its own dialog instead.) */
function DatePickerSheet({
  visible,
  value,
  onChange,
  onDone,
}: {
  visible: boolean;
  value: Date;
  onChange: (date: Date) => void;
  onDone: () => void;
}) {
  const styles = useStyles(makeStyles);
  const colors = useColors();
  const dark = useColorScheme() === 'dark';
  return (
    <BottomPanel visible={visible} title="Date of birth" buttonTitle="Done" onClose={onDone}>
      <DateTimePicker
        style={styles.wheels}
        value={value}
        mode="date"
        display="spinner"
        maximumDate={new Date()}
        minimumDate={EARLIEST_DATE}
        // Match the app's mode, which Settings → Appearance can set apart from the phone's.
        themeVariant={dark ? 'dark' : 'light'}
        textColor={colors.text}
        onValueChange={(_event, date) => onChange(date)}
      />
    </BottomPanel>
  );
}

/**
 * The iOS clock dial, like an alarm's, in a BottomPanel with a Done button: a time of day to the minute, kept between
 * `from` and `to`. `children` go under the dial. (Android uses its own dialog instead.)
 */
export function TimePickerSheet({
  visible,
  title,
  value,
  from,
  to,
  onChange,
  onDone,
  children,
}: {
  visible: boolean;
  title: string;
  value: Date;
  from: Date;
  to: Date;
  onChange: (date: Date) => void;
  onDone: () => void;
  children?: ReactNode;
}) {
  const styles = useStyles(makeStyles);
  const colors = useColors();
  const dark = useColorScheme() === 'dark';
  return (
    <BottomPanel visible={visible} title={title} buttonTitle="Done" onClose={onDone}>
      <DateTimePicker
        style={styles.wheels}
        value={value}
        mode="time"
        display="spinner"
        minuteInterval={1}
        minimumDate={from}
        maximumDate={to}
        themeVariant={dark ? 'dark' : 'light'}
        textColor={colors.text}
        onValueChange={(_event, date) => onChange(date)}
      />
      {children}
    </BottomPanel>
  );
}

/** A state row's height at the phone's default text size; it grows with larger text. */
const ROW_HEIGHT = 50;

/**
 * The 50 states and DC in a half-height BottomPanel, each with its two-letter code. It opens
 * scrolled to the current pick. `onPick` gets the chosen code.
 */
export function StatePicker({
  visible,
  selected,
  onPick,
  onClose,
}: {
  visible: boolean;
  selected: string | null;
  onPick: (code: string) => void;
  onClose: () => void;
}) {
  const styles = useStyles(makeStyles);
  const colors = useColors();
  const { fontScale } = useWindowDimensions();
  const rowHeight = Math.round(ROW_HEIGHT * Math.max(1, fontScale));
  const selectedIndex = US_STATES.findIndex((s) => s.code === selected);
  return (
    <BottomPanel visible={visible} title="State" buttonTitle="Cancel" onClose={onClose} panelStyle={styles.halfPanel}>
      <FlatList
        data={US_STATES}
        keyExtractor={(s) => s.code}
        // Rows are a fixed height, so the list can open at the current pick (with two rows above it).
        getItemLayout={(_data, index) => ({ length: rowHeight, offset: rowHeight * index, index })}
        initialScrollIndex={Math.max(0, selectedIndex - 2)}
        renderItem={({ item }) => {
          const isSelected = item.code === selected;
          return (
            <Pressable
              style={[styles.row, { height: rowHeight }, isSelected && styles.selectedRow]}
              onPress={() => onPick(item.code)}
              accessibilityRole="button"
              accessibilityLabel={`${item.name}, ${item.code}`}
              accessibilityState={{ selected: isSelected }}
            >
              <Text style={styles.fieldText}>{item.name}</Text>
              <View style={styles.codeRow}>
                {isSelected && <SymbolView name={{ ios: 'checkmark', android: 'check' }} size={ICON.inline - 2} weight="semibold" tintColor={colors.link} />}
                <Text style={isSelected ? styles.selectedCode : styles.code}>{item.code}</Text>
              </View>
            </Pressable>
          );
        }}
      />
    </BottomPanel>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    group: { gap: SPACE.md },
    fieldText: { fontSize: 16, color: c.text },
    placeholder: { fontSize: 16, color: PLACEHOLDER_COLOR },
    nameDivider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch', backgroundColor: c.separator, marginHorizontal: SPACE.sm },
    available: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xxs },
    availableText: { ...TEXT.caption, color: c.success, fontWeight: '600' },
    takenText: { ...TEXT.caption, color: c.error, fontWeight: '600' },
    ai: { gap: SPACE.sm },
    tickCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACE.sm,
      paddingVertical: SPACE.sm,
      paddingRight: SPACE.lg,
      paddingLeft: SPACE.sm,
      borderRadius: RADIUS.card,
      borderCurve: 'continuous',
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.card,
    },
    tickTarget: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    box: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: c.border, alignItems: 'center', justifyContent: 'center' },
    boxChecked: { backgroundColor: c.stamp, borderColor: c.stamp },
    tickText: { ...TEXT.note, flex: 1, color: c.text },
    link: { color: c.link, fontWeight: '600', textDecorationLine: 'underline' },
    aiTitle: { ...TYPE.section, color: c.text },
    aiNote: { ...TEXT.note, color: c.secondaryText },
    bottom: { flex: 1, justifyContent: 'flex-end' },
    dim: { backgroundColor: c.scrim },
    fill: { flex: 1 },
    panel: { backgroundColor: c.elevated, borderTopLeftRadius: RADIUS.tile + 4, borderTopRightRadius: RADIUS.tile + 4, borderCurve: 'continuous' },
    grabber: { alignSelf: 'center', width: 36, height: 5, borderRadius: RADIUS.pill, backgroundColor: c.dot, marginTop: SPACE.sm },
    halfPanel: { height: '55%' },
    panelHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: SPACE.lg,
      paddingVertical: SPACE.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.separator,
    },
    panelTitle: { ...TYPE.section, color: c.text },
    // The native wheels have a fixed width; center them in the panel.
    wheels: { alignSelf: 'center' },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: SPACE.lg,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.separator,
    },
    selectedRow: { backgroundColor: c.selected },
    codeRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs },
    code: { ...TEXT.note, color: c.valueText },
    selectedCode: { ...TEXT.note, color: c.link, fontWeight: '600' },
  });
