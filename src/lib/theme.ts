// Kept's look (owner, 2026-10-02; A3 "stamp hero", decision 95): bento in ledger green. Warm paper and
// blue-black ink by day, a near-black "premium night" in dark mode; one green accent for kept days,
// links and success, and a seal red for misses, due check-ins and errors. Screens are built from
// white tiles (components/tile.tsx) in mixed sizes, never solid colored ones: the color comes from
// the K and X stamps, the rings and one green button per screen. Titles and big numbers are set in
// Bricolage Grotesque; body text stays the system font, so it follows the phone's text size and
// reads natively; signatures use Snell Roundhand (iOS). Screens build their styles with
// useStyles(makeStyles), so each style can use the current colors and switches when the phone (or
// Settings → Appearance) changes between light and dark. theme.test.ts checks the contrast of every
// text color in both modes.

import {
  BricolageGrotesque_600SemiBold,
  BricolageGrotesque_700Bold,
  BricolageGrotesque_800ExtraBold,
} from '@expo-google-fonts/bricolage-grotesque';
import { DarkTheme, DefaultTheme } from 'expo-router';
import { useMemo } from 'react';
import { DynamicColorIOS, Platform, useColorScheme, type TextStyle, type ViewStyle } from 'react-native';

/** The ledger green, for things that look the same in both modes (a profile initial's circle). */
export const PRIMARY_COLOR = '#1D6B4C';

/** Seal red for destructive buttons, under white text in both modes. */
export const DANGER_COLOR = '#C0392B';

/** White, for text on the fixed colors above and on the seal-red badge. */
export const WHITE = '#FFFFFF';

/** Behind a profile photo opened large, in both modes: darker than a sheet's scrim, so only the photo stands out. */
export const PHOTO_BACKDROP = 'rgba(0,0,0,0.85)';

/** The dark band Kept's stamp sits on over a check-in photo, readable on any photo in either mode. */
export const PHOTO_BAND = 'rgba(0,0,0,0.55)';

/**
 * Placeholder (hint) text: a pencil gray. Most fields have no other label, so it keeps 4.5:1
 * contrast (WCAG AA) on a tile in both modes. iOS switches it with the mode, including
 * Settings → Appearance's override.
 */
// ponytail: Android gets the dark-mode gray (2.9:1 on white); theme it per mode when Android lands (T13).
export const PLACEHOLDER_COLOR = Platform.OS === 'ios' ? DynamicColorIOS({ light: '#5F5E66', dark: '#9E9C94' }) : '#9E9C94';

/** The display font's files, loaded once by the root layout before the splash screen goes. */
export const FONT_FILES = { BricolageGrotesque_600SemiBold, BricolageGrotesque_700Bold, BricolageGrotesque_800ExtraBold };

/** The display font's weights, by role. Set these instead of fontWeight. */
export const FONTS = {
  heading: 'BricolageGrotesque_600SemiBold',
  title: 'BricolageGrotesque_700Bold',
  heavy: 'BricolageGrotesque_800ExtraBold',
};

/**
 * The display type scale; each screen adds its color. Body text keeps the system font. Numbers use
 * tabular figures, so a ticking countdown or a changing amount doesn't shift sideways.
 */
export const TYPE = {
  /** The one big number a tile is about: "Day 12", "$85", "3h 12m". Cap its growth with HERO_MAX_SCALE. */
  hero: { fontFamily: FONTS.heavy, fontSize: 56, lineHeight: 60, letterSpacing: -1.5, fontVariant: ['tabular-nums'] },
  /** A tab's own title: Home's greeting, Challenges, Check in. ExtraBold, as in the A3 mockups (T100). */
  display: { fontFamily: FONTS.heavy, fontSize: 34, lineHeight: 40, letterSpacing: -0.6 },
  /** A pushed screen's title (a challenge, a check-in, a person), each step's question, a tile's title. */
  title: { fontFamily: FONTS.heavy, fontSize: 28, lineHeight: 34, letterSpacing: -0.4 },
  /** Headings inside a page (a document's sections), and a card's title. */
  heading: { fontFamily: FONTS.heading, fontSize: 20, lineHeight: 26, letterSpacing: -0.2 },
  /** A group's title above its rows: list sections, Home's sections, "Your days". */
  section: { fontFamily: FONTS.title, fontSize: 17, lineHeight: 22 },
  /** A tile's number beside the hero: days kept, dollars backing you, your profile's stats. */
  stat: { fontFamily: FONTS.heavy, fontSize: 32, lineHeight: 36, letterSpacing: -0.6, fontVariant: ['tabular-nums'] },
  /** Numbers inside inputs: amounts, code digits. */
  number: { fontFamily: FONTS.heavy, fontSize: 24, letterSpacing: -0.3, fontVariant: ['tabular-nums'] },
} satisfies Record<string, TextStyle>;

