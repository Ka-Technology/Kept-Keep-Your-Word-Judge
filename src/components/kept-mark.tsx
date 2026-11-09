// Kept's mark, as the app icon shows it (T51; the day box since decision 93): the K stamp in green on ink, drawn
// from the same picture as the icon (docs/brand/build-icons.cjs), with an app icon's rounded
// corners. Used where the app introduces itself: sign-in, the tutorial's welcome and Settings →
// About. Decorative: the name beside it says "Kept".

import { Image } from 'expo-image';
import { View } from 'react-native';

import { useColors } from '@/lib/theme';

const ICON = require('@/assets/images/icon.png');

export function KeptMark({ size = 88 }: { size?: number }) {
  const c = useColors();
  return (
    <View
      style={{ width: size, height: size, borderRadius: size * 0.225, borderCurve: 'continuous', overflow: 'hidden', boxShadow: c.tileShadow || undefined }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Image source={ICON} style={{ width: size, height: size }} contentFit="cover" />
    </View>
  );
}
