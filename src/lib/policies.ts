// Kept's policies (T50): the terms of service, privacy policy, refunds and cancellation, and
// community rules, as rough drafts for counsel (SPEC.md open question 5). This file is the only
// source: the app shows each one under Settings → About Kept (app/policy/[doc].tsx), and
// docs/legal/build-policies.cjs turns the same text into Word files and web pages for habitkept.com.
// It has no imports and only erasable TypeScript, so Node can load it directly for that build.
// The official rules stay in app/rules.tsx, which reads the stake limits from the code.

/** Who runs Kept and how to reach them (owner, 2026-09-27; Ka Technology since 2026-10-18, decision 104; SPEC.md "Who runs Kept"). No postal address is published (decision 116). */
export const OPERATOR = {
  name: 'Ka Technology LLC',
  place: 'Portland, Oregon',
  email: 'hello@habitkept.com',
  law: 'Oregon',
};

/** The date on every policy. Change it whenever a policy's text changes. */
export const POLICIES_UPDATED = 'November 2, 2026';

/**
 * The card authorization the sign step and the pledge sheet show above the button when a card pays (T179, decision
 * 142: one charge now, refunds later), stored with the charge it authorizes (charges.card_authorization, migration 0076).
 * The Terms' own "Paying by card" section is rewritten with counsel (T192).
 */
export function cardAuthorization(what: 'stake' | 'pledge' | 'gift'): string {
  if (what === 'gift') return 'By giving, you authorize Kept to charge your card this gift now, with no fee. It all goes to the charity and isn’t refunded.';
  return (
    `By ${what === 'stake' ? 'signing' : 'pledging'}, you authorize Kept to charge your card the total above now: your ${what} and Kept’s service fee. ` +
    `Whatever of your ${what} comes back goes back to this card or stays in your Kept balance, as you choose. The fee isn’t refunded.`
  );
}

/** Shown above every policy until a lawyer has approved it. */
export const DRAFT_NOTICE = 'Draft for legal review.';

/** The documents, in the order Settings lists them. */
export const POLICY_IDS = ['terms', 'privacy', 'refunds', 'community'] as const;

export type PolicyId = (typeof POLICY_IDS)[number];

/** A paragraph, or a list of bullet points. */
export type PolicyBlock = string | string[];

export type PolicySection = { heading: string; body: PolicyBlock[] };

export type Policy = { title: string; intro: string; sections: PolicySection[] };

/** Whether a route parameter names one of the policies. */
export function isPolicyId(value: unknown): value is PolicyId {
  return typeof value === 'string' && (POLICY_IDS as readonly string[]).includes(value);
}

const { name, place, email, law } = OPERATOR;

/** The last section of every policy. */
const CONTACT: PolicySection = {
  heading: 'Contact',
  body: [`Kept is run by ${name}, ${place}.`, [`Email: ${email}`]],
};

