// Kept's badges as the brand canvas draws them (owner, 2026-10-02): a seal of two rings, set down
// crooked at −8° like the K stamp, with one glyph. Green for keeping, seal red for falling and
// getting up, ink for giving, and a dashed ring until it's earned. `BadgeTile` shows a person's
// badges in showing order (the three they chose, then the rarest; lib/badges.ts showcaseFirst()):
// three on your profile, with the way to all of them, and all of them on a friend's page.

import { router } from 'expo-router';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { StyleSheet, Text, View } from 'react-native';

import { Tile } from '@/components/tile';
import { BADGE_BY_ID, BADGES, type BadgeId, type EarnedBadge } from '@/lib/badges';
import { ICON, RADIUS, SPACE, TEXT, TYPE, useColors, useStyles, type Colors } from '@/lib/theme';

const GLYPHS: Record<BadgeId, SymbolViewProps['name']> = {
  'first-step': { ios: 'flag.fill', android: 'flag' },
  'first-check-in': { ios: 'checkmark', android: 'check' },
  'kept-it': { ios: 'checkmark.seal.fill', android: 'verified' },
  unbroken: { ios: 'shield.fill', android: 'shield' },
  'hat-trick': { ios: '3.circle.fill', android: 'looks_3' },
  'long-haul': { ios: 'mountain.2.fill', android: 'landscape' },
  century: { ios: 'rosette', android: 'military_tech' },
  'high-stakes': { ios: 'dollarsign.circle.fill', android: 'paid' },
  'in-the-open': { ios: 'eye.fill', android: 'visibility' },
  'two-at-once': { ios: 'square.fill.on.square.fill', android: 'filter_none' },
  'it-stuck': { ios: 'arrow.triangle.2.circlepath', android: 'repeat' },
  'well-rounded': { ios: 'square.stack.3d.up.fill', android: 'layers' },
  'ten-kept': { ios: '10.circle.fill', android: 'military_tech' },
  'full-year': { ios: 'calendar.badge.checkmark', android: 'event_available' },
  'first-fall': { ios: 'arrow.down.to.line', android: 'vertical_align_bottom' },
  'back-on-your-feet': { ios: 'arrow.up.to.line', android: 'vertical_align_top' },
  'close-call': { ios: 'shield.slash.fill', android: 'remove_moderator' },
  'unfinished-business': { ios: 'arrow.uturn.backward.circle.fill', android: 'replay' },
  'second-wind': { ios: 'arrow.clockwise', android: 'refresh' },
  'good-for-a-cause': { ios: 'heart.fill', android: 'favorite' },
  'in-your-corner': { ios: 'person.2.fill', android: 'group' },
  'always-there': { ios: 'person.3.fill', android: 'groups' },
  'clean-sweep': { ios: 'sparkles', android: 'auto_awesome' },
  'full-range': { ios: 'circle.hexagongrid.fill', android: 'hive' },
  'against-the-odds': { ios: 'flame.fill', android: 'local_fire_department' },
  patron: { ios: 'crown.fill', android: 'workspace_premium' },
  'paying-it-forward': { ios: 'arrow.forward.circle.fill', android: 'arrow_circle_right' },
};

const MYSTERY: SymbolViewProps['name'] = { ios: 'questionmark', android: 'question_mark' };

/**
 * One badge's seal; `earned` false draws it dashed and grey, and a secret one not yet earned shows a
 * question mark instead of its glyph, so the rare ones keep their surprise. Decorative: its name is beside it.
 */
