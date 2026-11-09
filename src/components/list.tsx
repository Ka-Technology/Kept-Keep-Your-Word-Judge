// Grouped lists: rounded sheets on the paper, each row a label with an optional value on the right,
// and a chevron when tapping it opens another screen. A row's icon is an outline icon in ink, as in
// the A3 mockups (T101); a destructive row (Quit challenge, Sign out) is red, icon and all; a row
// can carry a switch. A group's heading is a sentence-case heading in the display font, not an
// iOS-style small-caps label.

import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { InfoButton } from '@/components/info-button';
import { COLUMN, ICON, RADIUS, SPACE, TEXT, TYPE, WHITE, useColors, useStyles, type Colors } from '@/lib/theme';

/** A scrolling screen of grouped lists on the paper, like Settings and its pages. */
export function ListScreen({ children }: { children: ReactNode }) {
  const styles = useStyles(makeStyles);
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.screenContent} contentInsetAdjustmentBehavior="automatic">
      {children}
    </ScrollView>
  );
}

/**
 * A group of rows, with an optional small heading above and a note below. `titleInside` puts the
 * heading inside the card instead, large, with an optional outline `titleIcon` before it (A3: "Review
 * for friends", "Stakes", "Requests").
 */
export function ListSection({
  title,
  footer,
  children,
  titleInside = false,
  titleIcon,
  onInfo,
}: {
  title?: string;
  footer?: string;
  children: ReactNode;
  titleInside?: boolean;
  titleIcon?: SymbolViewProps['name'];
  /** Puts an (i) after the heading; tapping it should explain the section (an Alert is enough). */
  onInfo?: () => void;
}) {
  const styles = useStyles(makeStyles);
  const colors = useColors();
  const info = title && onInfo ? <InfoButton label={`About ${title}`} onPress={onInfo} /> : null;
  return (
    <View style={styles.section}>
      {title && !titleInside && (
        <View style={styles.outsideHead}>
          <Text style={styles.title} accessibilityRole="header">
            {title}
          </Text>
          {info}
        </View>
      )}
      <View style={styles.group}>
        {title && titleInside && (
          <View style={styles.insideHead}>
            {titleIcon && <SymbolView name={titleIcon} size={ICON.hero} tintColor={colors.text} />}
            <Text style={styles.insideTitle} accessibilityRole="header">
              {title}
            </Text>
            {info}
          </View>
        )}
        {children}
      </View>
      {footer && <Text style={styles.footer}>{footer}</Text>}
    </View>
  );
}

/** A chevron for rows and cards that open another screen; decorative, so VoiceOver skips it. */
export function Chevron() {
  const colors = useColors();
  return <SymbolView name={{ ios: 'chevron.right', android: 'chevron_right' }} size={ICON.inline - 3} weight="semibold" tintColor={colors.chevron} />;
}

/**
 * One row. With `onPress` it's a button showing a chevron (none when it's `destructive`); without, it just shows `value`.
 * `selected` makes it one choice of several (a report's reason, T140): a radio circle leads the row,
 * filled green on the chosen one, and VoiceOver reads it as a radio button.
 * `detail` adds a smaller second line under the label (e.g. a charity's purpose); `icon` adds a
 * symbol on the left in a tinted square (e.g. Settings' categories), and `leading` anything else
 * there (e.g. a photo). `badge` shows a red count before the chevron, like iOS Settings (e.g.
 * friend requests waiting). `destructive` makes the label and icon red (Quit challenge). `toggle`
 * puts the phone's switch at the end instead of a chevron; the row itself is then not a button. Every
 * row but a section's first draws a hairline above itself (`first` turns it off). `overline` puts a
 * small label above the label, which then reads as a bold value (A3, T128: "Name" over "Sam Lee"), and
 * `locked` ends the row with a lock (a date of birth that can't change).
 */
