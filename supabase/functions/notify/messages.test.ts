// Unit tests for messages.ts: what each push says and who it goes to (T34, SPEC-notifications.md).
// Run with the app's jest.
import { LANGUAGES } from '../../../src/lib/challenges';
import { SEND_BACK_DAYS as APP_SEND_BACK_DAYS } from '../../../src/lib/pledges';
import { OPERATOR } from '../../../src/lib/policies';
import {
  batches,
  beforeReviewCutoff,
  FEEDBACK_TO,
  feedbackEmail,
  feedbackPush,
  friendRequestPush,
  goneTokens,
  habitLabel,
  LANGUAGE_NAMES,
  moneyPush,
  SEND_BACK_DAYS,
  paymentPush,
  pledgePush,
  quizOpenPush,
  reportPush,
  resultsPush,
  resultPush,
  reviewPush,
} from './messages';

describe('beforeReviewCutoff (friends are pushed only while their review can count)', () => {
  it('is true until 10 pm in the challenge’s zone, and false from 10 pm', () => {
    // 21:59 and 22:00 in Los Angeles (UTC−7 in September).
    expect(beforeReviewCutoff('America/Los_Angeles', new Date('2026-09-29T04:59:00Z'))).toBe(true);
    expect(beforeReviewCutoff('America/Los_Angeles', new Date('2026-09-29T05:00:00Z'))).toBe(false);
  });

  it('follows the challenger’s step-in time', () => {
    // 10:20 pm in Los Angeles: past 10 pm, but before a 10:30 pm choice.
    const now = new Date('2026-09-29T05:20:00Z');
    expect(beforeReviewCutoff('America/Los_Angeles', now)).toBe(false);
    expect(beforeReviewCutoff('America/Los_Angeles', now, 1350)).toBe(true);
    expect(beforeReviewCutoff('America/Los_Angeles', new Date('2026-09-29T05:30:00Z'), 1350)).toBe(false);
  });

  it('keeps pushing friends until midnight for a midnight choice, not only until the quiz’s 11 pm', () => {
    expect(beforeReviewCutoff('America/Los_Angeles', new Date('2026-09-29T06:30:00Z'), 1440)).toBe(true); // 11:30 pm
  });

  it('uses the challenge’s zone, not the server’s', () => {
    // 22:30 UTC is 3:30 pm in Los Angeles and 7:30 am the next day in Seoul.
    const now = new Date('2026-09-29T22:30:00Z');
    expect(beforeReviewCutoff('America/Los_Angeles', now)).toBe(true);
    expect(beforeReviewCutoff('Asia/Seoul', now)).toBe(true);
    expect(beforeReviewCutoff('Europe/London', now)).toBe(false);
  });
});

describe('habitLabel', () => {
  it('uses the habit’s name, or the language for Learn a language', () => {
    expect(habitLabel('Walk or run', null)).toBe('Walk or run');
    expect(habitLabel('Learn a language', 'korean')).toBe('Learn Korean');
    expect(habitLabel('Learn a language', 'mandarin')).toBe('Learn Mandarin Chinese');
  });

  it('names every language the app offers, the same way', () => {
    expect(LANGUAGE_NAMES).toEqual(Object.fromEntries(LANGUAGES.map((l) => [l.code, l.name])));
  });
});

describe('reviewPush', () => {
  const base = { username: 'ana', habit: 'Walk or run', day: 5, checkInId: 'c1' };

  it('asks friends to approve a new check-in, and opens the review screen', () => {
    expect(reviewPush({ ...base, newPhoto: false })).toEqual({
      title: '@ana checked in',
      body: 'Day 5 of Walk or run. Can you approve it?',
      data: { url: '/review/c1' },
      sound: 'default',
    });
  });

  it('says when it’s a new photo after a friend’s flag', () => {
    const push = reviewPush({ ...base, newPhoto: true });
    expect(push.title).toBe('@ana sent a new photo');
    expect(push.body).toBe('Day 5 of Walk or run. Can you approve it now?');
  });
});