const TERMS: Policy = {
  title: 'Terms of Service',
  intro: `These terms are the agreement between you and ${name}, who runs Kept (“Kept”, “we”). By creating an account or using Kept, you agree to them and to Kept’s Privacy Policy, Refunds and Cancellation policy, Community Rules and Official Rules, which are part of these terms.`,
  sections: [
    {
      heading: 'Who runs Kept',
      body: [
        `Kept is run by ${name}, in ${place}. If another company takes over the service, we’ll tell you in the app first, and these terms and our privacy promises go with it.`,
      ],
    },
    {
      heading: 'Who can use Kept',
      body: [
        [
          'You must be 18 or older and live in the United States.',
          'One account per person. Give your real date of birth and state.',
          'Keep your password to yourself. You’re responsible for what happens in your account.',
        ],
      ],
    },
    {
      heading: 'Your license to use Kept',
      body: [
        `${name} gives you a personal, non-exclusive, non-transferable license to use the Kept app on Apple devices you own or control, as the App Store’s Usage Rules allow. Kept’s app, name, design and code belong to ${name}, and this license gives you no other rights in them. Don’t copy, change, resell or reverse-engineer the app, or use it to break the law.`,
      ],
    },
    {
      heading: 'While Kept is in beta',
      body: ['Features may change or be removed, and data may be reset.'],
    },
    {
      heading: 'Challenges',
      body: [
        'You pick a habit, a length, a stake, a way to pay and a charity (one of Kept’s choices, or any US nonprofit found through Every.org), and you agree to each challenge separately by signing it in your full name, by drawing your signature or adopting your full name in script. That signature binds you as a handwritten signature would. Nothing renews by itself. The Official Rules explain shields, missed days, limits and where the money goes.',
        'You can cancel a challenge until the end of its Day 1, and quit after that, as the Refunds and Cancellation policy explains.',
      ],
    },
    {
      heading: 'How days are checked',
      body: [
        'Friends who back your challenge with a pledge approve your check-ins. If none has by the deadline and you allow Kept’s AI, it checks the day, and for some habits it asks you a short quiz. Friends can ask for a new photo, but they can’t reject a day. If you don’t allow Kept’s AI, only those friends check your days, and a day none of them approves by midnight counts as missed. Kept asks before your first check-in, and you can change your answer in Settings → Privacy & security.',
        'AI can make mistakes, so a person has the final say on a failure: you can appeal a failed day within 7 days, once per check-in. A person at Kept decides every appeal, usually within 7 days, and that decision is final within Kept. A day that fails because of an error on Kept’s side, not yours, counts as done.',
      ],
    },
    {
      heading: 'Pledges and Kept credits',
      body: [
        'Friends (supporters) can pledge behind your challenge, and so can people who find a challenge you made public (backers). A pledge goes to your charity if you finish and back to the pledger if you don’t, unless they chose to donate. A pledge can be withdrawn until the end of the challenge’s Day 1, and only raised after that.',
        'Backers whose challenger finishes earn Kept credits, a share of their pledge set by Kept, and never more than the service fee they paid on that pledge. Credits only pay toward Kept’s own service fee. Credits aren’t money: they can’t be withdrawn, sold, sent to anyone or exchanged for cash, and they end when your account is deleted. Kept may change the credit rate for pledges made after the change.',
      ],
    },
    {
      heading: 'Real money, when it arrives',
      body: [
        'When Kept takes real money, the service fee is charged on top of your stake or pledge, shown to the cent with the total before you sign or pledge, and non-refundable once paid. Kept isn’t a bank and pays no interest. No user ever wins another user’s money. Kept’s revenue is the service fee and half of any shield you buy.',
        'Before your first real stake, Kept checks your ID through Stripe Identity, so each person has one account.',
      ],
    },
    {
      heading: 'Paying by card, Apple Pay or Link',
      body: [
        'When real money arrives, cards, Apple Pay and Link go through Stripe, Kept’s payment processor. Kept never sees your full card number. When you save one and sign a challenge or make a pledge, you authorize Kept to charge it later, without asking you again, for:',
        [
          'the service fee, when you sign or pledge;',
          'your stake, if you don’t finish, when the challenge ends (at most 365 completed days after it starts, plus a day for each missed day a shield covered);',
          'a pledge that goes to the charity, if you haven’t given it on Every.org within 7 days of the challenge’s end;',
          'a shield or gift, when you buy it;',
          'any of these charges if the first try is declined.',
        ],
        'No charge is ever more than the amount shown when you signed or pledged, plus any raise you make. Every charge shows in Wallet. You can end this authorization for a challenge by cancelling it, or for a pledge by withdrawing it, until the end of the challenge’s Day 1. After that, the authorization lasts until the challenge ends and its charges are settled. Removing your card doesn’t cancel a charge you’ve already agreed to.',
      ],
    },
    {
      heading: 'Paying with USDC',
      body: [
        'When real money arrives, if you pay with USDC on Solana, you send the stake, the fee and any pledge from your own wallet to Kept’s treasury wallet when you sign or pledge. Kept holds that USDC in its treasury wallet until the challenge ends, then returns it to the wallet it came from or donates it, under the Refunds and Cancellation policy. Kept never holds your wallet’s keys.',
        'A transfer on Solana can’t be reversed, so check the address and amount in your wallet before you send. Send only from a wallet you control. USDC is issued by Circle, which can freeze it, and Kept may refuse, hold or report a transfer from or to a wallet on a US sanctions list.',
      ],
    },
    {
      heading: 'Electronic records',
      body: [
        `You agree to sign Kept’s agreements electronically, and to get Kept’s agreements, receipts, notices and disclosures electronically, in the app or by email. Each challenge’s signed promise stays in the app, under that challenge, for you to read. You can ask for a paper copy at ${email}, at no charge. You can withdraw this consent by deleting your account; that doesn’t undo agreements you’ve already made.`,
      ],
    },
    {
      heading: 'Charities',
      body: [
        'Kept chooses and checks its own short list of charities. You can also search for any US nonprofit through Every.org; Kept doesn’t check those itself. Donations, when they’re real, go through Every.org. Kept gives in its own name, so the gift is Kept’s and you get no tax receipt for it; your Wallet records it as given for you. Naming donors on their gifts may come later. The charities aren’t part of Kept and aren’t responsible for it, and listing a charity doesn’t mean it endorses Kept. Their names and logos belong to them.',
      ],
    },
    {
      heading: 'Your content',
      body: [
        'You own the photos, notes and answers you add. You let Kept store them, show them to the people the app says can see them, and send them to the services in the Privacy Policy (including the AI that checks days), only to run Kept. That permission ends when you delete them or your account.',
        'Only add content you have the right to share, and follow the Community Rules.',
        'If you send Kept feedback or an idea, Kept may use it freely, without owing you anything.',
      ],
    },
    {
      heading: 'Your health and safety',
      body: [
        'Kept isn’t medical advice. Check with a doctor before starting a habit like exercise or a change in diet, and stop if it’s hurting you.',
        'Physical habits like running, biking and workouts can cause injury. You choose your habit and how you do it, and as far as the law allows, you take on that risk. Never break a law or put yourself or anyone else in danger to check in.',
      ],
    },
    {
      heading: 'Ending your account',
      body: [
        'You can delete your account at any time in Settings. We may suspend or close an account that breaks these terms or the Community Rules.',
      ],
    },
    {
      heading: 'Apple',
      body: [
        'These terms are between you and Kept, not Apple. Apple isn’t a sponsor of Kept or its challenges, isn’t responsible for Kept or its content, and has no duty to maintain or support it. Apple isn’t responsible for claims about Kept, including product liability, legal or regulatory compliance and consumer protection claims; Kept handles those, using the contact details below. If anyone claims that Kept or your use of it infringes their intellectual property, Kept, not Apple, is responsible for dealing with that claim. You must follow any third-party terms that apply when you use Kept, such as your wireless carrier’s. If Kept fails a warranty that applies, you may tell Apple, which may refund the app’s price (Kept is free), and Apple has no other warranty duty. You confirm you aren’t in a country under a US embargo and aren’t on a US government list of restricted parties. Apple and its subsidiaries may enforce these terms against you.',
      ],
    },
    {
      heading: 'Warranties and liability',
      body: [
        'Kept is provided “as is” and “as available”, without warranties, as far as the law allows. As far as the law allows, Kept isn’t liable for indirect or consequential losses, and its total liability to you is limited to the fees you paid Kept in the 12 months before your claim.',
        'That limit never applies to money Kept charged, held or donated by mistake, such as a stake sent to a charity because of a wrong decision on a day. Kept pays that back in full.',
      ],
    },
    {
      heading: 'Law and disputes',
      body: [
        `${law} law governs these terms. Before bringing a claim, email us so we can try to fix it. Claims go to the state or federal courts in ${law}, or to small-claims court where you live.`,
      ],
    },
    {
      heading: 'Changes',
      body: [
        'We’ll tell you in the app before changes to these terms take effect. If you keep using Kept after that, you accept them; if you don’t agree, you can delete your account. A challenge or pledge you’ve already signed keeps the terms in effect when you signed it until it ends, unless the law requires otherwise.',
      ],
    },
    {
      heading: 'General terms',
      body: [
        [
          'Severability: if a court finds part of these terms unenforceable, that part is enforced as far as the law allows, and the rest still applies.',
          'Entire agreement: these terms, with the policies and rules they name, are the whole agreement between you and Kept about Kept, and replace anything said before about it.',
          'No waiver: if we don’t enforce a term right away, we can still enforce it later.',
          `Assignment: you can’t transfer these terms to anyone. ${name} may transfer them to a company that takes over Kept, as “Who runs Kept” says, and they bind that company.`,
          'No third-party beneficiaries: these terms give rights only to you and Kept.',
          'Headings: the headings are for reading ease and don’t change what the terms mean.',
        ],
      ],
    },
  ],
};

