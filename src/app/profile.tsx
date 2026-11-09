// Your profile (T48; bento, 2026-10-02), opened from your photo at the top right of every tab (T88,
// plan.md decision 87; it was the Me tab). Your profile photo (tap to see it large, with buttons to
// choose, take or remove one, T47; owner, 2026-10-03) and username, three key stats from your
// challenges as tiles (the completion rate as a ring), badges (the three chosen to lead, or the
// rarest until then, with an invitation to choose; plan.md decisions 27 and 79), and a gear in the
// header for Settings. Friends is its own tab now. A new photo goes through a crop step first: drag
// and zoom it in the circle, then Save (owner, 2026-10-18, T153). As in the A3 mockup since T120
// (full-set/ui-push-1-profile.jpg): the photo beside your name, large, and @username (the name is
// yours to see only, decision 100; without one the username leads), the stats in one card, and
// "Earned badges".

import { router, Stack } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { BadgeTile } from '@/components/badge';
import { Button } from '@/components/button';
import { PhotoCropper } from '@/components/photo-cropper';
import { PhotoViewer } from '@/components/photo-viewer';
import { ProgressRing } from '@/components/progress-ring';
import { StatTile, Tile } from '@/components/tile';
import { useAuth } from '@/lib/auth';
import { cropRect, type CropView } from '@/lib/avatar';
import { cropPhoto, pickPhoto, removeAvatarFile, uploadAvatar, type ChosenPhoto } from '@/lib/avatar-storage';
import { badgesFor, canChooseMore, rarityOf, showcaseFirst } from '@/lib/badges';
import { meStats, money } from '@/lib/challenges';
import { showMenu } from '@/lib/menu';
import { useBadgeExtras, useBadgeShares } from '@/lib/use-badge-extras';
import { HERO_MAX_SCALE, ICON, SCREEN, SPACE, TEXT, TYPE, useColors, useStyles, type Colors } from '@/lib/theme';
import { useMyChallenges } from '@/lib/use-my-challenges';
import { useMyDonations } from '@/lib/use-my-donations';

const SAVE_FAILED = ['Couldn’t save your photo', 'Check your connection and try again.'] as const;

