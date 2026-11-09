// A user's profile photo in a circle, or their initial when there's no photo (T47). Used on your profile, and
// later in friend lists, search results and public challenges.

import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';

import { initialFor } from '@/lib/avatar';
import { avatarUrl } from '@/lib/avatar-storage';
import { FONTS, PRIMARY_COLOR, WHITE, useStyles, type Colors } from '@/lib/theme';

export function Avatar({ path, username, size = 40 }: { path: string | null | undefined; username: string; size?: number }) {
  const styles = useStyles(makeStyles);
  const circle = { width: size, height: size, borderRadius: size / 2 };
  return path ? (
    <Image
      source={{ uri: avatarUrl(path) }}
      style={[styles.image, circle]}
      contentFit="cover"
      transition={150}
      accessibilityLabel={`${username}'s profile photo`}
    />
  ) : (
    <View style={[styles.placeholder, circle]} accessible accessibilityLabel={`${username}, no profile photo`}>
      <Text style={[styles.initial, { fontSize: size * 0.42 }]}>{initialFor(username)}</Text>
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    image: { backgroundColor: c.card },
    placeholder: { backgroundColor: PRIMARY_COLOR, alignItems: 'center', justifyContent: 'center' },
    initial: { color: WHITE, fontFamily: FONTS.title },
  });
