// The root of the app. Everything renders inside <AuthProvider>, and RootNavigator shows only the
// screens allowed in the user's current auth state (signed out, needs a profile, ready, or resetting a password).
// It also applies the saved Appearance and gives the navigators their light or dark theme, and Stripe its
// key when cards are real (T92).

import { useFonts } from '@expo-google-fonts/bricolage-grotesque';
import { handleURLCallback, StripeProvider } from '@stripe/stripe-react-native';
import * as Linking from 'expo-linking';
import { Stack, ThemeProvider, type ErrorBoundaryProps } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { AccessibilityInfo, ActivityIndicator, AppState, StyleSheet, Text, useColorScheme, View } from 'react-native';

import { Button } from '@/components/button';
import { ThemeFade } from '@/components/theme-fade';
import { applyAppearance, loadAppearance } from '@/lib/appearance';
import { AuthProvider, useAuth } from '@/lib/auth';
import { demoClockEnabled } from '@/lib/challenges';
import { registerPushToken, rescheduleShieldWarnings, useNotificationTaps } from '@/lib/notifications';
import { tabsTitle } from '@/lib/tab-swipe';
import { FONT_FILES, navigationTheme, SPACE, TEXT, useColors, useStyles, type Colors } from '@/lib/theme';

// Keep the splash screen up until we know which screen to show (see RootNavigator).
SplashScreen.preventAutoHideAsync();

/** Expo Router's root layout: provides auth and the light or dark theme to the whole app. */
export default function RootLayout() {
  const dark = useColorScheme() === 'dark';
  // The display font; the splash screen stays up until it's loaded (or failed, then the system font shows).
  const [fontsLoaded, fontError] = useFonts(FONT_FILES);

  // ponytail: applied after the first frame; the splash screen (up while the session loads) hides the switch.
  useEffect(() => {
    loadAppearance().then(applyAppearance);
  }, []);

  if (!fontsLoaded && !fontError) return null;

  const app = (
    <ThemeProvider value={navigationTheme(dark)}>
      <AuthProvider>
        <RootNavigator />
      </AuthProvider>
      {/* Last, so the still it fades out lies over every screen. */}
      <ThemeFade />
    </ThemeProvider>
  );
  // Real cards (T92) only in builds with Stripe's publishable key; the scheme brings a bank's check back to Kept.
  return STRIPE_KEY ? (
    <StripeProvider publishableKey={STRIPE_KEY} urlScheme="kept">
      {app}
      <StripeRedirects />
    </StripeProvider>
  ) : (
    app
  );
}

const STRIPE_KEY = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY;

/** Hands Stripe its return link (kept://stripe-redirect), which closes the bank's check in its web view. */
function StripeRedirects() {
  useEffect(() => {
    const subscription = Linking.addEventListener('url', ({ url }) => handleURLCallback(url));
    return () => subscription.remove();
  }, []);
  return null;
}

/**
 * Picks which screens exist right now from useAuth().state. Each `Stack.Protected` block lists
 * the screens for one state. When the state changes (e.g. after sign-in), Expo Router moves the
 * user to the first allowed screen, so screens never navigate after sign-in or sign-out themselves.
 *
 * Every new screen must be listed inside one of these blocks: Expo Router lets any screen that
 * isn't listed be reached in every state, signed out included.
 */
