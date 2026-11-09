// Back a friend's challenge (T31; SPEC-pledges.md decisions 1, 2, 4 and 5). It shows the challenge's
// progress and pledge total, then takes a pretend pledge from $5 to $100, with "Donate even if they
// don't finish" off unless the supporter turns it on. Once pledged, the supporter can raise it,
// turn donating on (never back off), or withdraw it until the end of Day 1. Once the challenge has
// ended, it shows what became of the pledge and takes an extra gift (T32). Opened from a friend's
// profile, Discover and Wallet; a public challenge from someone who isn't a friend is read through
// discover_challenges() (T44), never the challenges table: that person backs it as a backer, only in
// its first 7 days, and earns Kept credits if the challenger finishes (T45). The database checks
// every rule again (migrations 0022–0025). Kept's service fee is on top of the pledge and listed
// with the total before confirming (T63). The missed days show, each marked with whether the
// challenger bought a shield for it (owner, 2026-10-01). The challenge leads as a tile,
// then the pledge as one big amount, its fee lines and the button; the fine print follows the
// button (bento, 2026-10-02). As in the A3 mockup since T136 (full-set/ui-flow-2-pledge.jpg): "Back
// @alex", the challenge's days in a card, the amount large with $5 / $10 / $20 / Other chips (none
// chosen to start; any whole amount from $5 to $100 under Other), what happens with "Give it anyway",
// the fee lines, and "Pledge $10". Since 2026-10-27 (decision 143) a pledge rewards the challenger if
// they finish, unless the pledger turns on "Give it to {charity} instead"; that choice can change for 24 hours
// after paying (migration 0064, decision 149). With Kept balance, "Pay with" offers it beside the card
// (decision 150). A challenge takes at most $1,000 in pledges (decision 155): the sheet says how much room is
// left, a raise can go only that far, and a full challenge says so and offers no pledge. A friend's challenge
// paid in crypto also takes a pledge paid from a wallet, in the challenger's own token (T171): "Pay with"
// offers Crypto, the wallet opens on the pledge and its fee, and the pledge counts once the payment arrives.
// A challenge that has ended says so in its title instead of asking to be backed (T205).