/**
 * The text scale for everything that isn't a title, in the system font so it follows the phone's
 * text size. Sizes are iOS's own text styles. Emphasis is always fontWeight '600'.
 */
export const TEXT = {
  /** List rows, buttons and prompts: iOS's body size. */
  row: { fontSize: 17, lineHeight: 22 },
  /** Paragraphs: promises, rules, policies, empty states. */
  body: { fontSize: 16, lineHeight: 22 },
  /** A sentence under a control or row: explanations, notes, hints, errors. */
  note: { fontSize: 15, lineHeight: 21 },
  /** Field labels, list footers, captions, step counters. */
  caption: { fontSize: 13, lineHeight: 18 },
} satisfies Record<string, TextStyle>;

/** The spacing scale, in points. Layouts use these steps rather than one-off numbers. */
export const SPACE = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 };

/** Corner radii: form fields, list groups and cards, bento tiles, small marks (stamp cells), and pills. */
export const RADIUS = { field: 12, card: 16, tile: 24, small: 8, pill: 999 };

/** Icon sizes: beside a line of text, at the start of a row, and a tile's or screen's main icon. */
export const ICON = { inline: 17, row: 22, hero: 30 };

/**
 * The most a hero or stat number grows with the phone's Text Size. Labels grow fully; the big
 * numbers are already large, and this keeps them inside their tiles at the largest sizes.
 */
export const HERO_MAX_SCALE = 1.3;

/**
 * A screen's content column. On a phone it's the full width; on wider windows (an iPad, an
 * unfolded phone, a Split View pane) it stops at iOS's readable width (672) and sits centered,
 * so rows, buttons and photos don't stretch edge to edge.
 */
export const COLUMN = { width: '100%', maxWidth: 672, alignSelf: 'center' } satisfies ViewStyle;

/** A scrolling screen's content: the column, the standard margin and the gap between its blocks. */
export const SCREEN = { ...COLUMN, padding: SPACE.lg, gap: SPACE.xl } satisfies ViewStyle;

const LIGHT = {
  /** Behind every screen: warm paper. */
  background: '#F6F4EF',
  /** Behind grouped lists (Settings, Friends, your profile); the same paper. */
  groupedBackground: '#F6F4EF',
  /** Tiles, list groups, cards. */
  card: '#FFFFFF',
  /** A sheet, or a surface on a tile. */
  elevated: '#FFFFFF',
  /** Blue-black ink. */
  text: '#1C2143',
  /** Pencil: list headings' notes, details. */
  secondaryText: '#5F5E66',
  /** Values on the right of list rows. */
  valueText: '#5F5E66',
  /** Form field outlines: 3:1 against a tile, so a field can be found. */
  border: '#8E8A80',
  /** Lines between list rows. */
  separator: '#E7E3DA',
  /** A row or tile while it's pressed. */
  pressed: '#EDEAE2',
  chevron: '#A29E94',
  /** Links, secondary buttons, highlights: the ledger green. */
  link: '#1D6B4C',
  /** Primary buttons, one per screen: the green fill (decision 95), and the text on it. */
  primary: '#1D6B4C',
  onPrimary: '#FFFFFF',
  /** A kept day's stamp. */
  stamp: '#1D6B4C',
  /** Misses, due check-ins and errors: the seal. */
  error: '#C0392B',
  success: '#1D6B4C',
  /** A wash of the green: the picked row in a list, a ring's track, "your turn" tiles. */
  selected: '#E3EFE8',
  /** Tutorial progress dots that aren't the current card. */
  dot: '#D9D5CB',
  /** A red wash for what didn't pass and needs doing again: a check-in to redo or appeal. */
  alertWash: '#FCEDEA',
  /** A segmented control's track, and the raised thumb on the chosen option. */
  track: '#EBE8E0',
  thumb: '#FFFFFF',
  /** Behind a sheet. */
  scrim: 'rgba(0,0,0,0.4)',
  /** A tile's soft layered shadow (none at night). */
  tileShadow: '0 1px 2px rgba(28,33,67,0.06), 0 8px 24px rgba(28,33,67,0.06)',
};

