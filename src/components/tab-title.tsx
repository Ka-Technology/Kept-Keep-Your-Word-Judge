// A tab's title row, with your photo at the top right: tapping it opens your profile (T88, plan.md
// decision 87; like the App Store). Challenges, Check in, Wallet and Friends use TabTitle; Home puts
// ProfileButton beside its own greeting. A pushed screen's title sits in the page instead of the
// header, which shows only the back chevron (A3, T101): PageTitle.

import { router } from 'expo-router';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { useAuth } from '@/lib/auth';
import { ICON, SPACE, TEXT, TYPE, useColors, useStyles, type Colors } from '@/lib/theme';

/** Your profile photo (or initial), which opens your profile. */
export function ProfileButton() {
  const { profile } = useAuth();
  return (
    <Pressable
      onPress={() => router.push('/profile')}
      accessibilityRole="button"
      accessibilityLabel="Your profile"
      hitSlop={SPACE.sm}
      style={({ pressed }) => pressed && { opacity: 0.7 }}
    >
      <Avatar path={profile?.avatar_path} username={profile?.username ?? ''} size={44} />
    </Pressable>
  );
}

/** The tab's big title on the left (with an optional icon above it and a line under it), your photo on the right. */
export function TabTitle({ title, subtitle, icon }: { title: string; subtitle?: string; icon?: SymbolViewProps['name'] }) {
  const styles = useStyles(makeStyles);
  const colors = useColors();
  return (
    <View style={styles.row}>
      <View style={styles.titleText}>
        {icon && <SymbolView name={icon} size={ICON.hero} tintColor={colors.text} />}
        <Text style={styles.title} accessibilityRole="header">
          {title}
        </Text>
        {!!subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
      </View>
      <ProfileButton />
    </View>
  );
}

/** A pushed screen's big title, with an optional line under it and an optional icon on its left. */
export function PageTitle({ title, subtitle, icon }: { title: string; subtitle?: string; icon?: ReactNode }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.page}>
      {icon}
      <View style={styles.pageText}>
        <Text style={styles.title} accessibilityRole="header">
          {title}
        </Text>
        {!!subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
      </View>
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: SPACE.md, marginTop: SPACE.sm, marginHorizontal: SPACE.xs },
    titleText: { flex: 1, gap: SPACE.xxs },
    title: { ...TYPE.display, color: c.text },
    page: { flexDirection: 'row', alignItems: 'center', gap: SPACE.lg, marginHorizontal: SPACE.xs },
    pageText: { flex: 1, gap: SPACE.xxs },
    subtitle: { ...TEXT.row, color: c.secondaryText },
  });