describe('resultPush (T59: your check-in needs a new photo, or wasn’t approved)', () => {
  const base = { habit: 'Walk or run', day: 5, challengeId: 'ch1' };

  it('a friend’s flag names the friend and the 10 pm deadline, never their note', () => {
    expect(resultPush({ ...base, status: 'flagged', reviewer: 'ben' })).toEqual({
      title: '@ben asked for a new photo',
      body: 'Day 5 of Walk or run. Send a new one before 10 pm.',
      data: { url: '/check-in/ch1?day=5' },
      sound: 'default',
    });
  });

  it('says "A friend" if the friend’s username can’t be read', () => {
    expect(resultPush({ ...base, status: 'flagged', reviewer: null }).title).toBe('A friend asked for a new photo');
  });

  it('the AI’s retake asks for a new photo before midnight', () => {
    const push = resultPush({ ...base, status: 'retake', reviewer: null });
    expect(push.title).toBe('Take a new photo');
    expect(push.body).toBe('Kept’s AI couldn’t confirm Day 5 of Walk or run. Send a new one before midnight.');
    expect(push.sound).toBe('default');
  });

  it('a rejection offers the appeal, silently, and opens that day', () => {
    const push = resultPush({ ...base, status: 'rejected', reviewer: null });
    expect(push).toEqual({
      title: 'Day 5 wasn’t approved',
      body: 'Kept’s AI didn’t approve Day 5 of Walk or run. You can appeal within 7 days.',
      data: { url: '/check-in/ch1?day=5' },
    });
  });

  it('a day missed without the AI (Don’t allow, T54) says no friend approved it, not the AI', () => {
    const push = resultPush({ ...base, status: 'rejected', reviewer: null, byAI: false });
    expect(push.body).toBe('No friend who backs you approved Day 5 of Walk or run before it ended. You can appeal within 7 days.');
  });
});

describe('resultPush for the AI’s own decisions (a day it approved, or counted without a verdict)', () => {
  const base = { habit: 'Walk or run', day: 5, challengeId: 'ch1', reviewer: null };

  it('an approval says so, silently, and opens that day', () => {
    expect(resultPush({ ...base, status: 'approved', verdict: 'approve' })).toEqual({
      title: 'Day 5 is kept',
      body: 'Kept’s AI approved Day 5 of Walk or run.',
      data: { url: '/check-in/ch1?day=5' },
    });
  });

  it('a day the AI couldn’t tell on counts, and says it didn’t approve the photo', () => {
    for (const verdict of ['retake', 'unsure']) {
      expect(resultPush({ ...base, status: 'approved', verdict })).toEqual({
        title: 'Day 5 counts',
        body: 'Kept’s AI couldn’t tell, so Day 5 of Walk or run counts as kept.',
        data: { url: '/check-in/ch1?day=5' },
      });
    }
  });

  it('a day Kept’s AI never got to check counts, and says so', () => {
    expect(resultPush({ ...base, status: 'excused' })).toEqual({
      title: 'Day 5 counts',
      body: 'Kept’s AI didn’t get to check Day 5 of Walk or run, so it counts as kept.',
      data: { url: '/check-in/ch1?day=5' },
    });
  });
});

describe('quizOpenPush (the quiz is open, at the user’s step-in time)', () => {
  it('says which day and habit, makes a sound, and opens that day', () => {
    expect(quizOpenPush({ habit: 'Learn Korean', day: 5, challengeId: 'ch1' })).toEqual({
      title: 'Your quiz is open',
      body: 'Take Day 5’s quiz for Learn Korean before midnight.',
      data: { url: '/check-in/ch1?day=5' },
      sound: 'default',
    });
  });
});

describe('resultsPush (T177: a challenge ended, finished or not)', () => {
  const base = { habit: 'Work out', challengeId: 'ch1', stakeCents: 2500, charity: 'ASPCA', username: 'alex' };

  it('tells the challenger how it ended, and opens their results', () => {
    expect(resultsPush({ ...base, role: 'challenger', finished: true })).toEqual({
      title: 'You kept it',
      body: 'Work out is done, and your $25 stake comes back. See your results.',
      data: { url: '/challenge/ch1/results' },
      sound: 'default',
    });
    expect(resultsPush({ ...base, role: 'challenger', finished: false })).toEqual({
      title: 'Not this time',
      body: 'Work out ended, and your $25 stake goes to ASPCA. See your results.',
      data: { url: '/challenge/ch1/results' },
    });
  });

  it('tells a supporter by name, and a backer without one, opening their pledge', () => {
    expect(resultsPush({ ...base, role: 'supporter', finished: true })).toEqual({
      title: '@alex kept it',
      body: 'Work out is done. See where your pledge went.',
      data: { url: '/pledge/ch1' },
    });
    expect(resultsPush({ ...base, role: 'backer', finished: false })).toEqual({
      title: 'A challenge you backed ended',
      body: 'Work out wasn’t finished. See where your pledge went.',
      data: { url: '/pledge/ch1' },
    });
  });
});