const PRIVACY: Policy = {
  title: 'Privacy Policy',
  intro: `This policy explains what Kept collects, why, who it goes to, and your choices. Kept is run by ${name} (“Kept”, “we”). Kept doesn’t sell your information, share it for advertising, or track you across other apps and websites. Because it doesn’t track you, it treats every visit and every use the same whether or not your browser or phone sends a Do Not Track signal.`,
  sections: [
    {
      heading: 'What Kept collects',
      body: [
        [
          'Your account: your email address and password. The password is stored only in scrambled (hashed) form.',
          'Your profile: your first and last name (never shown to anyone; for your account and payments), username, date of birth, state, and a profile photo if you add one.',
          'Your challenges: the habit (and language and level), length, stake, charity, way to pay, your time zone, when you signed, and your signature and the promise you signed, word for word. Only you can see your signature.',
          'Your check-ins: photos taken with Kept’s camera (or screenshots, for habits that allow them) and when they arrived, notes you write, the book and pages you read, quiz questions and your answers, friends’ approvals and notes, the AI’s decisions, and appeals.',
          'Your free trackers: each habit’s name, its goal and shields, and the days you marked done. Only you see them.',
          'Friends, pledges and gifts: your friend requests and friendships, the pledges and gifts you make, and a record of what you gave to a charity (the amount, the charity and the habit it backed), which stays yours even if the challenger deletes their account.',
          'Your badges: the ones you choose to show on your profile. The badges themselves are worked out from your challenges and pledges, not stored.',
          'Notifications, if you allow them: your phone’s notification address (a push token) and which kinds you turned on. It’s deleted when you sign out or delete your account.',
          'Feedback you send from Settings → About: what it’s about, your message, the app and iOS versions, and a photo if you attach one. Only Kept’s team reads it.',
          'If you join the waitlist on habitkept.com: your email address, and when you joined. Nothing else; the site has no cookies or analytics.',
          'On your phone only: your sign-in (kept in the iPhone’s Keychain), your appearance and greeting settings, whether you’ve seen the tutorial and the privacy note, and the payment methods you add.',
        ],
        'Kept doesn’t collect your location, contacts or advertising ID, doesn’t read Apple Health or other health apps, and has no analytics, ads or session recording.',
      ],
    },
    {
      heading: 'Consumer health data',
      body: [
        'Some habits say something about your health, such as a workout, steps, stretching or yoga, meditation, sleep or what you eat. Some states, including Washington, Nevada and Connecticut, call this consumer health data. For those habits, it means the habit you picked, your check-in photos, screenshots and notes, and whether you did each day.',
        [
          'Kept collects it only from what you add to your challenges and trackers, and uses it only to run them and check your days.',
          'It goes only to the people and services this policy names, for those reasons.',
          'Kept never sells it, uses it for ads, or works out anything about your health beyond whether you did the day.',
          'Kept asks for your consent, separately from these policies, before your first challenge or tracker with a health habit, and you can change your answer in Settings → Privacy & security. You can withdraw it by turning it off, ending the challenge or tracker, or deleting your account.',
          `You can ask what health data Kept holds about you and who received it, or ask us to delete it, at ${email}. We answer within 45 days.`,
        ],
      ],
    },
    {
      heading: 'How it’s used',
      body: [
        [
          'To run your account and your challenges.',
          'To show your challenges to your friends, and to check your days (friends, the AI, and appeals).',
          'To keep Kept safe: the age check, refusing passwords known from data breaches, and enforcing the Community Rules.',
          'To email you about your account, such as sign-in codes, and, if you joined the waitlist, to tell you when Kept launches. Every launch email has a link to leave the list and Kept’s postal address. Kept sends no other marketing email.',
        ],
      ],
    },
    {
      heading: 'Who can see what',
      body: [
        [
          'Anyone on Kept: your username and profile photo.',
          'Your friends: your challenges, check-in photos and completion rate, and the missed days you bought a shield for, with its price.',
          'If you make a challenge public (it’s off unless you turn it on): people who aren’t your friends can find it and see its progress, meaning the habit, the day, shields left, the missed days you bought a shield for and its price, the charity and the pledge total. Never your username, photo, profile or completion rate.',
          'Backers show to everyone else as “Backer A”, “Backer B”, never by name.',
          'No one: your name, email address, date of birth and state are never shown to anyone.',
        ],
      ],
    },
    {
      heading: 'Services that receive your information',
      body: [
        [
          'Supabase runs Kept’s database, sign-in, photo storage and server functions, on servers in the United States.',
          'Google, if you sign in with Google: Google shares your email address and the name and photo on your Google account. Kept uses only the email to sign you in, and doesn’t show your Google name or photo to anyone.',
          'Apple, if you sign in with Apple: Apple shares your email address, or a private relay address if you hide it. Kept keeps a token from Apple only so it can disconnect Kept from your Apple ID when you delete your account.',
          'Anthropic’s AI (Claude) checks a day when no friend has, if you allow it: Kept asks before your first check-in, and nothing goes to Anthropic unless you said yes. Kept sends it the check-in photo, your note, the book and pages, quiz questions and answers, and the line you may write on a language quiz about what you practiced (sent only when it writes new questions, and never saved). They’re used only to check the day, not to train AI models, though Anthropic may keep them for a limited time to look for abuse, under its commercial terms. You can stop it in Settings → Privacy & security.',
          'Have I Been Pwned: when you choose a password, the app sends the first 5 characters of a scrambled version of it, never the password itself, to check it hasn’t appeared in a data breach.',
          'Every.org supplies Kept’s charity search: what you type in the search box goes to Every.org from Kept’s servers, without your name or account.',
          'Resend sends Kept’s email (sign-in and reset codes, launch news to the waitlist, and your feedback to Kept’s team), so it handles your email address and the message.',
          'Cloudflare hosts habitkept.com, so, like any web host, it sees the address of the device visiting the site.',
          'Expo’s push service and Apple deliver Kept’s notifications, so they handle your phone’s notification address and each notification’s text, such as “@ben backed you”.',
          'Apple distributes the app. Apple’s own privacy policy covers what Apple collects, such as crash reports you choose to share.',
        ],
        'When real money arrives, these services join them:',
        [
          'Stripe takes card, Apple Pay and Link payments. It receives your card details, name and email; Kept keeps only Stripe’s customer number and each card’s brand, last 4 digits and expiry.',
          'Stripe Identity checks your ID before your first real stake. It receives a photo of your ID and a selfie and keeps them under its own privacy policy; Kept keeps only whether the check passed.',
          'Every.org: Kept donates failed stakes, pledges given to the charity, and the charity’s half of bought shields through Every.org. Kept is the donor and gives in its own name, in batches, so Every.org receives the amount and the charity, not your name, email or card.',
          'Sentry receives crash and error reports: your device model, iOS and app versions, what the app was doing, and an account number. Never your photos, notes or payment details, and never for tracking.',
          'Solana: if you pay with USDC, your wallet address and every transfer to and from Kept’s treasury wallet are public on the Solana blockchain forever. Kept can’t delete them, even when you delete your account. The Solana network service Kept uses sees your wallet address and your device’s internet address.',
        ],
        'We also share information if the law requires it or to protect someone’s safety, and if another company takes over Kept, your information moves with it under this policy.',
      ],
    },
    {
      heading: 'How long it’s kept',
      body: [
        'Check-in photos are deleted 30 days after their challenge ends, except for a challenge that led to a real charge (a stake sent to the charity, or a bought shield): its check-ins are kept, out of everyone’s sight, until 180 days after the charge, as evidence if the charge is disputed, and then deleted, even if you delete your account first. Records of real charges, donations and ID checks are kept as long as tax and payment laws require. A waitlist email is deleted when you leave the list or ask us to remove it. Feedback is kept to improve Kept, no longer tied to you once your account is deleted, and a photo you attached is deleted with your account. Everything else stays while you have an account. Deleting your account removes your profile, photos, challenges, check-ins, friendships and pledges at once; copies in the database provider’s backups expire on its own schedule.',
      ],
    },
    {
      heading: 'Your choices',
      body: [
        [
          'See and change your information in the app: name, username, state and password in Settings.',
          `Ask us to correct your email or date of birth, or for a copy of your information, at ${email}.`,
          'Delete your account at any time: Settings → Delete account.',
        ],
        'We answer requests within 45 days, wherever you live in the United States, and using these choices never changes how Kept treats you.',
      ],
    },
    {
      heading: 'People under 18',
      body: [
        `Kept is only for adults. The app asks for your date of birth and won’t save a profile for anyone under 18. If we learn that someone under 18 has an account, we delete it. If you think a child is using Kept, email ${email}.`,
      ],
    },
    {
      heading: 'Security',
      body: [
        'Your sign-in stays in the iPhone’s Keychain, connections to Kept are encrypted, and database rules let each person read only what the app says they can. No system is perfect: if a breach affects your information, we’ll tell you as the law requires.',
        `Found a security problem? Email ${email} with what you found, and please don’t use it to reach anyone else’s information.`,
      ],
    },
    {
      heading: 'Changes',
      body: ['We’ll tell you in the app before changes to this policy take effect.'],
    },
  ],
};

