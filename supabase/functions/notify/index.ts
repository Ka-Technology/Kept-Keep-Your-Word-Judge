// Kept's pushes (SPEC-notifications.md). Database triggers call it through pg_net with the secret
// key (migration 0028, call_notify) whenever something happens that someone should hear about:
//   { check_in, new_photo }: a check-in waits for friends (T34, "Check-ins to review");
//   { check_in_result }: the challenger's check-in needs a new photo, wasn't approved, or the AI approved or counted it (T59, "Your check-ins");
//   { quiz_open, day }: the quiz is open for a Read or Learn a language day (migration 0087, "Your check-ins");
//   { pledge }: someone pledged behind the challenger's challenge (T55, "Someone backs you");
//   { solana_payment }: a wallet payment for a Solana stake was confirmed (T169, "Payment received", to the challenger);
//   { friend_request }: someone asked to be friends (T56, "Friend requests");
//   { report }: someone reported a person, check-in or challenge (T53, to the owner, always on);
//   { feedback }: someone sent feedback (T158, to the owner: a push, and an email through Resend);
//   { challenge_result }: a challenge finished or didn't (T177, "Results", to the challenger and each pledger);
//   { reward } / { money_waiting, reminder } / { sent_back } / { takeback }: the person's own money moved or waits
//     for them (T199, migration 0069: "Your reward is in", "Money is waiting", "Sent back to your card",
//     "A pledge was taken back").
// It works out who to tell, sends through Expo's push service, and deletes tokens Expo says are gone.
// A failed push is logged and never retried: it never affects what triggered it. Expo's access token
// (enhanced push security) is the EXPO_ACCESS_TOKEN Supabase secret, sent when it's set.

import { withSupabase } from 'npm:@supabase/server@^1';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@^2';

import {
  batches,
  beforeReviewCutoff,
  feedbackEmail,
  feedbackPush,
  friendRequestPush,
  goneTokens,
  habitLabel,
  moneyPush,
  paymentPush,
  pledgePush,
  quizOpenPush,
  reportPush,
  resultPush,
  resultsPush,
  reviewPush,
  type Push,
  type Ticket,
} from './messages.ts';

const EXPO_PUSH = 'https://exp.host/--/api/v2/push/send';

/** Sends `push` to each token, 100 per request, and forgets the phones Expo reports gone. */
async function send(admin: SupabaseClient, tokens: string[], push: Push): Promise<number> {
  const accessToken = Deno.env.get('EXPO_ACCESS_TOKEN');
  let sent = 0;
  for (const messages of batches(tokens, push)) {
    const res = await fetch(EXPO_PUSH, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(messages),
      signal: AbortSignal.timeout(10_000),
    });
    const { data, errors } = (await res.json()) as { data?: Ticket[]; errors?: unknown };
    if (!res.ok || errors) console.error('notify: Expo refused the request', res.status, errors);
    const gone = goneTokens(messages, data ?? []);
    if (gone.length) {
      const { error } = await admin.from('push_tokens').delete().in('token', gone);
      if (error) console.error('notify: gone tokens not deleted', error);
    }
    sent += (data ?? []).filter((t) => t.status === 'ok').length;
  }
  return sent;
}

/** "Check-ins to review": friends who may review it, while it still waits and before the challenger's step-in time (10 pm unless they chose later). */
async function checkInToReview(admin: SupabaseClient, checkInId: string, newPhoto: boolean): Promise<number> {
  const { data: ci, error } = await admin
    .from('check_ins')
    .select('id, day, status, challenges(user_id, time_zone, language, habits(name))')
    .eq('id', checkInId)
    .maybeSingle();
  if (error) throw error;
  // Gone, or already reviewed or taken by the AI by the time this runs: nothing to ask.
  if (!ci || ci.status !== 'pending') return 0;
  const challenge = ci.challenges as unknown as { user_id: string; time_zone: string; language: string | null; habits: { name: string } };

  const [{ data: tokens, error: tokensError }, { data: profile, error: profileError }] = await Promise.all([
    admin.rpc('review_push_tokens', { check_in: checkInId }),
    admin.from('profiles').select('username, ai_from_minutes').eq('id', challenge.user_id).single(),
  ]);
  if (tokensError) throw tokensError;
  if (profileError) throw profileError;
  // Friends are only asked while their review can still count: before the AI steps in, at the challenger's own time.
  if (!beforeReviewCutoff(challenge.time_zone, new Date(), profile.ai_from_minutes)) return 0;
  if (!tokens?.length) return 0;

  const push = reviewPush({
    username: profile.username,
    habit: habitLabel(challenge.habits.name, challenge.language),
    day: ci.day,
    checkInId,
    newPhoto,
  });
  return send(admin, (tokens as { token: string }[]).map((t) => t.token), push);
}