describe('moneyPush (T199, decision 160: your own money moved, or waits for you)', () => {
  it('“Your reward is in”, with a sound, opening the results', () => {
    expect(moneyPush({ kind: 'reward', cents: 5000, habit: 'Work out', challengeId: 'ch1' })).toEqual({
      title: 'Your reward is in',
      body: '$50 for finishing Work out is in your Kept balance.',
      data: { url: '/challenge/ch1/results' },
      sound: 'default',
    });
  });

  it('“Money is waiting” when the challenge ends, and on day 10 with the days left', () => {
    expect(moneyPush({ kind: 'waiting', cents: 2500, habit: 'Read', challengeId: 'ch1' })).toEqual({
      title: 'Money is waiting',
      body: 'Your $25 from Read: keep it in Kept or send it back to your card.',
      data: { url: '/wallet' },
    });
    expect(moneyPush({ kind: 'reminder', cents: 2550, habit: 'Read', challengeId: 'ch1' })).toEqual({
      title: 'Money is waiting',
      body: 'Your $25.50 from Read goes back to your card in 4 days, unless you keep it in Kept.',
      data: { url: '/wallet' },
    });
  });

  it('“Sent back to your card”, saying banks take a few days', () => {
    expect(moneyPush({ kind: 'sent_back', cents: 2500, habit: 'Read', challengeId: 'ch1' })).toEqual({
      title: 'Sent back to your card',
      body: 'Your $25 from Read is on its way to your card. Banks can take 5 to 10 days to show it.',
      data: { url: '/wallet' },
    });
  });

  it('counts the days as the app and the database do', () => {
    expect(SEND_BACK_DAYS).toBe(APP_SEND_BACK_DAYS);
  });

  it('“A pledge was taken back”, never naming who pledged', () => {
    expect(moneyPush({ kind: 'takeback', cents: 2500, habit: 'Work out', challengeId: null })).toEqual({
      title: 'A pledge was taken back',
      body: 'Its bank took back a $25 pledge on Work out, so it came out of your Kept balance.',
      data: { url: '/wallet' },
    });
  });
});

describe('paymentPush (T169: your wallet payment arrived)', () => {
  it('names the token and the stake, plays a sound, and opens the challenge', () => {
    expect(paymentPush({ token: 'USDC', stakeCents: 2500, habit: 'Read', challengeId: 'ch1' })).toEqual({
      title: 'Payment received',
      body: 'Your $25 USDC stake for Read is in. Tap to open Kept.',
      data: { url: '/challenge/ch1' },
      sound: 'default',
    });
  });

  it('shows cents only when there are some', () => {
    expect(paymentPush({ token: 'PYUSD', stakeCents: 1050, habit: 'Walk or run', challengeId: 'ch1' }).body).toContain('$10.50 PYUSD');
  });
});

describe('pledgePush (T55: someone backs you)', () => {
  it('names a friend, silently, and opens the challenge', () => {
    expect(pledgePush({ kind: 'supporter', username: 'ben', habit: 'Walk or run', challengeId: 'ch1' })).toEqual({
      title: '@ben backed you',
      body: 'They pledged behind Walk or run.',
      data: { url: '/challenge/ch1' },
    });
  });

  it('says "A friend" if the friend’s username can’t be read', () => {
    expect(pledgePush({ kind: 'supporter', username: null, habit: 'Walk or run', challengeId: 'ch1' }).title).toBe('A friend backed you');
  });

  it('never names a backer, even if a username is passed', () => {
    const push = pledgePush({ kind: 'backer', username: 'stranger', habit: 'Walk or run', challengeId: 'ch1' });
    expect(push).toEqual({
      title: 'Someone backed you',
      body: 'They found Walk or run on Discover and pledged behind it.',
      data: { url: '/challenge/ch1' },
    });
    expect(JSON.stringify(push)).not.toContain('stranger');
  });
});

