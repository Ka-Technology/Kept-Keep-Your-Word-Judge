// Official rules screen, opened from Settings. Placeholder text drawn from SPEC.md until counsel
// writes the real rules (SPEC.md open question 5). It must always say that Kept is the sponsor
// and Apple is not (App Store guideline 5.3). As in the A3 mockup since T127
// (full-set/ui-push-8-rules.jpg): each rule a card with an outline icon in a square, and "Apple is not
// a sponsor of Kept." at the end too.

import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { PageTitle } from '@/components/tab-title';
import { Tile } from '@/components/tile';
import { STAKE_LIMITS } from '@/lib/challenges';
import { KEPT_CREDITS_EXPLAINED } from '@/lib/pledges';
import { COLUMN, ICON, RADIUS, SPACE, TEXT, TYPE, useColors, useStyles, type Colors } from '@/lib/theme';

/** Each rule as a heading, a paragraph and its icon. */
const RULES: { heading: string; body: string; icon: SymbolViewProps['name'] }[] = [
  {
    heading: 'Sponsor',
    icon: { ios: 'building.columns', android: 'account_balance' },
    body: 'Kept is the sole sponsor of every challenge. Apple is not a sponsor of, and is not involved in any way with, Kept or its challenges.',
  },
  {
    heading: 'Who can take part',
    icon: { ios: 'person', android: 'person' },
    body: 'You must be 18 or older and live in the United States.',
  },
  {
    heading: 'How a challenge works',
    icon: { ios: 'camera', android: 'photo_camera' },
    body: 'You pick a habit, a length (28 completed days by default), a stake and a charity (one of Kept’s choices, or any US nonprofit found through Every.org). Day 1 is the day after you sign: the day you sign is for setting up, so a challenge started late at night can’t cost you a day. Each day you check in, and friends who back your challenge confirm it. If none has by the deadline and you allow Kept’s AI, it checks the day; if you don’t allow it, a day none of them confirms by midnight counts as missed. You agree to each challenge separately, and nothing renews by itself.',
  },
  {
    heading: 'Missed days',
    icon: { ios: 'shield', android: 'shield' },
    body: 'Every challenge has 2 shields. A missed day breaks one and adds a day to the end. A miss with no shield left ends the challenge as not finished, unless you buy a shield the next day to keep going: up to 3, at 20%, 40% and 60% of your stake, half to your charity and half to Kept. Friends and backers see which missed days you bought back.',
  },
  {
    heading: 'Where the money goes',
    icon: { ios: 'heart', android: 'favorite_border' },
    body: 'Finish and your stake comes back in full, and the pledges behind you are your reward, except any whose pledger chose your charity instead. If you don’t finish, your stake goes to your charity and your supporters get their pledges back, unless they choose to donate. Kept makes the gift in its own name, so you get no tax receipt for it; your Wallet records it as given for you. Kept’s revenue is the service fee and half of any shield you buy. A backer’s Kept credits never exceed the fee they paid. Kept charges a service fee on top of your stake, and on top of each pledge, shown to the cent with the total before you sign or pledge, and keeps it either way.',
  },
  {
    heading: 'Kept credits',
    icon: { ios: 'ticket', android: 'confirmation_number' },
    body: KEPT_CREDITS_EXPLAINED,
  },
  {
    heading: 'Limits',
    icon: { ios: 'cylinder.split.1x2', android: 'savings' },
    body: `At least $${STAKE_LIMITS.minDollars} per challenge, up to $${STAKE_LIMITS.firstChallengeMaxDollars} for your first, and $${STAKE_LIMITS.outstandingMaxDollars} staked at once across your challenges.`,
  },
];

export default function Rules() {
  const styles = useStyles(makeStyles);
  const colors = useColors();
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container} contentInsetAdjustmentBehavior="automatic">
      <PageTitle title="Official rules" />
      {RULES.map(({ heading, body, icon }) => (
        <Tile key={heading} style={styles.rule}>
          <View style={styles.icon}>
            <SymbolView name={icon} size={ICON.row} tintColor={colors.text} />
          </View>
          <View style={styles.text}>
            <Text style={styles.heading} accessibilityRole="header">
              {heading}
            </Text>
            <Text style={styles.body}>{body}</Text>
          </View>
        </Tile>
      ))}
      <Text style={styles.apple}>Apple is not a sponsor of Kept.</Text>
    </ScrollView>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.groupedBackground },
    container: { ...COLUMN, padding: SPACE.lg, gap: SPACE.md },
    rule: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: SPACE.lg,
      padding: SPACE.lg,
    },
    icon: {
      width: 48,
      height: 48,
      borderRadius: RADIUS.field,
      borderCurve: 'continuous',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.groupedBackground,
    },
    text: { flex: 1, gap: SPACE.xs },
    heading: { ...TYPE.title, color: c.text },
    body: { ...TEXT.body, color: c.secondaryText },
    apple: { ...TEXT.caption, color: c.secondaryText, textAlign: 'center', marginTop: SPACE.md },
  });