export type Colors = typeof LIGHT;

/** Premium night: near-black paper, raised tiles, pale ink, and a bright green for the stamps, rings and button. */
const DARK: Colors = {
  background: '#0B0C0B',
  groupedBackground: '#0B0C0B',
  card: '#171917',
  elevated: '#202320',
  text: '#EDEBE6',
  secondaryText: '#9E9C94',
  valueText: '#9E9C94',
  border: '#75726A',
  separator: '#262826',
  pressed: '#202320',
  chevron: '#6B6962',
  link: '#5CC995',
  primary: '#5CC995',
  onPrimary: '#0B0C0B',
  stamp: '#5CC995',
  error: '#FF7B6E',
  success: '#5CC995',
  selected: '#1B3326',
  dot: '#34372F',
  alertWash: '#331A18',
  track: '#1C1E1C',
  thumb: '#343833',
  scrim: 'rgba(0,0,0,0.6)',
  tileShadow: '',
};

/** Both palettes, for the contrast test. */
export const PALETTES = { light: LIGHT, dark: DARK };

/** The colors for the current light or dark mode. */
export function useColors(): Colors {
  return useColorScheme() === 'dark' ? DARK : LIGHT;
}

/** Builds a component's styles from the current colors; rebuilt only when the mode changes. */
export function useStyles<T>(make: (colors: Colors) => T): T {
  const colors = useColors();
  return useMemo(() => make(colors), [make, colors]);
}

/** The navigators' theme: headers on the same paper as the screen, green back buttons, titles in the display font. */
export function navigationTheme(dark: boolean): typeof DefaultTheme {
  const base = dark ? DarkTheme : DefaultTheme;
  const c = dark ? DARK : LIGHT;
  return {
    ...base,
    colors: { ...base.colors, primary: c.link, background: c.background, card: c.background, text: c.text, border: c.separator, notification: c.error },
    fonts: { ...base.fonts, bold: { fontFamily: FONTS.heading, fontWeight: 'normal' } },
  };
}

/** The outlined white box every form field sits in, including tap-to-choose fields like date of birth. */
export function fieldBox(colors: Colors) {
  return { borderWidth: 1, borderColor: colors.border, borderRadius: RADIUS.field, padding: SPACE.md, backgroundColor: colors.card } satisfies ViewStyle;
}

/**
 * The text box used on every form. Text color and letter spacing are set explicitly because iOS
 * reuses native text boxes between screens, and a setting left unset can carry over from the
 * previous one (e.g. a spaced-out code box spacing out the next screen's email box).
 */
export function inputStyle(colors: Colors): TextStyle {
  return { ...fieldBox(colors), fontSize: 16, color: colors.text, letterSpacing: 0 };
}

/**
 * A text box inside a `Field` card (A3, T107): the card is the box, so this one has none, and no
 * lineHeight for the same reason as inputStyle().
 */
export function bareInputStyle(colors: Colors): TextStyle {
  return { flex: 1, fontSize: 16, color: colors.text, letterSpacing: 0, padding: 0, minHeight: 24 };
}

/**
 * The one big amount typed on a screen (a stake, a pledge): the hero size, without a box. No text
 * box sets a lineHeight: iOS offsets the text and hint in a box that has one, and the reuse above
 * carries it into the next screen's fields (the Friends search, sign-in), shifting their hints.
 */
export function bigInputStyle(colors: Colors): TextStyle {
  return { fontFamily: TYPE.hero.fontFamily, fontSize: TYPE.hero.fontSize, color: colors.text, letterSpacing: 0, padding: 0 };
}
