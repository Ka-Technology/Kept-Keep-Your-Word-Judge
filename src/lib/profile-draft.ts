// Profile details typed on the sign-up form, held in memory until the new account's code is
// entered; complete-profile then saves them. They're matched to the email, so they can only ever
// be saved to the account they were typed for. Nothing is written to the device: if the app
// closes first, complete-profile simply asks for them again.

/** Sign-up profile details, already checked by profileErrors(), with the answer for Kept's AI (decision 96). */
export type ProfileDraft = { firstName: string; lastName: string; username: string; dob: Date; stateCode: string; aiAllowed: boolean };

let draft: { email: string; details: ProfileDraft } | null = null;

const normalize = (email: string) => email.trim().toLowerCase();

/** Remembers the details for `email`, replacing any earlier sign-up's. */
export function saveProfileDraft(email: string, details: ProfileDraft): void {
  draft = { email: normalize(email), details };
}

/** The details if they were typed for `email`, otherwise null. Only reads: React may run a screen's first render twice. */
export function peekProfileDraft(email: string | undefined): ProfileDraft | null {
  return draft && email && normalize(email) === draft.email ? draft.details : null;
}

/** Forgets the details, once they're saved. */
export function clearProfileDraft(): void {
  draft = null;
}