function RootNavigator() {
  const styles = useStyles(makeStyles);
  const colors = useColors();
  const { state, refreshProfile, signOut } = useAuth();

  useEffect(() => {
    if (state !== 'loading') SplashScreen.hideAsync();
  }, [state]);

  if (state === 'loading') {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" accessibilityLabel="Loading" />
      </View>
    );
  }

  if (state === 'error') return <LoadError onRetry={refreshProfile} onSignOut={signOut} />;

  // Changing a guard redirects automatically to the first screen that is still allowed.
  // Pushed screens show only a back chevron in ink (A3, T101), with no title once a screen puts its
  // own big title in the page; headers sit on the screen's own paper, without a shadow line under them.
  return (
    <>
      {/* No back-button menu: a long or hard press on Back listed earlier screens and jumped to them (owner, 2026-10-26). */}
      {/* SDK 58 makes headers transparent on iOS 26 by default; Kept's sit on the screen's own paper, as before. */}
      <Stack
        screenOptions={{
          headerShown: false,
          headerTransparent: false,
          headerShadowVisible: false,
          headerBackButtonDisplayMode: 'minimal',
          headerBackButtonMenuEnabled: false,
          headerTintColor: colors.text,
        }}
      >
        <Stack.Protected guard={state === 'signed-out'}>
          <Stack.Screen name="(auth)/sign-in" />
          {/* A back-only header, as in the mockups (T115–T117). */}
          <Stack.Screen name="(auth)/sign-up" options={{ headerShown: true, title: '' }} />
          <Stack.Screen name="(auth)/verify" options={{ headerShown: true, title: '' }} />
          <Stack.Screen name="(auth)/forgot-password" options={{ headerShown: true, title: '' }} />
        </Stack.Protected>
        <Stack.Protected guard={state === 'recovering'}>
          <Stack.Screen name="reset-password" />
        </Stack.Protected>
        <Stack.Protected guard={state === 'two-step'}>
          <Stack.Screen name="two-step" />
        </Stack.Protected>
        <Stack.Protected guard={state === 'needs-profile'}>
          <Stack.Screen name="complete-profile" />
        </Stack.Protected>
        <Stack.Protected guard={state === 'ready'}>
          {/* Never shown (no header), but it's what the back button's history list calls this screen. */}
          <Stack.Screen name="(tabs)" options={({ route }) => ({ title: tabsTitle(route) })} />
          <Stack.Screen name="profile" options={{ headerShown: true, title: '' }} />
          <Stack.Screen name="settings" options={{ headerShown: true, title: '' }} />
          {/* Settings' category pages (T48). */}
          <Stack.Screen name="settings/personal" options={{ headerShown: true, title: '' }} />
          <Stack.Screen name="settings/payments" options={{ headerShown: true, title: '' }} />
          <Stack.Screen name="settings/privacy" options={{ headerShown: true, title: '' }} />
          <Stack.Screen name="settings/notifications" options={{ headerShown: true, title: '' }} />
          <Stack.Screen name="settings/app" options={{ headerShown: true, title: '' }} />
          <Stack.Screen name="settings/about" options={{ headerShown: true, title: '' }} />
          <Stack.Screen name="settings/licenses" options={{ headerShown: true, title: '' }} />
          <Stack.Screen name="settings/two-step" options={{ headerShown: true, title: '' }} />
          <Stack.Screen name="settings/blocked" options={{ headerShown: true, title: '' }} />
          <Stack.Screen name="add/[username]" options={{ headerShown: true, title: '' }} />
          <Stack.Screen name="badges" options={{ headerShown: true, title: '' }} />
          <Stack.Screen name="friend/[id]" options={{ headerShown: true, title: '' }} />
          <Stack.Screen name="edit-username" options={{ headerShown: true, title: '' }} />
          <Stack.Screen name="edit-name" options={{ headerShown: true, title: '' }} />
          <Stack.Screen name="change-password" options={{ headerShown: true, title: '' }} />
          <Stack.Screen name="change-email" options={{ headerShown: true, title: '' }} />
          <Stack.Screen name="rules" options={{ headerShown: true, title: '' }} />
          {/* Start a challenge: money or not first, then five steps, each pushed on the last (SPEC-challenges.md), or a free tracker. */}
          <Stack.Screen name="challenge/new/index" options={{ headerShown: true, title: '' }} />
          <Stack.Screen name="challenge/new/habit" options={{ headerShown: true, title: '' }} />
          <Stack.Screen name="challenge/new/length" options={{ headerShown: true, title: '' }} />
          <Stack.Screen name="challenge/new/stake" options={{ headerShown: true, title: '' }} />
          <Stack.Screen name="challenge/new/charity" options={{ headerShown: true, title: '' }} />
          <Stack.Screen name="challenge/new/sign" options={{ headerShown: true, title: '' }} />
          {/* A screen with its own big title leaves the header's empty, so it isn't said twice (T94). */}
          <Stack.Screen name="challenge/[id]" options={{ headerShown: true, title: '' }} />
          <Stack.Screen name="check-in/[challengeId]" options={{ headerShown: true, title: '' }} />
          <Stack.Screen name="review/[checkInId]" options={{ headerShown: true, title: '' }} />
          <Stack.Screen name="pledge/[challengeId]" options={{ headerShown: true, title: '' }} />
          <Stack.Screen name="past-challenges" options={{ headerShown: true, title: '' }} />
          <Stack.Screen name="tracker/new" options={{ headerShown: true, title: '' }} />
          <Stack.Screen name="tracker/[id]" options={{ headerShown: true, title: '' }} />
          <Stack.Screen name="challenge/[id]/results" options={{ headerShown: true, title: '', presentation: 'modal' }} />
          <Stack.Screen name="challenge/[id]/pay" options={{ headerShown: true, title: '', presentation: 'modal' }} />
          <Stack.Screen name="challenge/[id]/promise" options={{ headerShown: true, title: '', presentation: 'modal' }} />
          <Stack.Screen name="report" options={{ headerShown: true, title: '', presentation: 'modal' }} />
          <Stack.Screen name="feedback" options={{ headerShown: true, title: '', presentation: 'modal' }} />
          {/* Not a modal: Home opens this as it first appears, and a modal presented during the guards' own transition
              can come up empty, a black screen on every new account (2026-11-06). It looks the same, sliding up. */}
          <Stack.Screen name="tutorial" options={{ animation: 'slide_from_bottom', gestureEnabled: false }} />
        </Stack.Protected>
        {/* The policies open from sign-up too, so they're allowed in every state. */}
        <Stack.Screen name="policy/[doc]" options={{ headerShown: true, title: '' }} />
      </Stack>
      {/* After the navigator, so a tap that launched Kept has somewhere to go. */}
      <NotificationSetup />
    </>
  );
}