export function BadgeSeal({ id, earned = true, size = 64 }: { id: BadgeId; earned?: boolean; size?: number }) {
  const c = useColors();
  const [paper, ink] = earned
    ? { kept: [c.selected, c.stamp], fall: [c.alertWash, c.error], give: [c.card, c.text] }[BADGE_BY_ID.get(id)!.tone]
    : ['transparent', c.chevron];
  const ring = Math.max(2, Math.round(size / 22));
  return (
    <View
      style={{ width: size, height: size, transform: [{ rotate: '-8deg' }] }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View
        style={[
          styles.circle,
          { borderRadius: size / 2, borderWidth: ring, borderColor: ink, backgroundColor: paper, borderStyle: earned ? 'solid' : 'dashed' },
        ]}
      >
        {earned && <View style={[styles.inner, { borderRadius: size / 2, borderColor: ink, margin: size * 0.08 }]} />}
        <SymbolView name={!earned && BADGE_BY_ID.get(id)!.secret ? MYSTERY : GLYPHS[id]} size={size * 0.4} tintColor={ink} />
      </View>
    </View>
  );
}

/**
 * A person's badges as a tile: a heading with how many of the set they hold, their badges (the
 * first `limit`, in showing order), and a way to the Badges page: yours, or a friend's (`of`, T210). Empty, it says how the first one is earned.
 */
export function BadgeTile({
  earned,
  limit,
  seeAll = false,
  of,
  invite = false,
}: {
  earned: EarnedBadge[];
  limit?: number;
  seeAll?: boolean;
  /** A friend whose badges these are; See all opens theirs. */
  of?: { id: string; username: string };
  /** The showcase isn't chosen yet: say the rarest are showing and invite choosing (your own profile only). */
  invite?: boolean;
}) {
  const styles = useStyles(makeStyles);
  const colors = useColors();
  const shown = limit ? earned.slice(0, limit) : earned;
  // Equal columns, so the seals fill the tile with no empty end (owner, 2026-10-03): your profile's three
  // across the width; a friend's page, four to a row with the last row centered.
  const column = { width: `${100 / Math.max(1, Math.min(shown.length, limit ?? 4))}%` as const };
  return (
    <Tile
      onPress={seeAll ? () => router.push(of ? { pathname: '/badges', params: { friend: of.id, username: of.username } } : '/badges') : undefined}
      accessibilityLabel={`Badges, ${earned.length} of ${BADGES.length}`}
      accessibilityHint={invite ? 'Opens all badges, to choose the three on your profile' : seeAll ? 'Opens all badges' : undefined}
    >
      <View style={styles.head}>
        <Text style={styles.title} accessibilityRole="header">
          Earned badges
        </Text>
        <Text style={styles.count}>
          {earned.length} of {BADGES.length}
        </Text>
      </View>
      {shown.length > 0 ? (
        <View style={styles.row}>
          {shown.map((b) => (
            <View key={b.id} style={[styles.badge, column]} accessible accessibilityLabel={BADGE_BY_ID.get(b.id)!.name}>
              <BadgeSeal id={b.id} size={68} />
              <Text style={styles.name} numberOfLines={2}>
                {BADGE_BY_ID.get(b.id)!.name}
              </Text>
            </View>
          ))}
        </View>
      ) : (
        <Text style={styles.empty}>Badges come from staked challenges: get past Day 1 of one to earn the first.</Text>
      )}
      {invite ? (
        <View style={styles.invite}>
          <Text style={styles.inviteText}>Showing your rarest. Choose the three on your profile</Text>
        </View>
      ) : (
        seeAll && (
          <View style={styles.seeAll}>
            <Text style={styles.link}>See all badges</Text>
            <SymbolView name={{ ios: 'chevron.right', android: 'chevron_right' }} size={ICON.inline - 3} weight="semibold" tintColor={colors.secondaryText} />
          </View>
        )
      )}
    </Tile>
  );
}

const styles = StyleSheet.create({
  circle: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  inner: { ...StyleSheet.absoluteFill, borderWidth: 1 },
});

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
    title: { ...TYPE.title, color: c.text },
    count: { ...TEXT.caption, color: c.secondaryText },
    row: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', rowGap: SPACE.md },
    badge: { alignItems: 'center', gap: SPACE.xs, paddingHorizontal: SPACE.xs },
    name: { ...TEXT.caption, color: c.text, textAlign: 'center' },
    empty: { ...TEXT.note, color: c.secondaryText },
    link: { ...TEXT.body, color: c.secondaryText },
    seeAll: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm },
    invite: { alignSelf: 'flex-start', paddingVertical: SPACE.sm, paddingHorizontal: SPACE.md, borderRadius: RADIUS.pill, backgroundColor: c.selected },
    inviteText: { ...TEXT.note, color: c.link, fontWeight: '600' },
  });
