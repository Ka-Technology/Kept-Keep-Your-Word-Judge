// The finish card (T20): a 9:16 picture made for Instagram Stories and the like. The results screen
// of a finished challenge shows it, and Share snapshots it (react-native-view-shot) for the phone's
// share sheet. It's Kept's promise, kept: ink paper with the same green day box the stamp card
// uses, the days and the habit in the display font, and the challenger's signature. It looks the
// same in light and dark mode, since it becomes an image. No amounts: the money in the demo is pretend.

import type { Ref } from 'react';
import { Platform, StyleSheet, Text, View, type TextProps, type ViewInstance } from 'react-native';

import { DayStamp } from '@/components/big-stamp';
import { finishShieldsLine, type ChallengeSummary } from '@/lib/challenges';
import { FONTS } from '@/lib/theme';

// Fixed colors: the card is a picture, not a screen. Ink paper, warm paper text, the night green.
const INK = '#1C2143';
const PAPER = '#F6F4EF';
const STAMP = '#5CC995';

// The picture has a fixed size, so its text doesn't grow with Text Size; VoiceOver reads the card's label instead.
const CardText = (props: TextProps) => <Text allowFontScaling={false} {...props} />;

export function FinishCard({ challenge, username, ref }: { challenge: ChallengeSummary; username: string; ref: Ref<ViewInstance> }) {
  const shields = finishShieldsLine(challenge.shieldsLeft, challenge.shieldsTotal);
  return (
    <View
      ref={ref}
      collapsable={false}
      style={styles.card}
      accessible
      accessibilityRole="image"
      accessibilityLabel={`Finish card: I kept my promise. ${challenge.lengthDays} days of ${challenge.title}. ${shields}. Signed, ${username}.`}
    >
      <CardText style={styles.wordmark}>Kept</CardText>
      <View style={styles.middle}>
        <View style={styles.stamp}>
          <DayStamp kind="kept" color={STAMP} size={112} />
        </View>
        <CardText style={styles.promise}>I kept my promise</CardText>
        <CardText style={styles.days}>{challenge.lengthDays}</CardText>
        <CardText style={styles.daysOf}>days of</CardText>
        <CardText style={styles.habit} numberOfLines={2} adjustsFontSizeToFit>
          {challenge.title}
        </CardText>
        <CardText style={styles.shields}>{shields}</CardText>
      </View>
      <View style={styles.signed}>
        <CardText style={styles.signature} numberOfLines={1} adjustsFontSizeToFit>
          {username}
        </CardText>
        <View style={styles.line} />
        <CardText style={styles.signedLabel}>Signed</CardText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '85%',
    aspectRatio: 9 / 16,
    alignSelf: 'center',
    borderRadius: 24,
    overflow: 'hidden',
    padding: 28,
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: INK,
  },
  wordmark: { color: PAPER, fontFamily: FONTS.title, fontSize: 20, letterSpacing: -0.3, opacity: 0.8 },
  middle: { alignItems: 'center', gap: 2 },
  stamp: { marginBottom: 18 },
  promise: { color: PAPER, fontFamily: FONTS.heading, fontSize: 20 },
  days: { color: PAPER, fontFamily: FONTS.heavy, fontSize: 104, lineHeight: 112, letterSpacing: -3, marginTop: 6 },
  daysOf: { color: PAPER, fontSize: 17, opacity: 0.75, marginTop: -8 },
  habit: { color: PAPER, fontFamily: FONTS.title, fontSize: 28, textAlign: 'center', marginTop: 2 },
  shields: { color: STAMP, fontFamily: FONTS.heading, fontSize: 15, marginTop: 14 },
  signed: { alignItems: 'center', alignSelf: 'stretch', gap: 4 },
  signature: { color: PAPER, fontSize: 34, fontFamily: Platform.select({ ios: 'Snell Roundhand', default: undefined }) },
  line: { alignSelf: 'stretch', height: 1, backgroundColor: PAPER, opacity: 0.35 },
  signedLabel: { color: PAPER, fontSize: 12, opacity: 0.6 },
});
