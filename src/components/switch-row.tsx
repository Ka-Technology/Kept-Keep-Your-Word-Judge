// An on/off choice as a one-row card: an optional outline icon and the label on the left, the phone's
// own switch on the right (A3, T101: a ListRow with a toggle). Used for "Donate even if they don't
// finish" (T31), "Let backers find this challenge" (T44) and the Face ID and AI choices. Nothing is
// on unless the person turns it on (SPEC.md: never preselected).

import type { SymbolViewProps } from 'expo-symbols';

import { ListRow, ListSection } from '@/components/list';

export function SwitchRow({
  label,
  value,
  onValueChange,
  disabled = false,
  icon,
}: {
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  icon?: SymbolViewProps['name'];
}) {
  return (
    <ListSection>
      <ListRow label={label} icon={icon} toggle={{ value, onValueChange, disabled }} first />
    </ListSection>
  );
}
