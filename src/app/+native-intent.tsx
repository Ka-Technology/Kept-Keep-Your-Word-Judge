// Links from outside the app, before Expo Router reads them. Stripe's return link (kept://stripe-redirect,
// after a bank's check in a web view while a card is saved, T92) is Stripe's to handle (StripeRedirects in
// _layout.tsx), not a screen, so the app stays where it is instead of showing "This page isn't here". Google's
// return link (com.googleusercontent.apps.…:/oauth2redirect) is its sign-in library's in the same way.

export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  return path.includes('stripe-redirect') || path.includes('com.googleusercontent.apps') ? null : path;
}
