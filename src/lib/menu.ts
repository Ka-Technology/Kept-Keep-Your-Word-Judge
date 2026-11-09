// A short menu of actions: the iOS action sheet (with Cancel), or an alert on other platforms. A
// choice marked `destructive` shows in red, like Remove.

import { ActionSheetIOS, Alert, Platform } from 'react-native';

export type MenuChoice = { label: string; run: () => void; destructive?: boolean };

export function showMenu(title: string | undefined, choices: MenuChoice[]): void {
  if (Platform.OS === 'ios') {
    const destructive = choices.findIndex((c) => c.destructive);
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title,
        options: [...choices.map((c) => c.label), 'Cancel'],
        cancelButtonIndex: choices.length,
        destructiveButtonIndex: destructive < 0 ? undefined : destructive,
      },
      (index) => choices[index]?.run(),
    );
  } else {
    Alert.alert(title ?? '', undefined, [
      ...choices.map((c) => ({ text: c.label, onPress: c.run, style: c.destructive ? ('destructive' as const) : undefined })),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  }
}