export function ListRow({
  label,
  icon,
  leading,
  detail,
  value,
  onPress,
  selected,
  badge,
  destructive = false,
  toggle,
  first = false,
  overline,
  locked = false,
}: {
  label: string;
  icon?: SymbolViewProps['name'];
  leading?: ReactNode;
  detail?: string;
  value?: string;
  onPress?: () => void;
  selected?: boolean;
  badge?: number;
  destructive?: boolean;
  toggle?: { value: boolean; onValueChange: (value: boolean) => void; disabled?: boolean };
  first?: boolean;
  overline?: string;
  locked?: boolean;
}) {
  const styles = useStyles(makeStyles);
  const colors = useColors();
  const choice = selected !== undefined;
  const a11yLabel = [overline, label, detail, value, badge ? `${badge} new` : undefined, locked ? "can't be changed" : undefined].filter(Boolean).join(', ');
  const labelStyle = [styles.label, destructive && styles.destructive];
  const content = (
    <>
      {choice && (
        <SymbolView
          name={selected ? { ios: 'largecircle.fill.circle', android: 'radio_button_checked' } : { ios: 'circle', android: 'radio_button_unchecked' }}
          size={ICON.row}
          tintColor={selected ? colors.stamp : colors.chevron}
        />
      )}
      {leading}
      {icon && (
        <View style={styles.icon}>
          <SymbolView name={icon} size={ICON.row} tintColor={destructive ? colors.error : colors.text} />
        </View>
      )}
      {overline ? (
        <View style={styles.labels}>
          <Text style={styles.overline}>{overline}</Text>
          <Text style={[labelStyle, styles.strong]}>{label}</Text>
        </View>
      ) : detail ? (
        <View style={styles.labels}>
          <Text style={labelStyle}>{label}</Text>
          <Text style={styles.detail}>{detail}</Text>
        </View>
      ) : (
        <Text style={labelStyle}>{label}</Text>
      )}
      {value !== undefined && (
        <Text style={styles.value} numberOfLines={1}>
          {value}
        </Text>
      )}
      {locked && (
        <View style={styles.end}>
          <SymbolView name={{ ios: 'lock', android: 'lock' }} size={ICON.inline} tintColor={colors.secondaryText} />
        </View>
      )}
      {!!badge && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge}</Text>
        </View>
      )}
      {/* An action that cancels or removes something doesn't open a screen, so it has no chevron (owner, 2026-10-26). */}
      {!choice && onPress && !destructive && (
        <View style={[styles.end, !!badge && styles.afterBadge]}>
          <Chevron />
        </View>
      )}
    </>
  );

  if (toggle) {
    // VoiceOver reaches the switch, named by the row; the row's own text is only for the eye.
    return (
      <View style={[styles.row, !first && styles.divider]}>
        <View style={styles.toggleLabel} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {content}
        </View>
        <Switch
          value={toggle.value}
          onValueChange={toggle.onValueChange}
          disabled={toggle.disabled}
          accessibilityLabel={a11yLabel}
          trackColor={{ true: colors.link }}
        />
      </View>
    );
  }
  if (!onPress) {
    return (
      <View style={[styles.row, !first && styles.divider]} accessible accessibilityLabel={a11yLabel}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      style={({ pressed }) => [styles.row, !first && styles.divider, pressed && styles.pressed]}
      onPress={onPress}
      accessibilityRole={choice ? 'radio' : 'button'}
      accessibilityLabel={a11yLabel}
      accessibilityState={choice ? { checked: selected } : undefined}
    >
      {content}
    </Pressable>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.groupedBackground },
    screenContent: { ...COLUMN, padding: SPACE.lg, gap: SPACE.xxl },
    section: { gap: SPACE.sm },
    outsideHead: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm },
    title: { ...TYPE.section, color: c.text, marginLeft: SPACE.xs },
    group: { backgroundColor: c.card, borderRadius: RADIUS.tile, borderCurve: 'continuous', overflow: 'hidden', boxShadow: c.tileShadow || undefined },
    footer: { ...TEXT.caption, color: c.secondaryText, marginHorizontal: SPACE.sm },
    insideHead: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, paddingHorizontal: SPACE.lg, paddingTop: SPACE.lg, paddingBottom: SPACE.xs },
    insideTitle: { ...TYPE.title, color: c.text, flex: 1 },
    row: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: SPACE.md, paddingHorizontal: SPACE.lg, paddingVertical: SPACE.md },
    divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.separator },
    pressed: { backgroundColor: c.pressed },
    icon: { width: 28, alignItems: 'center' },
    label: { ...TEXT.row, color: c.text },
    destructive: { color: c.error },
    toggleLabel: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: SPACE.md },
    labels: { flex: 1, gap: SPACE.xxs },
    detail: { ...TEXT.note, color: c.secondaryText },
    overline: { ...TEXT.caption, color: c.secondaryText },
    strong: { fontWeight: '700' },
    value: { ...TEXT.row, flex: 1, color: c.valueText, textAlign: 'right' },
    end: { marginLeft: 'auto' },
    // The seal red, like the tab bar's badge.
    badge: { marginLeft: 'auto', minWidth: 22, height: 22, borderRadius: RADIUS.pill, paddingHorizontal: 6, backgroundColor: c.error, alignItems: 'center', justifyContent: 'center' },
    badgeText: { ...TEXT.caption, color: WHITE, fontWeight: '600' },
    afterBadge: { marginLeft: 0 },
  });