describe('friendRequestPush (T56)', () => {
  it('names who asked and opens Friends', () => {
    expect(friendRequestPush('ana')).toEqual({
      title: '@ana sent you a friend request',
      body: 'Accept it in Friends to see each other’s challenges.',
      data: { url: '/friends' },
      sound: 'default',
    });
  });
});

describe('reportPush (T53: the owner hears about each report the same day)', () => {
  it('says what was reported and why, with the 48-hour reminder for an intimate image, and nothing else', () => {
    expect(reportPush({ reason: 'intimate_image', what: 'check-in' })).toEqual({
      title: 'New report: an intimate image',
      body: 'A check-in was reported. Remove it within 48 hours if it breaks the rules (Supabase dashboard → reports).',
      sound: 'default',
    });
    expect(reportPush({ reason: 'spam', what: 'person' })).toEqual({
      title: 'New report: spam or a fake account',
      body: 'A person was reported. Review it in the Supabase dashboard → reports.',
      sound: 'default',
    });
  });

  it('never carries the note, a name or a link into the app', () => {
    const push = reportPush({ reason: 'harassment', what: 'challenge' });
    expect(push.data).toBeUndefined();
    expect(JSON.stringify(push)).not.toMatch(/@/);
  });
});

describe('feedbackPush (T158: the owner hears about each piece of feedback)', () => {
  it('says what kind it is and where to read it, and never the message', () => {
    expect(feedbackPush('habit')).toEqual({ title: 'New feedback: a habit to add', body: 'Read it in your email or the Supabase dashboard → feedback.' });
    expect(feedbackPush('bug').title).toBe('New feedback: a bug');
    expect(feedbackPush('unknown').title).toBe('New feedback: unknown');
  });
});

describe('feedbackEmail (T158)', () => {
  const feedback = {
    kind: 'bug',
    message: 'The camera froze on Day 3.\nI had to restart.',
    username: 'ben',
    appVersion: '1.0.0',
    os: 'ios',
    osVersion: '26.1',
    photoUrl: 'https://example.supabase.co/storage/v1/object/sign/feedback/u/1.jpg?token=t',
  };

  it('goes to the address the app shows, replying to the sender', () => {
    expect(FEEDBACK_TO).toBe(OPERATOR.email);
    const email = feedbackEmail({ ...feedback, replyTo: 'ben@example.com' });
    expect(email.to).toBe(OPERATOR.email);
    expect(email.from).toBe('Kept <no-reply@habitkept.com>');
    expect(email.reply_to).toBe('ben@example.com');
    expect(email.subject).toBe('Kept feedback: a bug from @ben');
  });

  it('carries the message, the versions and the photo link as plain text', () => {
    const { text } = feedbackEmail({ ...feedback, replyTo: 'ben@example.com' });
    expect(text).toContain('The camera froze on Day 3.\nI had to restart.');
    expect(text).toContain('Kept 1.0.0 on ios 26.1');
    expect(text).toContain(`Photo (link works for 7 days): ${feedback.photoUrl}`);
  });

  it('copes with a deleted sender, no email and no photo', () => {
    const email = feedbackEmail({ ...feedback, username: null, replyTo: null, photoUrl: null });
    expect(email.subject).toBe('Kept feedback: a bug from a deleted account');
    expect(email.reply_to).toBeUndefined();
    expect(email.text).not.toContain('Photo');
  });
});

describe('batches', () => {
  it('sends one message per token, at most 100 per request', () => {
    const tokens = Array.from({ length: 201 }, (_, i) => `ExponentPushToken[${i}]`);
    const sent = batches(tokens, { title: 't', body: 'b' });
    expect(sent.map((b) => b.length)).toEqual([100, 100, 1]);
    expect(sent[2][0]).toEqual({ to: 'ExponentPushToken[200]', title: 't', body: 'b' });
  });
});

describe('goneTokens', () => {
  it('picks the tokens Expo says are gone, matching tickets to messages by position', () => {
    const messages = [{ to: 'a' }, { to: 'b' }, { to: 'c' }];
    const tickets = [
      { status: 'ok' },
      { status: 'error', details: { error: 'DeviceNotRegistered' } },
      { status: 'error', details: { error: 'MessageRateExceeded' } },
    ];
    expect(goneTokens(messages, tickets)).toEqual(['b']);
  });
});