export default function Profile() {
  const styles = useStyles(makeStyles);
  const colors = useColors();
  const { profile, session, updateProfile } = useAuth();
  const { challenges } = useMyChallenges();
  const stats = meStats(challenges ?? []);
  // Everything given in your name, the same total as Home and Wallet (T208).
  const { totalCents: givenCents } = useMyDonations();
  const extras = useBadgeExtras(session?.user.id);
  const shares = useBadgeShares();
  const earned = badgesFor(challenges ?? [], extras);
  const showcase = profile?.showcase_badges ?? [];
  const [saving, setSaving] = useState(false);
  const [viewing, setViewing] = useState(false);
  // A photo just chosen or taken, waiting in the crop step (T153).
  const [chosen, setChosen] = useState<ChosenPhoto | null>(null);
  const hasPhoto = !!profile?.avatar_path;
  const fullName = profile?.first_name && profile.last_name ? `${profile.first_name} ${profile.last_name}` : null;

  /** Picks or takes a photo, then opens the crop step (T153). */
  async function changePhoto(source: 'library' | 'camera') {
    const picked = await pickPhoto(source);
    if (picked === 'no-permission') {
      return Alert.alert('Camera access is off', 'To take a photo, allow Kept to use the camera in your phone’s Settings.', [
        { text: 'Not now', style: 'cancel' },
        { text: 'Open Settings', onPress: () => Linking.openSettings() },
      ]);
    }
    if (!picked) return;
    // The picker's sheet can still be closing, and the crop step presents from the same screen.
    // ponytail: a fixed wait, since the picker gives no completion; shorten it if it feels slow.
    setTimeout(() => setChosen(picked), 400);
  }

  /** Crops the photo where it was placed, uploads it, points the profile at it, then deletes the old file. */
  async function savePhoto(view: CropView, side: number) {
    if (!chosen || !session) return;
    setSaving(true);
    const oldPath = profile?.avatar_path;
    try {
      const cropped = await cropPhoto(chosen, cropRect(chosen, side, view));
      if (!cropped) throw new Error('crop failed');
      const path = await uploadAvatar(session.user.id, cropped);
      if ((await updateProfile({ avatar_path: path })) !== 'saved') {
        await removeAvatarFile(path);
        throw new Error('profile not updated');
      }
      await removeAvatarFile(oldPath);
      setChosen(null);
    } catch {
      Alert.alert(...SAVE_FAILED);
    } finally {
      setSaving(false);
    }
  }

  // The crop step, over the photo viewer when that's open (a Modal presents from what holds it).
  const cropper = chosen && <PhotoCropper key={chosen.uri} photo={chosen} saving={saving} onCancel={() => setChosen(null)} onSave={savePhoto} />;

  /** Goes back to the initial, then deletes the old file. */
  async function removePhoto() {
    const oldPath = profile?.avatar_path;
    setSaving(true);
    const result = await updateProfile({ avatar_path: null });
    setSaving(false);
    if (result === 'saved') {
      setViewing(false);
      await removeAvatarFile(oldPath);
    } else Alert.alert(...SAVE_FAILED);
  }

  /** A photo opens large (its buttons change it there); without one, straight to library or camera. */
  function openPhoto() {
    if (hasPhoto) return setViewing(true);
    showMenu(undefined, [
      { label: 'Choose from library', run: () => changePhoto('library') },
      { label: 'Take photo', run: () => changePhoto('camera') },
    ]);
  }

  return (
    <ScrollView style={styles.safe} contentContainerStyle={styles.container} contentInsetAdjustmentBehavior="automatic">
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable
              style={({ pressed }) => [styles.gear, pressed && styles.pressed]}
              onPress={() => router.push('/settings')}
              accessibilityRole="button"
              accessibilityLabel="Settings"
              hitSlop={SPACE.sm}
            >
              <SymbolView name={{ ios: 'gearshape', android: 'settings' }} size={ICON.row} tintColor={colors.link} />
            </Pressable>
          ),
        }}
      />
      <View style={styles.header}>
        <View style={styles.photo}>
          {/* The words under the photo are part of the button: testers tapped them first (T211). */}
          <Pressable
            onPress={openPhoto}
            disabled={saving}
            accessibilityRole="button"
            accessibilityLabel={hasPhoto ? 'Your profile photo. Opens it large, to see or change it' : 'Add a profile photo'}
            style={({ pressed }) => [styles.photo, pressed && styles.pressed]}
          >
            <Avatar path={profile?.avatar_path} username={profile?.username ?? ''} size={112} />
            <Text style={styles.photoHint}>{saving ? 'Saving photo…' : hasPhoto ? 'Tap to view' : 'Add a photo'}</Text>
          </Pressable>
        </View>
        <View style={styles.names}>
          <Text style={styles.name} accessibilityRole="header" adjustsFontSizeToFit numberOfLines={2} maxFontSizeMultiplier={HERO_MAX_SCALE}>
            {fullName ?? profile?.username}
          </Text>
          {fullName && <Text style={styles.username}>@{profile?.username}</Text>}
        </View>
      </View>
      {profile?.avatar_path && (
        <PhotoViewer path={profile.avatar_path} username={profile.username} visible={viewing} onClose={() => setViewing(false)}>
          {/* The pickers open over the photo, which then shows the new one. */}
          <Button title={saving ? 'Saving photo…' : 'Choose from library'} onPress={() => changePhoto('library')} disabled={saving} variant="secondary" />
          <Button title="Take photo" onPress={() => changePhoto('camera')} disabled={saving} variant="secondary" />
          <Button title="Remove photo" onPress={removePhoto} disabled={saving} variant="destructive" />
          {viewing && cropper}
        </PhotoViewer>
      )}
      {!viewing && cropper}
      <Tile style={styles.bento}>
        <View style={styles.rateTile}>
          <ProgressRing
            value={stats.ended ? stats.percent / 100 : 0}
            size={96}
            stroke={10}
            color={colors.stamp}
            trackColor={colors.selected}
            accessibilityLabel={stats.ended ? `${stats.percent}% completion rate` : 'No completion rate yet'}
          >
            <Text style={styles.rate} maxFontSizeMultiplier={HERO_MAX_SCALE}>
              {stats.ended ? `${stats.percent}%` : '–'}
            </Text>
          </ProgressRing>
          <Text style={styles.caption}>Completion rate</Text>
        </View>
        <StatTile style={styles.inner} value={String(stats.finished)} label="Challenges finished" />
        <StatTile style={styles.inner} value={money(givenCents)} label="Given to charity" />
      </Tile>
      <BadgeTile earned={showcaseFirst(earned, showcase, rarityOf(shares))} limit={3} seeAll invite={!!shares && canChooseMore(earned, showcase)} />
    </ScrollView>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.groupedBackground },
    container: { ...SCREEN, gap: SPACE.xxl },
    header: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xl },
    photo: { alignItems: 'center', gap: SPACE.xs },
    names: { flex: 1, gap: SPACE.xs },
    pressed: { opacity: 0.7 },
    photoHint: { ...TEXT.caption, color: c.link, fontWeight: '600' },
    name: { ...TYPE.display, color: c.text },
    username: { ...TEXT.body, color: c.secondaryText },
    gear: { padding: SPACE.xs },
    // Room between the ring and the tiles beside it (owner, 2026-10-18, T148).
    bento: { flexDirection: 'row', alignItems: 'stretch', gap: SPACE.md, padding: SPACE.lg },
    rateTile: { flex: 1.15, alignItems: 'center', justifyContent: 'center', gap: SPACE.sm, paddingRight: SPACE.sm },
    inner: { flex: 1, boxShadow: undefined, borderWidth: 1, borderColor: c.separator },
    rate: { ...TYPE.stat, color: c.text },
    caption: { ...TEXT.note, color: c.secondaryText },
  });