/** "Your check-ins": the challenger, if the check-in still needs them (a new photo, or an appeal). */
async function checkInResult(admin: SupabaseClient, checkInId: string): Promise<number> {
  const { data: ci, error } = await admin
    .from('check_ins')
    .select('day, status, reviewer_id, ai_verdict, challenges(id, user_id, language, habits(name))')
    .eq('id', checkInId)
    .maybeSingle();
  if (error) throw error;
  // Moved on by the time this runs (e.g. a new photo already sent): nothing to say.
  if (!ci || !['flagged', 'retake', 'rejected', 'approved', 'excused'].includes(ci.status)) return 0;
  const challenge = ci.challenges as unknown as { id: string; user_id: string; language: string | null; habits: { name: string } };

  const [{ data: tokens, error: tokensError }, reviewer] = await Promise.all([
    admin.from('push_tokens').select('token').eq('user_id', challenge.user_id).eq('check_ins', true),
    ci.status === 'flagged' && ci.reviewer_id
      ? admin.from('profiles').select('username').eq('id', ci.reviewer_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (tokensError) throw tokensError;
  if (reviewer.error) throw reviewer.error;
  if (!tokens?.length) return 0;

  const push = resultPush({
    status: ci.status as 'flagged' | 'retake' | 'rejected' | 'approved' | 'excused',
    verdict: ci.ai_verdict,
    reviewer: reviewer.data?.username ?? null,
    habit: habitLabel(challenge.habits.name, challenge.language),
    day: ci.day,
    challengeId: challenge.id,
    // A rejection with no AI verdict was a day no friend approved after Don't allow (T54).
    byAI: ci.status !== 'rejected' || ci.ai_verdict !== null,
  });
  return send(admin, tokens.map((t: { token: string }) => t.token), push);
}

/** "Your check-ins": the challenger, that the quiz for `day` is open (notify_quiz_open(), migration 0087). */
async function quizOpen(admin: SupabaseClient, challengeId: string, day: number): Promise<number> {
  const { data: challenge, error } = await admin
    .from('challenges')
    .select('id, user_id, language, habits(name)')
    .eq('id', challengeId)
    .maybeSingle();
  if (error) throw error;
  if (!challenge) return 0;
  const { data: tokens, error: tokensError } = await admin.from('push_tokens').select('token').eq('user_id', challenge.user_id).eq('check_ins', true);
  if (tokensError) throw tokensError;
  if (!tokens?.length) return 0;
  const habits = challenge.habits as unknown as { name: string };
  const push = quizOpenPush({ habit: habitLabel(habits.name, challenge.language), day, challengeId: challenge.id });
  return send(admin, tokens.map((t: { token: string }) => t.token), push);
}

/** "Someone backs you": the challenger, silently. A backer's id is read here and never sent on. */
async function newPledge(admin: SupabaseClient, pledgeId: string): Promise<number> {
  const { data: pledge, error } = await admin
    .from('pledges')
    .select('kind, pledger_id, challenges(id, user_id, language, habits(name))')
    .eq('id', pledgeId)
    .maybeSingle();
  if (error) throw error;
  // Withdrawn by the time this runs: nothing to say.
  if (!pledge) return 0;
  const challenge = pledge.challenges as unknown as { id: string; user_id: string; language: string | null; habits: { name: string } };

  const [{ data: tokens, error: tokensError }, supporter] = await Promise.all([
    admin.from('push_tokens').select('token').eq('user_id', challenge.user_id).eq('pledges', true),
    pledge.kind === 'supporter'
      ? admin.from('profiles').select('username').eq('id', pledge.pledger_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (tokensError) throw tokensError;
  if (supporter.error) throw supporter.error;
  if (!tokens?.length) return 0;

  const push = pledgePush({
    kind: pledge.kind as 'supporter' | 'backer',
    username: supporter.data?.username ?? null,
    habit: habitLabel(challenge.habits.name, challenge.language),
    challengeId: challenge.id,
  });
  return send(admin, tokens.map((t: { token: string }) => t.token), push);
}

/** "Payment received" (T169): the challenger, on every phone, once a Solana stake is confirmed on chain. */
async function paymentReceived(admin: SupabaseClient, paymentId: string): Promise<number> {
  const { data: payment, error } = await admin
    .from('solana_payments')
    .select('user_id, token, stake_cents, status, challenges(id, language, habits(name))')
    .eq('id', paymentId)
    .maybeSingle();
  if (error) throw error;
  // Not confirmed, or its challenge is gone by the time this runs: nothing to say.
  if (!payment || payment.status !== 'confirmed' || !payment.challenges) return 0;
  const challenge = payment.challenges as unknown as { id: string; language: string | null; habits: { name: string } };

  const { data: tokens, error: tokensError } = await admin.from('push_tokens').select('token').eq('user_id', payment.user_id);
  if (tokensError) throw tokensError;
  if (!tokens?.length) return 0;
  const push = paymentPush({
    token: payment.token,
    stakeCents: payment.stake_cents,
    habit: habitLabel(challenge.habits.name, challenge.language),
    challengeId: challenge.id,
  });
  return send(admin, tokens.map((t: { token: string }) => t.token), push);
}

/** "Results" (T177): the challenger on every phone, and each pledger by their pledges switch. */
async function challengeResult(admin: SupabaseClient, challengeId: string): Promise<number> {
  const { data: c, error } = await admin
    .from('challenges')
    .select('id, user_id, outcome, stake_cents, language, habits(name), charities(name), pledges(pledger_id, kind)')
    .eq('id', challengeId)
    .maybeSingle();
  if (error) throw error;
  if (!c || (c.outcome !== 'finished' && c.outcome !== 'not_finished')) return 0;
  const { data: challenger, error: challengerError } = await admin.from('profiles').select('username').eq('id', c.user_id).maybeSingle();
  if (challengerError) throw challengerError;
  const base = {
    finished: c.outcome === 'finished',
    habit: habitLabel((c.habits as unknown as { name: string }).name, c.language),
    challengeId: c.id,
    stakeCents: c.stake_cents,
    charity: (c.charities as unknown as { name: string } | null)?.name ?? 'the charity',
    username: challenger?.username ?? null,
  };
  const pledges = (c.pledges ?? []) as { pledger_id: string; kind: 'supporter' | 'backer' }[];
  const [{ data: own, error: ownError }, { data: theirs, error: theirsError }] = await Promise.all([
    admin.from('push_tokens').select('token').eq('user_id', c.user_id),
    pledges.length
      ? admin.from('push_tokens').select('token, user_id').in('user_id', pledges.map((p) => p.pledger_id)).eq('pledges', true)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (ownError) throw ownError;
  if (theirsError) throw theirsError;
  let sent = own?.length ? await send(admin, own.map((t: { token: string }) => t.token), resultsPush({ ...base, role: 'challenger' })) : 0;
  for (const kind of ['supporter', 'backer'] as const) {
    const ids = new Set(pledges.filter((p) => p.kind === kind).map((p) => p.pledger_id));
    const tokens = (theirs ?? []).filter((t: { user_id: string }) => ids.has(t.user_id)).map((t: { token: string }) => t.token);
    if (tokens.length) sent += await send(admin, tokens, resultsPush({ ...base, role: kind }));
  }
  return sent;
}

/** The money pushes (T199): to the person whose money it is, on every phone, if it's still true when this runs. */
async function moneyMoved(admin: SupabaseClient, body: Record<string, unknown>): Promise<number> {
  let found: { user_id: string; cents: number; habit: string; challengeId: string | null } | null = null;
  let kind: Parameters<typeof moneyPush>[0]['kind'];
  if (typeof body.reward === 'string') {
    kind = 'reward';
    const { data, error } = await admin.from('payouts').select('user_id, amount_cents, habit').eq('challenge_id', body.reward).eq('kind', 'reward').eq('destination', 'balance');
    if (error) throw error;
    if (data?.length) found = { user_id: data[0].user_id, cents: data.reduce((sum, o) => sum + o.amount_cents, 0), habit: data[0].habit, challengeId: body.reward };
  } else if (typeof body.money_waiting === 'string' || typeof body.sent_back === 'string') {
    kind = typeof body.sent_back === 'string' ? 'sent_back' : body.reminder === true ? 'reminder' : 'waiting';
    const { data: o, error } = await admin
      .from('payouts')
      .select('user_id, amount_cents, habit, status, destination, challenge_id')
      .eq('id', (body.sent_back ?? body.money_waiting) as string)
      .maybeSingle();
    if (error) throw error;
    // Chosen by the time this runs, or not back on the card after all: nothing to say.
    const still = kind === 'sent_back' ? o?.status === 'paid' && o.destination === 'card' : o?.status === 'due';
    if (o && still) found = { user_id: o.user_id, cents: o.amount_cents, habit: o.habit, challengeId: o.challenge_id };
  } else {
    kind = 'takeback';
    const { data: e, error } = await admin.from('balance_entries').select('user_id, amount_cents, payouts(habit)').eq('id', body.takeback as string).maybeSingle();
    if (error) throw error;
    const habit = (e?.payouts as unknown as { habit: string } | null)?.habit;
    if (e && habit) found = { user_id: e.user_id, cents: -e.amount_cents, habit, challengeId: null };
  }
  if (!found) return 0;
  const { data: tokens, error: tokensError } = await admin.from('push_tokens').select('token').eq('user_id', found.user_id);
  if (tokensError) throw tokensError;
  if (!tokens?.length) return 0;
  return send(admin, tokens.map((t: { token: string }) => t.token), moneyPush({ kind, cents: found.cents, habit: found.habit, challengeId: found.challengeId }));
}

/** "Friend requests": the person asked, while the request still waits. */
async function friendRequest(admin: SupabaseClient, friendshipId: string): Promise<number> {
  const { data: request, error } = await admin
    .from('friendships')
    .select('status, requester_id, addressee_id')
    .eq('id', friendshipId)
    .maybeSingle();
  if (error) throw error;
  // Cancelled, declined or already accepted by the time this runs: nothing to say.
  if (!request || request.status !== 'pending') return 0;

  const [{ data: tokens, error: tokensError }, { data: requester, error: requesterError }] = await Promise.all([
    admin.from('push_tokens').select('token').eq('user_id', request.addressee_id).eq('friends', true),
    admin.from('profiles').select('username').eq('id', request.requester_id).single(),
  ]);
  if (tokensError) throw tokensError;
  if (requesterError) throw requesterError;
  if (!tokens?.length) return 0;
  return send(admin, tokens.map((t: { token: string }) => t.token), friendRequestPush(requester.username));
}

/** The phones of the owners in kept_owners, all of them, whatever their switches. */
async function ownerTokens(admin: SupabaseClient): Promise<string[]> {
  const { data: owners, error: ownersError } = await admin.from('kept_owners').select('user_id');
  if (ownersError) throw ownersError;
  if (!owners?.length) return [];
  const { data: tokens, error: tokensError } = await admin
    .from('push_tokens')
    .select('token')
    .in('user_id', owners.map((o: { user_id: string }) => o.user_id));
  if (tokensError) throw tokensError;
  return (tokens ?? []).map((t: { token: string }) => t.token);
}

/** A new report (T53): the owners, on every phone. */
async function newReport(admin: SupabaseClient, reportId: string): Promise<number> {
  const { data: report, error } = await admin.from('reports').select('reason, check_in_id, challenge_id').eq('id', reportId).maybeSingle();
  if (error) throw error;
  if (!report) return 0;
  const tokens = await ownerTokens(admin);
  if (!tokens.length) return 0;
  const what = report.check_in_id ? 'check-in' : report.challenge_id ? 'challenge' : 'person';
  return send(admin, tokens, reportPush({ reason: report.reason, what }));
}

/**
 * Emails feedback to the owner through Resend's API (RESEND_API_KEY, the key Supabase's SMTP already
 * uses). Without the key, or if Resend refuses, it's logged: the row is in the dashboard either way.
 */
async function emailFeedback(email: ReturnType<typeof feedbackEmail>): Promise<boolean> {
  const key = Deno.env.get('RESEND_API_KEY');
  if (!key) {
    console.error('notify: RESEND_API_KEY not set, feedback not emailed');
    return false;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(email),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) console.error('notify: Resend refused the feedback email', res.status, await res.text());
  return res.ok;
}

/** New feedback (T158): an email to the owner with everything, and a push to the owners' phones. */
async function newFeedback(admin: SupabaseClient, feedbackId: string): Promise<{ sent: number; emailed: boolean }> {
  const { data: f, error } = await admin
    .from('feedback')
    .select('user_id, kind, message, photo_path, app_version, os, os_version')
    .eq('id', feedbackId)
    .maybeSingle();
  if (error) throw error;
  if (!f) return { sent: 0, emailed: false };

  const [profile, user, photo] = await Promise.all([
    f.user_id ? admin.from('profiles').select('username').eq('id', f.user_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    f.user_id ? admin.auth.admin.getUserById(f.user_id) : Promise.resolve({ data: { user: null }, error: null }),
    f.photo_path ? admin.storage.from('feedback').createSignedUrl(f.photo_path, 7 * 24 * 3600) : Promise.resolve({ data: null, error: null }),
  ]);
  if (profile.error) throw profile.error;
  // A missing account or photo still sends the message.
  if (user.error) console.error('notify: feedback sender not read', user.error);
  if (photo.error) console.error('notify: feedback photo not signed', photo.error);

  const emailed = await emailFeedback(
    feedbackEmail({
      kind: f.kind,
      message: f.message,
      username: profile.data?.username ?? null,
      replyTo: user.data?.user?.email ?? null,
      appVersion: f.app_version,
      os: f.os,
      osVersion: f.os_version,
      photoUrl: photo.data?.signedUrl ?? null,
    }),
  );
  const tokens = await ownerTokens(admin);
  return { sent: tokens.length ? await send(admin, tokens, feedbackPush(f.kind)) : 0, emailed };
}

export default {
  fetch: withSupabase({ auth: ['secret'] }, async (req, ctx) => {
    const body = await req.json();
    try {
      if (typeof body.check_in === 'string') {
        return Response.json({ sent: await checkInToReview(ctx.supabaseAdmin, body.check_in, body.new_photo === true) });
      }
      if (typeof body.check_in_result === 'string') {
        return Response.json({ sent: await checkInResult(ctx.supabaseAdmin, body.check_in_result) });
      }
      if (typeof body.quiz_open === 'string' && Number.isInteger(body.day)) {
        return Response.json({ sent: await quizOpen(ctx.supabaseAdmin, body.quiz_open, body.day) });
      }
      if (typeof body.pledge === 'string') {
        return Response.json({ sent: await newPledge(ctx.supabaseAdmin, body.pledge) });
      }
      if (typeof body.solana_payment === 'string') {
        return Response.json({ sent: await paymentReceived(ctx.supabaseAdmin, body.solana_payment) });
      }
      if (typeof body.friend_request === 'string') {
        return Response.json({ sent: await friendRequest(ctx.supabaseAdmin, body.friend_request) });
      }
      if (typeof body.report === 'string') {
        return Response.json({ sent: await newReport(ctx.supabaseAdmin, body.report) });
      }
      if (typeof body.challenge_result === 'string') {
        return Response.json({ sent: await challengeResult(ctx.supabaseAdmin, body.challenge_result) });
      }
      if (['reward', 'money_waiting', 'sent_back', 'takeback'].some((k) => typeof body[k] === 'string')) {
        return Response.json({ sent: await moneyMoved(ctx.supabaseAdmin, body) });
      }
      if (typeof body.feedback === 'string') {
        return Response.json(await newFeedback(ctx.supabaseAdmin, body.feedback));
      }
      return Response.json({ error: 'unknown_event' }, { status: 400 });
    } catch (e) {
      console.error('notify: failed', JSON.stringify(body), e);
      return Response.json({ error: 'failed' }, { status: 500 });
    }
  }),
};
