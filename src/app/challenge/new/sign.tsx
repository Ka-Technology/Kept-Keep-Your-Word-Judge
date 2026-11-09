// Start a challenge, step 5 of 5 (as in the A3 mockup since T113, full-set/sheet-new.jpg "sign"):
// the challenger chooses who can back it (off, friends only, is the default; on lets backers find it:
// `is_public`, SPEC-pledges.md decision 6), then reads their promise, one large sentence over the
// full terms, in their full name, and signs it with a finger or by adopting their name in script (T203,
// plan.md decision 171). The promise states the choice, so signing covers it. The signature and the exact
// text signed go with the challenge into challenge_signatures (0082), which only the signer reads; an
// account with no name on file adds it in Personal info first. The signature line turns green once
// signed; starting gives a success tap (owner, 2026-10-02). Then the challenge starts and opens. The promise names the
// habit and charity by their ids, never from the link, so it always names what's
// recorded (review, 2026-10-04). A stake paid from a Solana wallet (T169) then opens the wallet on its
// payment and waits for it on the challenge's Pay screen. With real cards (T93), a card stake and its fee are
// charged as it's signed; a declined card removes the challenge, and this step says why. With no card saved,
// Stripe's card form opens first, here, and signing carries on once a card is saved (owner, 2026-11-03).