/**
 * This phone's push token for whoever signs in (again at every launch, since a token can change), the
 * shield warnings scheduled again at launch and whenever Kept comes to the front (T35), and a tapped
 * notification opening its screen (SPEC-notifications.md, T34).
 */
function NotificationSetup() {
  const userId = useAuth().session?.user.id;
  useEffect(() => {
    if (!userId) return;
    registerPushToken().catch(() => {});
    rescheduleShieldWarnings();
    const subscription = AppState.addEventListener('change', (state) => state === 'active' && rescheduleShieldWarnings());
    return () => subscription.remove();
  }, [userId]);
  useNotificationTaps();
  return null;
}

/**
 * Any screen that throws while drawing lands here. Without this, React empties the app and iOS shows only the
 * status bar on black, with nothing to tap and nothing to report. The test build names the error, so a tester can.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.center}>
      <Text style={styles.message} accessibilityRole="alert">
        Something went wrong on this screen.
      </Text>
      {demoClockEnabled() && <Text style={styles.message}>{error.message}</Text>}
      <Button title="Try again" onPress={retry} />
    </View>
  );
}

const LOAD_ERROR_MESSAGE = "Couldn't load your account. Check your connection and try again.";

/** Shown when the account can't be loaded (usually offline). Offers a retry, and sign-out as a way out. */
function LoadError({ onRetry, onSignOut }: { onRetry: () => void; onSignOut: () => void }) {
  const styles = useStyles(makeStyles);
  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(LOAD_ERROR_MESSAGE);
  }, []);

  return (
    <View style={styles.center}>
      <Text style={styles.message} accessibilityRole="alert">
        {LOAD_ERROR_MESSAGE}
      </Text>
      <Button title="Try again" onPress={onRetry} />
      <Button title="Sign out" onPress={onSignOut} variant="destructiveLink" />
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    // Drawn outside the navigator, so it sets the screen background itself.
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: SPACE.md, padding: SPACE.xxl, backgroundColor: c.background },
    message: { ...TEXT.body, textAlign: 'center', color: c.text },
  });