const REFUNDS: Policy = {
  title: 'Refunds and Cancellation',
  intro:
    'How money comes back to you, or goes to charity, on Kept.',
  sections: [
    {
      heading: 'Your stake',
      body: [
        [
          'You finish: your stake comes back in full.',
          'You don’t finish (a miss with no shield left, or you quit after Day 1): your stake goes to your charity.',
          'You cancel until the end of Day 1: your stake comes back in full.',
        ],
      ],
    },
    {
      heading: 'Cancelling a challenge',
      body: [
        'You can cancel a challenge until the end of its Day 1, in the challenge’s time zone. Your stake and every pledge are returned; Kept’s service fee isn’t. After Day 1 you can quit instead, which counts as not finishing.',
      ],
    },
    {
      heading: 'The service fee',
      body: [
        'Kept’s service fee is charged on top of your stake or pledge, never taken out of it, and shown to the cent with the total before you sign or pledge: a $10 pledge costs $10 plus the fee. A stake’s fee is non-refundable once you sign, including when you cancel or quit, because it pays for running your challenge. A pledge’s fee is non-refundable once you pledge, including when you withdraw it or it comes back to you; only the pledge itself goes to the charity or back. A fee charged by mistake, such as twice, is refunded.',
      ],
    },
    {
      heading: 'Pledges',
      body: [
        [
          'The challenger finishes: the pledge goes to their charity, which Kept donates through Every.org in its own name. Your Wallet shows it was given for you.',
          'The challenger doesn’t finish: the pledge comes back, unless the pledger chose to donate anyway.',
          'The challenge is cancelled: every pledge comes back.',
          'A pledger can withdraw a pledge until the end of the challenge’s Day 1. After that it can only be raised.',
        ],
      ],
    },
    {
      heading: 'Gifts and donations',
      body: [
        'Extra gifts at the end of a challenge, and pledges that go to a charity, are final once sent. The charity’s own policies apply after that.',
      ],
    },
    {
      heading: 'Missed days and appeals',
      body: [
        'Every challenge has 2 shields: a missed day breaks one and adds a day to the end, and a miss with no shield left ends the challenge. You can appeal a failed day within 7 days, once per check-in. If the appeal succeeds, the day is restored and the shield comes back. A day that fails because of an error on Kept’s side, not yours, counts as done.',
      ],
    },
    {
      heading: 'Bought shields',
      body: [
        'When a miss with no shield left ends your challenge, you can buy a shield until the end of the next day and keep going. A challenge can buy up to 3, at 20%, 40% and then 60% of your stake (whole dollars, at least $5), with no service fee on top. Half of each goes to your charity in your name and half to Kept. The price and the split are shown to the cent before you buy. A bought shield is final once bought: it isn’t refunded, whatever happens next. Friends and backers on the challenge see which missed days you bought a shield for, and its price.',
      ],
    },
    {
      heading: 'Kept credits',
      body: [
        'Kept credits aren’t money. A pledge never earns more credits than the service fee paid on it. They can’t be refunded or exchanged for cash, and they end when your account is deleted.',
      ],
    },
    {
      heading: 'Mistakes',
      body: [
        'If Kept charges, holds or donates money by mistake, such as a stake sent to a charity because of a wrong decision on a day, Kept pays it back in full, even if the charity already has it.',
      ],
    },
    {
      heading: 'If Kept shuts down',
      body: ['Stakes and pledges Kept still holds are returned.'],
    },
    {
      heading: 'How refunds are paid',
      body: [
        'When real money arrives, refunds go back to the way you paid: your card, or the wallet the USDC came from. How long that takes depends on the payment processor, and we’ll say so before you pay. If something looks wrong with a charge, email us first so we can fix it quickly.',
      ],
    },
  ],
};