import * as Haptics from 'expo-haptics';
import { Redirect, router, Stack, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { AccessibilityInfo, Linking, StyleSheet, Text, View } from 'react-native';

import { DayStamp } from '@/components/big-stamp';
import { Button } from '@/components/button';
import { ListRow, ListSection } from '@/components/list';
import { SignaturePad, type Signature } from '@/components/signature-pad';
import { LoadingScreen, StepScreen } from '@/components/step-screen';
import { Tile } from '@/components/tile';
import { useAuth } from '@/lib/auth';
import {
  challengeErrorMessage,
  contractText,
  deviceTimeZone,
  LANGUAGES,
  LEVELS,
  nameFor,
  paymentNameFor,
  solanaPayLink,
  startDate,
  type ChallengeDraft,
} from '@/lib/challenges';
import { fromDateString, fullName } from '@/lib/profile';
import { rescheduleShieldWarnings } from '@/lib/notifications';
import { CardDeclined, ensureCard, payByCard, stripeEnabled, switchCard } from '@/lib/payment-methods';
import { cardAuthorization } from '@/lib/policies';
import { supabase } from '@/lib/supabase';
import { SPACE, TEXT, TYPE, useColors, useStyles, type Colors } from '@/lib/theme';
import { useChoices } from '@/lib/use-choices';
import { must, useFocusLoad } from '@/lib/use-focus-load';

export default function SignStep() {
  const styles = useStyles(makeStyles);
  const colors = useColors();
  const draft = useLocalSearchParams<ChallengeDraft>();
  const { profile, session } = useAuth();
  const [signature, setSignature] = useState<Signature | null>(null);
  // While a finger is on the pad, the step holds still.
  const [drawing, setDrawing] = useState(false);
  // Private unless the challenger opts in (SPEC.md: never preselect a public setting).
  const [isPublic, setIsPublic] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // The card was declined: the challenge is gone, and the signature stays, so another card or way to pay can follow.
  const [declined, setDeclined] = useState(false);
  // Read synchronously, so a double tap can't start two challenges.
  const inFlight = useRef(false);
  const habits = useChoices('habits');
  // The chosen charity's name, by its id: one of Kept's picks, or a nonprofit picked from an Every.org search.
  const charity = useFocusLoad(
    async () => ({ name: must(await supabase.from('charities').select('name').eq('id', draft.charityId!).maybeSingle())?.name ?? null }),
    draft.charityId,
  );

  // Opened without the earlier steps (e.g. an old link): start from the first step.
  if (!draft.habitId || !draft.days || !draft.stake || !draft.charityId || !profile) {
    return <Redirect href="/challenge/new/habit" />;
  }
  if (!habits.choices || !charity.data) {
    return <LoadingScreen failed={habits.failed || charity.failed} onRetry={() => (habits.retry(), charity.reload())} />;
  }
  const habitName = habits.choices.find((h) => h.id === draft.habitId)?.name;
  const charityName = charity.data.name;
  if (!habitName || !charityName) return <Redirect href="/challenge/new/habit" />;

  // Null on accounts from before names were asked for (decision 100): they add it before signing.
  const name = fullName(profile);
  const signed = !!name && !!signature;
  const now = new Date();
  const headline = `I promise to keep “${habitName}” every day for ${draft.days} days. If I don’t finish, my $${draft.stake} goes to ${charityName}.`;
  const paragraphs = contractText({
    fullName: name ?? profile.username,
    habitName,
    language: draft.language ? nameFor(LANGUAGES, draft.language) : undefined,
    level: draft.level ? nameFor(LEVELS, draft.level) : undefined,
    startsOn: fromDateString(startDate(deviceTimeZone(), now)).toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    }),
    lengthDays: Number(draft.days),
    stakeDollars: Number(draft.stake),
    paymentName: paymentNameFor(draft.payment, draft.token),
    charityName,
    isPublic,
    aiChecks: profile.ai_allowed !== false,
  });
  // What paying by card authorizes (T179), signed with the promise and stored with the charge.
  const authorization = (draft.payment === 'card' || draft.payment === 'balance') && stripeEnabled() ? cardAuthorization('stake') : null;
  // Everything the challenger reads above the signature, kept with it word for word.
  const signedText = [headline, ...paragraphs, ...(authorization ? [authorization] : [])].join('\n\n');

  /** Starts the challenge (the database checks every limit again), then opens it. */
  async function start() {
    // Kept balance (decision 150) is a card challenge that asks to use the balance first.
    const byBalance = draft.payment === 'balance' && stripeEnabled();
    const byCard = (draft.payment === 'card' && stripeEnabled()) || byBalance;
    if (inFlight.current || !signed || !signature) return;
    inFlight.current = true;
    setSaving(true);
    setError(null);
    setDeclined(false);
    try {
      // A card stake with no card saved: Stripe's card form opens here, before anything is created, so a form
      // that's closed leaves nothing behind and the signature stays (owner, 2026-11-03). The Kept balance path
      // skips it: the balance may cover everything, and the server says so if a card is still needed.
      if (byCard && !byBalance && !(await ensureCard(session!.user.id))) {
        throw new CardDeclined('A card stake needs a card. Add one to sign; it’s charged only when you do.');
      }
      const { data, error } = await supabase
        .from('challenges')
        .insert({
          // A card stake charged up front (T93): the challenge waits until the card payment goes through.
          ...(byCard && { pay_card: true }),
          ...(byBalance && { use_balance: true }),
          habit_id: draft.habitId,
          language: draft.language ?? null,
          level: draft.level ?? null,
          length_days: Number(draft.days),
          stake_cents: Number(draft.stake) * 100,
          charity_id: draft.charityId,
          payment_method: byBalance ? 'card' : draft.payment,
          // A collected Solana stake (T169): the challenge waits for the wallet's payment.
          ...(draft.token && { pay_token: draft.token }),
          time_zone: deviceTimeZone(),
          consented_at: new Date().toISOString(),
          is_public: isPublic,
          // Moved into challenge_signatures by the database, with the name from the profile (0082).
          signature: { ...signature, contract_text: signedText },
        })
        .select('id')
        .single();
      if (error) throw error;
      if (byCard) {
        try {
          await payByCard({ challenge: data.id }, cardAuthorization('stake'));
        } catch (e) {
          // Declined: the challenge is gone, so say why here. Anything else (no connection mid-payment) leaves it
          // waiting on its own screen, where it can be paid or cancelled.
          if (e instanceof CardDeclined) throw e;
        }
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Close the five steps, then open the new challenge from wherever the user started.
      router.dismissAll();
      router.push({ pathname: '/challenge/[id]', params: { id: data.id } });
      if (draft.token) {
        // Pay in the wallet, and wait on its screen until the payment is found.
        router.push({ pathname: '/challenge/[id]/pay', params: { id: data.id } });
        Linking.openURL(solanaPayLink(data.id)).catch(() => {});
      }
      // The new challenge's shield warning, if notifications are on; the tutorial's primer asked (T97).
      rescheduleShieldWarnings();
    } catch (e) {
      const message = e instanceof CardDeclined ? e.message : challengeErrorMessage(e as { code?: string; message?: string });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setDeclined(e instanceof CardDeclined);
      setError(message);
      AccessibilityInfo.announceForAccessibility(message);
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  /** Stripe's form for another card, which becomes the default; saved, it signs and pays again with it. */
  async function anotherCard() {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setError(null);
    let saved = false;
    try {
      saved = await switchCard(session!.user.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
    if (saved) start();
  }

  /** Back to the Stake step, where the way to pay is chosen; what's been typed there stays. */
  function payAnotherWay() {
    const { habitId, habitName, language, level, days } = draft;
    router.dismissTo({ pathname: '/challenge/new/stake', params: { habitId, habitName, days, ...(language && { language }), ...(level && { level }) } });
  }

  return (
    <StepScreen
      step={5}
      question="Sign your promise"
      error={error}
      buttonTitle={saving ? 'Starting…' : 'Sign and start'}
      onPress={start}
      disabled={!signed || saving}
      scrollEnabled={!drawing}
    >
      {/* No swipe back on this step: iOS 26 takes a swipe right from anywhere on the screen as Back, so a stroke on
          the pad could leave the step (owner, 2026-11-02). It has to be off already when the finger lands: native
          reads the option at touch-down, before a `drawing` update could reach it, so the first stroke still got
          through when the option followed the pad's state. The header's back button still works. */}
      <Stack.Screen options={{ gestureEnabled: false }} />
      {declined && (
        <View style={styles.declined}>
          <Button title="Use a different card" onPress={anotherCard} disabled={saving} variant="secondary" />
          <Button title="Pay another way" onPress={payAnotherWay} disabled={saving} variant="link" />
        </View>
      )}
      <ListSection
        title="Who can back you"
        titleInside
        footer={
          isPublic
            ? 'People who aren’t your friends can find this challenge under Discover and pledge behind it. They see its progress, never your username, photo or profile, and they can’t check your days.'
            : 'Only your friends can see this challenge and pledge behind it.'
        }
      >
        <ListRow label="Let backers find this challenge" toggle={{ value: isPublic, onValueChange: setIsPublic }} first />
      </ListSection>

      <Tile style={styles.promise}>
        <View accessible style={styles.contract}>
          <DayStamp kind="kept" color={colors.stamp} size={44} />
          <Text style={styles.headline}>{headline}</Text>
          {[...paragraphs, ...(authorization ? [authorization] : [])].map((paragraph) => (
            <Text key={paragraph} style={styles.paragraph}>
              {paragraph}
            </Text>
          ))}
        </View>

        {name ? (
          <View style={styles.signatureBlock}>
            <SignaturePad name={name} value={signature} onChange={setSignature} onDrawing={setDrawing} />
            <View style={[styles.line, signed && styles.signedLine]} />
            <Text style={[styles.caption, signed && styles.signedCaption]}>
              {signed ? `Signed by ${name}, ${now.toLocaleDateString(undefined, { dateStyle: 'long' })}` : `Sign as ${name}`}
            </Text>
          </View>
        ) : (
          <View style={styles.signatureBlock}>
            <Text style={styles.paragraph}>A promise is signed with your full name. Add yours first; only you see it.</Text>
            <Button variant="secondary" title="Add your name" onPress={() => router.push('/edit-name')} />
          </View>
        )}
      </Tile>
    </StepScreen>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    declined: { gap: SPACE.sm },
    promise: { gap: SPACE.xl, padding: SPACE.xl },
    contract: { gap: SPACE.md },
    headline: { ...TYPE.title, color: c.text },
    paragraph: { ...TEXT.note, color: c.secondaryText },
    signatureBlock: { gap: SPACE.sm },
    line: { height: 1, backgroundColor: c.text, opacity: 0.4 },
    signedLine: { height: 2, backgroundColor: c.link, opacity: 1 },
    caption: { ...TEXT.caption, color: c.secondaryText },
    signedCaption: { color: c.link, fontWeight: '600' },
  });
