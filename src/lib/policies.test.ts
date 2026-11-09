// Pins what Kept's policies must always say (T50; SPEC.md money rules and "Who runs Kept";
// plan.md decisions 34–39): who runs Kept and how to reach them, every service that receives
// personal data, the Day 1 grace period with a non-refundable fee, and credits never described as
// a return or an investment. The same text becomes the app's pages, the Word files and the web pages.

import { cardAuthorization, isPolicyId, OPERATOR, POLICIES, POLICY_IDS, type PolicyId } from './policies';

/** Every word of one policy, as a reader would see it. */
function fullText(id: PolicyId): string {
  const { title, intro, sections } = POLICIES[id];
  return [title, intro, ...sections.flatMap((s) => [s.heading, ...s.body.flat()])].join('\n');
}

describe('the card authorization shown before paying (T179, decision 142)', () => {
  it('authorizes one charge now, says where money that comes back goes, and that the fee stays', () => {
    expect(cardAuthorization('stake')).toBe(
      'By signing, you authorize Kept to charge your card the total above now: your stake and Kept’s service fee. ' +
        'Whatever of your stake comes back goes back to this card or stays in your Kept balance, as you choose. The fee isn’t refunded.',
    );
    expect(cardAuthorization('pledge')).toMatch(/^By pledging, you authorize Kept to charge your card the total above now: your pledge/);
    expect(cardAuthorization('gift')).toBe('By giving, you authorize Kept to charge your card this gift now, with no fee. It all goes to the charity and isn’t refunded.');
  });
});

describe('policies', () => {
  it('has the four documents, in the order Settings lists them', () => {
    expect(POLICY_IDS).toEqual(['terms', 'privacy', 'refunds', 'community']);
  });

  it.each(POLICY_IDS)('%s names who runs Kept and how to reach them', (id) => {
    const text = fullText(id);
    expect(text).toContain(OPERATOR.name);
    expect(text).toContain(OPERATOR.email);
    expect(text).not.toMatch(/Portland, OR \d{5}/); // no postal address is published (decision 116)
  });

  it.each(POLICY_IDS)('%s never calls anything on Kept an investment or a return on money', (id) => {
    expect(fullText(id)).not.toMatch(/invest|return on/i);
  });

  it('privacy and terms: nothing goes to the AI provider unless the user allowed it (T54)', () => {
    expect(fullText('privacy')).toMatch(/nothing goes to Anthropic unless you said yes/);
    expect(fullText('terms')).toMatch(/If you don’t allow Kept’s AI, only those friends check your days/);
  });

  it('privacy names every outside service that receives personal data', () => {
    const text = fullText('privacy');
    for (const service of ['Supabase', 'Anthropic', 'Have I Been Pwned', 'Resend', 'Expo’s push service', 'Cloudflare']) expect(text).toContain(service);
  });

  it('privacy: Resend sends the email (T36), and the habitkept.com waitlist is covered, with a way off it (T90)', () => {
    const text = fullText('privacy');
    expect(text).not.toContain('Gmail');
    expect(text).toContain('If you join the waitlist on habitkept.com: your email address');
    expect(text).toMatch(/Every launch email has a link to leave the list/);
    expect(text).toMatch(/A waitlist email is deleted/);
  });

  it('refunds: cancelling until the end of Day 1 returns the stake and pledges, and the fee is non-refundable', () => {
    const text = fullText('refunds');
    expect(text).toMatch(/until the end of (its|the challenge’s) Day 1/);
    expect(text).toMatch(/non-refundable once you sign/);
  });

  it('refunds and terms: the fee is on top of a pledge too, listed before paying, and kept if the pledge comes back (T63)', () => {
    for (const doc of ['refunds', 'terms'] as const) expect(fullText(doc)).toMatch(/on top of your stake or pledge/);
    expect(fullText('refunds')).toMatch(/pledge’s fee is non-refundable once you pledge/);
  });

  it('community rules explain how to get an intimate image removed within 48 hours (TAKE IT DOWN Act)', () => {
    const text = fullText('community');
    expect(text).toMatch(/intimate/i);
    expect(text).toMatch(/within 48 hours/);
    expect(text).toMatch(/signature/i);
  });

  it('keeps the legal review fixes (2026-10-21, plan.md decisions 115–124)', () => {
    const terms = fullText('terms');
    const privacy = fullText('privacy');
    expect(OPERATOR.name).toBe('Ka Technology LLC');
    expect(terms).toMatch(/Kept’s revenue is the service fee and half of any shield you buy/);
    expect(terms).not.toMatch(/someone else’s failure/);
    expect(terms).toMatch(/you authorize Kept to charge it later/);
    expect(terms).toMatch(/Kept holds that USDC in its treasury wallet/);
    expect(terms).toMatch(/That limit never applies to money Kept charged, held or donated by mistake/);
    expect(privacy).toMatch(/Do Not Track/);
    expect(privacy).toMatch(/Consumer health data/);
    // The separate health consent is asked now (T179), not "before real money arrives".
    expect(privacy).toMatch(/Kept asks for your consent, separately from these policies, before your first challenge or tracker with a health habit/);
    expect(privacy).not.toMatch(/health data or advertising ID/);
    expect(privacy).not.toContain('Ka Tech ');
    for (const service of ['Google', 'Stripe Identity', 'Every.org', 'Sentry', 'Solana']) expect(privacy).toContain(service);
    expect(fullText('refunds')).toMatch(/never earns more credits than the service fee/);
  });

  it('charities: Kept checks its own short list, not the nonprofits found through Every.org, and the search is disclosed', () => {
    const terms = fullText('terms');
    expect(terms).toMatch(/Kept chooses and checks its own short list of charities/);
    expect(terms).toMatch(/search for any US nonprofit through Every.org; Kept doesn’t check those itself/);
    expect(terms).not.toMatch(/Kept checks each charity on its list/);
    expect(fullText('privacy')).toMatch(/Every.org supplies Kept’s charity search: .*without your name or account/);
  });

  it('signing: drawn or adopted in your full name, binding, and kept with the text signed (decision 171)', () => {
    const terms = fullText('terms');
    expect(terms).toMatch(/by drawing your signature or adopting your full name in script/);
    expect(terms).toMatch(/binds you as a handwritten signature would/);
    expect(terms).toMatch(/You agree to sign Kept’s agreements electronically/);
    expect(fullText('privacy')).toMatch(/your signature and the promise you signed, word for word/);
  });

  it('privacy says where to report a security problem', () => {
    expect(fullText('privacy')).toMatch(/security problem[^.]*hello@habitkept\.com/i);
  });

  it('knows its own ids and nothing else', () => {
    expect(isPolicyId('privacy')).toBe(true);
    expect(isPolicyId('rules')).toBe(false);
    expect(isPolicyId(undefined)).toBe(false);
  });
});