import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useRef, useState } from 'react';
import { AccessibilityInfo, Alert, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { CharityLink } from '@/components/charity-link';
import { statusLine } from '@/components/challenge-rows';
import { ErrorText } from '@/components/error-text';
import { GiftForm } from '@/components/gift-form';
import { MissedDays } from '@/components/missed-days';
import { ReportBlock } from '@/components/report-block';
import { Segmented } from '@/components/segmented';
import { StampCard } from '@/components/stamp-card';
import { LoadingScreen } from '@/components/step-screen';
import { DollarInput } from '@/components/dollar-input';
import { ListRow, ListSection } from '@/components/list';
import { PageTitle } from '@/components/tab-title';
import { Tile } from '@/components/tile';
import { creditsFor, feeBreakdown } from '@/lib/challenge-rules';
import { CHALLENGE_COLUMNS, feeLines, money, parseStakeDollars, raiseText, solanaPayEnabled, solanaPayLink, summarizeChallenge, type ChallengeRow } from '@/lib/challenges';
import { BACKER_WINDOW_DAYS, backerCreditsText, backHeading, canMakePublic, canWithdrawPledge, challengeFull, challengeRoomText, pendingPledgeCents, pledgeError, pledgeErrorMessage, pledgeFate, pledgeSummaryText, publicChallengeRow, KEPT_CREDITS_EXPLAINED, type DiscoverRow, type MyPledge, type PledgeSummary } from '@/lib/pledges';
import { CardDeclined, PaymentsError, payByCard, payments, stripeEnabled } from '@/lib/payment-methods';
import { cardAuthorization } from '@/lib/policies';
import { supabase } from '@/lib/supabase';
import { HERO_MAX_SCALE, ICON, RADIUS, SCREEN, SPACE, TEXT, TYPE, useColors, useStyles, type Colors } from '@/lib/theme';
import { must, useFocusLoad } from '@/lib/use-focus-load';

/** One-tap pledge amounts, in dollars. */
const AMOUNTS = ['5', '10', '20'];

/** A card payment in save()'s shape (T93): a declined card, or a pledge the database refused, comes back as an error to show. */
async function viaCard(run: () => Promise<unknown>): Promise<{ error: { code?: string; message?: string } | null }> {
  try {
    await run();
    return { error: null };
  } catch (e) {
    if (e instanceof CardDeclined) return { error: { code: 'card_declined', message: e.message } };
    if (e instanceof PaymentsError) return { error: { code: e.answer?.code ?? e.code, message: e.answer?.message ?? e.code } };
    return { error: { message: (e as Error).message } };
  }
}

export default function PledgeScreen() {
  const styles = useStyles(makeStyles);
  const colors = useColors();
  const { challengeId, username } = useLocalSearchParams<{ challengeId: string; username?: string }>();
  // Reloads each time the screen comes into view. A friend's challenge reads directly; anyone
  // else's public one only through Discover, and that person backs it as a backer.
  const { data, failed, reload } = useFocusLoad(async () => {
    const [row, pledges, summaries, discover, credits, balance] = await Promise.all([
      supabase.from('challenges').select(CHALLENGE_COLUMNS).eq('id', challengeId).maybeSingle(),
      supabase.rpc('my_pledges'),
      supabase.rpc('pledge_summaries', { ids: [challengeId] }),
      supabase.rpc('discover_challenges', { challenge: challengeId }),
      // Kept credits left (T164): they pay the fee where a card is charged for real.
      stripeEnabled() ? supabase.rpc('my_credits') : Promise.resolve({ data: 0, error: null }),
      // And Kept balance left (T189), which pays first.
      stripeEnabled() ? supabase.rpc('my_balance') : Promise.resolve({ data: 0, error: null }),
    ]);
    const now = new Date();
    const friendRow = must(row) as unknown as ChallengeRow | null;
    const pub = (must(discover) as DiscoverRow[])[0];
    return {
      isFriend: !!friendRow,
      challenge: friendRow ? summarizeChallenge(friendRow, now) : pub ? summarizeChallenge(publicChallengeRow(pub), now) : null,
      mine: must(pledges) as MyPledge[],
      summary: (must(summaries) as PledgeSummary[])[0] ?? (pub ? { challenge_id: pub.id, total_cents: pub.total_cents, pledgers: pub.pledgers } : null),
      creditsLeft: must(credits) as number,
      balanceLeft: must(balance) as number,
    };
  }, challengeId);
  // undefined while loading; null when the challenge isn't readable (no longer friends, or ended).
  const challenge = data ? data.challenge : undefined;
  const mine = data?.mine ?? [];
  const summary = data?.summary ?? null;
  const isFriend = data?.isFriend ?? true;
  const [text, setText] = useState('');
  // The chosen chip (an amount, or 'other' for the box); none to start.
  const [choice, setChoice] = useState<string | null>(null);
  const [donate, setDonate] = useState(false);
  // "Give it to the charity instead" if they finish: off means the pledge is the challenger's reward.
  const [toCharity, setToCharity] = useState(false);
  // Card, Kept balance (the card pays whatever the balance doesn't cover), or crypto on a crypto challenge.
  const [payWith, setPayWith] = useState<'card' | 'balance' | 'crypto'>('card');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Read synchronously, so a double tap can't pledge twice.
  const inFlight = useRef(false);

  /** Runs one save, then reloads; a refusal shows as a plain sentence. */
  async function save(action: () => PromiseLike<{ error: { code?: string; message?: string } | null }>, done: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setError(null);
    try {
      const { error } = await action();
      if (error) throw error;
      setText('');
      AccessibilityInfo.announceForAccessibility(done);
    } catch (e) {
      const refusal = e as { code?: string; message?: string };
      const message = refusal.code === 'card_declined' && refusal.message ? refusal.message : pledgeErrorMessage(refusal);
      setError(message);
      AccessibilityInfo.announceForAccessibility(message);
    } finally {
      inFlight.current = false;
      setSaving(false);
      reload();
    }
  }

  if (challenge === undefined) {
    return <LoadingScreen failed={failed} onRetry={reload} message="This challenge couldn’t be loaded." />;
  }

  const own = mine.find((p) => p.challenge_id === challengeId);
  // Only a friend's challenge has a name here: a public one never says who it is (0027).
  const known = username || own?.challenger;
  const name = known || (isFriend ? 'your friend' : 'the challenger');
  if (!challenge) {
    return (
      <View style={styles.center}>
        <Text style={styles.note}>
          {own
            ? `You pledged $${own.amount_cents / 100} on ${name}’s ${own.habit}. ${pledgeFate(own)}.`
            : 'You can’t see this challenge any more.'}
        </Text>
        <Button title="Go back" onPress={() => router.back()} variant="secondary" />
      </View>
    );
  }

  const running = challenge.state === 'upcoming' || challenge.state === 'active';
  const asBacker = own ? own.kind === 'backer' : !isFriend;
  const totalCents = summary?.total_cents ?? 0;
  const full = running && challengeFull(totalCents, !!own);
  // A backer can pledge only in the first 7 days (the same window as opening a challenge to backers).
  const canPledge = running && !full && (own || !asBacker || canMakePublic(challenge));
  const withdrawable = !!own && canWithdrawPledge(challenge);
  const dollars = parseStakeDollars(text);
  const outstandingCents = pendingPledgeCents(mine);
  const problem = pledgeError(dollars, { currentDollars: own ? own.amount_cents / 100 : 0, outstandingCents, challengeTotalCents: totalCents });
  const amountLabel = own ? `$${own.amount_cents / 100}` : dollars ? `$${dollars}` : 'your pledge';

  // With real cards (T93), a pledge or raise is paid up front, and saved once the card payment goes through.
  const byCard = stripeEnabled();
  const balanceLeft = data?.balanceLeft ?? 0;
  const useBalance = byCard && payWith === 'balance' && balanceLeft > 0;
  // A friend's challenge paid in crypto takes crypto pledges, in its own token (a backer's shows no token yet).
  const cryptoToken = solanaPayEnabled() && isFriend ? (challenge.payToken ?? null) : null;
  const byWallet = !!cryptoToken && payWith === 'crypto';

  /** Starts a crypto pledge or raise to `cents` in all: the wallet opens on it, and the Pay sheet waits for it. */
  async function viaWallet(cents: number): Promise<{ error: { code?: string; message?: string } | null }> {
    const { data, error } = await supabase.rpc('start_crypto_pledge', { challenge: challengeId, amount: cents, donate, to_charity: toCharity });
    if (error) return { error };
    router.push({ pathname: '/challenge/[id]/pay', params: { id: challengeId, payment: data as string } });
    Linking.openURL(solanaPayLink(data as string, undefined, 'payment')).catch(() => {});
    return { error: null };
  }

  function pledge() {
    if (problem) return setError(problem);
    const choices = { donate, toCharity, useBalance };
    save(
      () =>
        byWallet
          ? viaWallet(dollars! * 100)
          : byCard
            ? viaCard(() => payByCard({ pledge: { challenge: challengeId, amountCents: dollars! * 100, ...choices } }, cardAuthorization('pledge')))
            : supabase.from('pledges').insert({ challenge_id: challengeId, amount_cents: dollars! * 100, donate_if_not_finished: donate, to_charity_on_finish: toCharity }),
      byWallet ? 'Opening your wallet.' : `You pledged $${dollars} behind ${name}.`,
    );
  }

  function raise() {
    if (problem) return setError(problem);
    save(
      () =>
        byWallet
          ? viaWallet(dollars! * 100)
          : byCard
            ? viaCard(() => payByCard({ pledge: { challenge: challengeId, amountCents: dollars! * 100, useBalance } }, cardAuthorization('pledge')))
            : supabase.from('pledges').update({ amount_cents: dollars! * 100 }).eq('challenge_id', challengeId),
      byWallet ? 'Opening your wallet.' : `Your pledge is now $${dollars}.`,
    );
  }

  function donateAnyway() {
    Alert.alert(`Donate even if ${name} doesn’t finish?`, `Your ${amountLabel} will go to ${challenge!.charityName} either way. You can’t turn this off later.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Donate either way',
        onPress: () =>
          save(() => supabase.from('pledges').update({ donate_if_not_finished: true }).eq('challenge_id', challengeId), 'You’ll donate either way.'),
      },
    ]);
  }

  /** Until the end of Day 1, a pledger can switch between rewarding the challenger and giving to the charity if they finish. */
  function setFinishChoice(next: boolean) {
    save(
      () => supabase.from('pledges').update({ to_charity_on_finish: next }).eq('challenge_id', challengeId),
      next ? `If ${name} finishes, your pledge goes to ${challenge!.charityName}.` : `If ${name} finishes, your pledge is their reward.`,
    );
  }

  function withdraw() {
    const fee = own ? ` Kept’s ${money(feeBreakdown(own.amount_cents).feeCents)} service fee isn’t refunded.` : '';
    Alert.alert('Withdraw your pledge?', `Your ${amountLabel} comes back to you, and ${name} loses your backing.${fee}`, [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Withdraw',
        style: 'destructive',
        onPress: () =>
          save(async () => {
            // A paid pledge (T93): the server deletes it as the pledger and refunds the pledge, never the fee.
            if (byCard) return viaCard(() => payments({ action: 'withdraw', challenge: challengeId }));
            const { data, error } = await supabase.from('pledges').delete().eq('challenge_id', challengeId).select('id');
            // RLS keeps the row after Day 1 without an error: say so plainly.
            if (!error && data.length === 0) return { error: { code: 'withdraw', message: 'pledge_not_withdrawable' } };
            return { error };
          }, 'Your pledge is withdrawn.'),
      },
    ]);
  }

  const finishCharity = own ? own.to_charity_on_finish : toCharity;
  const failCharity = own ? own.donate_if_not_finished : donate;
  const outcomeLine =
    (finishCharity && failCharity
      ? `Your ${amountLabel} goes to ${challenge.charityName} either way.`
      : `If ${name} finishes, your ${amountLabel} ${finishCharity ? `goes to ${challenge.charityName}` : 'goes to them as their reward'}. ` +
        (failCharity ? `If not, it goes to ${challenge.charityName} anyway.` : 'If not, it comes back to you.')) +
    (asBacker
      ? // What this pledge would earn, not a percentage the fee cap breaks (T209).
        ` ${backerCreditsText(name, own ? own.amount_cents : dollars ? dollars * 100 : null)}`
      : ` If you were friends before Day 1, backing it also lets you approve ${name}’s check-ins.`);
  const earned = own ? creditsFor(own.kind, own.amount_cents, own.outcome) : 0;

  /** A chip sets the amount; Other opens the box for any whole amount from $5 to $100. */
  function chooseAmount(value: string) {
    setChoice(value);
    if (value !== 'other') setText(value);
    else setText('');
    setError(null);
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled">
      <PageTitle
        {...backHeading({ running, known: known || undefined, isFriend, pledged: !!own })}
        icon={
          <View style={styles.headIcon}>
            <SymbolView name={{ ios: 'person.2', android: 'group' }} size={ICON.hero} tintColor={colors.text} />
          </View>
        }
      />

      <StampCard
        challenge={challenge}
        header={
          <View style={styles.cardHead}>
            <Text style={styles.title} accessibilityRole="header">
              {challenge.title}
            </Text>
            <Text style={styles.status}>{statusLine(challenge)}</Text>
          </View>
        }
      >
        <Text style={styles.note}>
          For {challenge.charityName}. {pledgeSummaryText({ totalCents, pledgers: summary?.pledgers ?? 0 })}.
          {running && !full ? ` ${challengeRoomText(totalCents, !!own)}` : ''}
        </Text>
        <CharityLink name={challenge.charityName} slug={challenge.charitySlug} />
      </StampCard>

      {own && (
        <Tile>
          <Text style={styles.cardTitle}>Your pledge: ${own.amount_cents / 100}</Text>
          <Text style={styles.body}>
            {`You paid ${money(feeBreakdown(own.amount_cents).totalCents)}: the pledge plus Kept’s ${money(feeBreakdown(own.amount_cents).feeCents)} service fee.`}
          </Text>
          <Text style={styles.body}>{running ? outcomeLine : `${pledgeFate(own)}.`}</Text>
          {earned > 0 && <Text style={styles.body}>You earned ${(earned / 100).toFixed(2)} in Kept credits, toward Kept’s service fee.</Text>}
        </Tile>
      )}

      <MissedDays challenge={challenge} />

      {full && <Text style={styles.note}>{challengeRoomText(totalCents, !!own)}</Text>}
      {running && !full && !canPledge && (
        <Text style={styles.note}>Backers can pledge only in a challenge’s first {BACKER_WINDOW_DAYS} days, so this one takes no new backers.</Text>
      )}

      {canPledge && (
        <>
          {own ? (
            <View style={styles.field}>
              <Text style={styles.label}>Raise your pledge to</Text>
              <DollarInput
                value={text}
                onChangeText={setText}
                placeholder={String(own.amount_cents / 100 + 5)}
                accessibilityLabel="New pledge in dollars"
                big
              />
            </View>
          ) : (
            <Tile style={styles.amountCard}>
              <View accessible accessibilityLabel={dollars ? `$${dollars}` : 'No amount chosen yet'}>
                <Text style={styles.amount} maxFontSizeMultiplier={HERO_MAX_SCALE}>
                  ${dollars ?? '–'}
                </Text>
              </View>
              <Segmented
                look="chips"
                label="Pledge amount"
                options={[...AMOUNTS.map((a) => ({ value: a, label: `$${a}` })), { value: 'other', label: 'Other' }]}
                value={choice}
                onChange={chooseAmount}
              />
              {choice === 'other' && (
                <DollarInput value={text} onChangeText={setText} placeholder="25" accessibilityLabel="Pledge in dollars" />
              )}
            </Tile>
          )}

          <ListSection>
            <View style={styles.outcome}>
              <SymbolView name={{ ios: 'hand.raised', android: 'volunteer_activism' }} size={ICON.hero} tintColor={colors.text} />
              <Text style={styles.outcomeText}>{outcomeLine}</Text>
            </View>
            {asBacker && (
              <ListRow
                label="What are Kept credits?"
                icon={{ ios: 'questionmark.circle', android: 'help' }}
                onPress={() => Alert.alert('Kept credits', KEPT_CREDITS_EXPLAINED)}
              />
            )}
            {(!own || own.choice_open) && (
              <ListRow
                label={`Give it to ${challenge.charityName} instead`}
                detail={`If ${name} finishes, instead of their reward. You can change this for 24 hours after you pledge.`}
                icon={{ ios: 'heart', android: 'favorite_border' }}
                toggle={own ? { value: own.to_charity_on_finish, onValueChange: setFinishChoice } : { value: toCharity, onValueChange: setToCharity }}
              />
            )}
            {!own && (
              <ListRow label="Give it anyway" detail={`Donate even if ${name} doesn’t finish`} icon={{ ios: 'gift', android: 'redeem' }} toggle={{ value: donate, onValueChange: setDonate }} />
            )}
          </ListSection>

          {((byCard && balanceLeft > 0) || cryptoToken) && (
            <Tile>
              <Segmented
                label="Pay with"
                options={[
                  { value: 'card', label: 'Card' },
                  ...(byCard && balanceLeft > 0 ? [{ value: 'balance', label: `Kept balance (${money(balanceLeft)})` }] : []),
                  ...(cryptoToken ? [{ value: 'crypto', label: `Crypto (${cryptoToken})` }] : []),
                ]}
                value={payWith}
                onChange={(v) => setPayWith(v as 'card' | 'balance' | 'crypto')}
              />
            </Tile>
          )}
          {dollars !== null && !problem && (
            <ListSection footer="Kept’s service fee is on top of your pledge and isn’t refunded; only the pledge goes to the challenger, the charity or back to you.">
              {feeLines('Pledge', dollars * 100, own || byWallet ? 0 : (data?.creditsLeft ?? 0), own || !useBalance ? 0 : balanceLeft).map((line, i) => (
                <ListRow key={line.label} label={line.label} value={line.value} first={i === 0} />
              ))}
            </ListSection>
          )}
          {own && dollars !== null && !problem && (
            <Text style={styles.explanation}>{raiseText(own.amount_cents, dollars * 100, byWallet ? 0 : (data?.creditsLeft ?? 0), useBalance ? balanceLeft : 0)}</Text>
          )}
          {/* What paying by card authorizes (T179), shown with the amount, right above the button. */}
          {byCard && !byWallet && dollars !== null && !problem && <Text style={styles.explanation}>{cardAuthorization('pledge')}</Text>}
          <ErrorText message={error} />
          <Button
            title={saving ? 'Saving…' : own ? 'Raise pledge' : dollars ? `Pledge $${dollars}` : 'Back this challenge'}
            onPress={own ? raise : pledge}
            disabled={saving || !text}
          />
          <Text style={styles.explanation}>
            {own
              ? 'A pledge can be raised, never lowered.'
              : canWithdrawPledge(challenge)
                ? 'You can withdraw it until the end of Day 1. After that it can only be raised.'
                : 'Once pledged, it can only be raised.'}
          </Text>
        </>
      )}

      {own && !own.donate_if_not_finished && (running || own.outcome === 'not_finished') && (
        <Button title="Donate either way" onPress={donateAnyway} variant="secondary" disabled={saving} />
      )}
      {withdrawable && <Button title="Withdraw pledge" onPress={withdraw} variant="destructiveLink" disabled={saving} />}
      {!running && <ErrorText message={error} />}
      {!running && own && challenge.state !== 'cancelled' && <GiftForm challengeId={challengeId} charityName={challenge.charityName} />}
      {!isFriend && (
        <ReportBlock report={{ challengeId }} block={{ challenge: challengeId }} name="this challenger" onBlocked={() => router.back()} />
      )}
    </ScrollView>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.groupedBackground },
    container: SCREEN,
    center: { flex: 1, justifyContent: 'center', gap: SPACE.lg, padding: SPACE.xxl, backgroundColor: c.groupedBackground },
    headIcon: {
      width: 60,
      height: 60,
      borderRadius: RADIUS.field,
      borderCurve: 'continuous',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.card,
      boxShadow: c.tileShadow || undefined,
    },
    cardHead: { gap: SPACE.xxs, marginBottom: SPACE.sm },
    title: { ...TYPE.title, color: c.text },
    status: { ...TEXT.row, color: c.secondaryText },
    note: { ...TEXT.note, color: c.secondaryText },
    cardTitle: { ...TYPE.heading, color: c.text },
    body: { ...TEXT.body, color: c.text },
    field: { gap: SPACE.md },
    label: { ...TEXT.caption, color: c.secondaryText, marginLeft: SPACE.xs },
    amountCard: { gap: SPACE.lg, padding: SPACE.xl },
    amount: { ...TYPE.hero, color: c.text },
    outcome: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACE.lg, padding: SPACE.lg },
    outcomeText: { ...TEXT.row, flex: 1, color: c.text },
    explanation: { ...TEXT.caption, color: c.secondaryText, marginHorizontal: SPACE.xs },
  });