const COMMUNITY: Policy = {
  title: 'Community Rules',
  intro:
    'Kept is people keeping promises in front of their friends. These rules keep it fair and safe. They cover your username, profile photo, check-in photos, notes, and anything else you add.',
  sections: [
    {
      heading: 'Be real',
      body: [
        [
          'Check in only what you actually did, with a photo you took for it.',
          'No one else’s photos, no old photos, and no photos of a screen showing someone else’s activity.',
          'One account per person. Don’t make accounts to approve your own check-ins.',
          'Approve friends’ days honestly.',
        ],
      ],
    },
    {
      heading: 'Not allowed',
      body: [
        [
          'Nudity or sexual content.',
          'Violence, gore, or content that encourages self-harm.',
          'Hate, harassment, threats or bullying.',
          'Illegal activity, or selling drugs or weapons.',
          'Other people’s private information, such as addresses or ID documents.',
          'Photos of other people who haven’t agreed, and never of children.',
          'Content you don’t have the rights to.',
          'Spam, ads, scams, or pretending to be someone else.',
          'Usernames that break any of these rules.',
        ],
      ],
    },
    {
      heading: 'Reporting',
      body: [
        'Tap Report on someone’s profile, a check-in you’re reviewing, a friend request or a public challenge, and pick a reason. We usually review reports within a day, and the person isn’t told who reported them.',
        `You can also email ${email} with the username and what happened.`,
        'Tap Block to stop someone finding you, sending you requests or backing your challenges, and to stop seeing each other on Kept. They aren’t told. Undo it in Settings → Privacy & security → Blocked accounts.',
        'Usernames and notes with offensive words on Kept’s list are refused when you type them.',
      ],
    },
    {
      heading: 'Intimate images shared without consent',
      body: [
        `If an intimate image of you, or of someone you’re allowed to act for, is on Kept without consent, ask us to remove it: email ${email} with the subject “Remove an intimate image”. Include:`,
        [
          'your physical or electronic signature;',
          'the image, and enough to find it (the username, and which photo);',
          'a short statement that you believe in good faith it was shared without consent, with any details that help;',
          'how to reach you.',
        ],
        'We remove it within 48 hours of a valid request, along with any identical copies we know of, and close the account that shared it.',
      ],
    },
    {
      heading: 'What happens',
      body: [
        'We may remove content, ask for a new check-in photo, warn someone, or suspend or close their account. Content that may be illegal is reported to the authorities, including child sexual abuse material, which we report to the National Center for Missing & Exploited Children as the law requires.',
      ],
    },
    {
      heading: 'Copyright (DMCA)',
      body: [
        `If you believe something on Kept infringes your copyright, send a notice to Kept’s copyright agent: ${name}, ${email} (subject “Copyright notice”). Include:`,
        [
          'your physical or electronic signature;',
          'the copyrighted work you believe is infringed;',
          'the content on Kept you want removed, and where it is (the username, and which photo);',
          'your name, address, phone number and email;',
          'a statement that you believe in good faith the use isn’t authorized by the owner, its agent or the law;',
          'a statement, under penalty of perjury, that your notice is accurate and that you’re the owner or allowed to act for them.',
        ],
        'If your content was removed and you believe that was a mistake, you can send a counter-notice to the same email with: your signature; the content removed and where it was; a statement under penalty of perjury that you believe in good faith it was removed by mistake or misidentification; and your name, address and phone number, with your consent to the federal court for your address (or, outside the US, any court where Kept may be found) and to accept service from the person who sent the notice.',
        'Kept closes the accounts of people who repeatedly infringe copyright.',
      ],
    },
  ],
};

/** Every policy by id, each ending with the same contact section. */
export const POLICIES: Record<PolicyId, Policy> = Object.fromEntries(
  (
    [
      ['terms', TERMS],
      ['privacy', PRIVACY],
      ['refunds', REFUNDS],
      ['community', COMMUNITY],
    ] as const
  ).map(([id, policy]) => [id, { ...policy, sections: [...policy.sections, CONTACT] }]),
) as Record<PolicyId, Policy>;
