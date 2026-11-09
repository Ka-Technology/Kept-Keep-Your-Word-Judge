// Settings, opened from the gear on your profile (SPEC-app-shell.md, T48): a list of category pages, like the
// iPhone's own Settings, then Sign out. Each category lives in app/settings/. As in the A3 mockup since
// T121 (full-set/ui-push-2-settings.jpg): "Settings" large, one card of rows with outline icons, Blocked
// people among them, and Sign out as a red row; Delete account moved into Privacy and security.

import { router, type Href } from 'expo-router';
import type { SymbolViewProps } from 'expo-symbols';

import { ListRow, ListScreen, ListSection } from '@/components/list';
import { PageTitle } from '@/components/tab-title';
import { useAuth } from '@/lib/auth';

type Category = { label: string; icon: SymbolViewProps['name']; href: Href };

/** The categories, in the mockup's order. */
const CATEGORIES: Category[] = [
  { label: 'Personal info', icon: { ios: 'person', android: 'person' }, href: '/settings/personal' },
  { label: 'Payments', icon: { ios: 'wallet.bifold', android: 'account_balance_wallet' }, href: '/settings/payments' },
  { label: 'Privacy and security', icon: { ios: 'shield', android: 'shield' }, href: '/settings/privacy' },
  { label: 'Notifications', icon: { ios: 'bell', android: 'notifications' }, href: '/settings/notifications' },
  { label: 'App', icon: { ios: 'gearshape', android: 'settings' }, href: '/settings/app' },
  { label: 'About', icon: { ios: 'info.circle', android: 'info' }, href: '/settings/about' },
  { label: 'Blocked people', icon: { ios: 'person.slash', android: 'block' }, href: '/settings/blocked' },
];

export default function Settings() {
  const { signOut } = useAuth();
  return (
    <ListScreen>
      <PageTitle title="Settings" />
      <ListSection>
        {CATEGORIES.map((c, i) => (
          <ListRow key={c.label} label={c.label} icon={c.icon} onPress={() => router.push(c.href)} first={i === 0} />
        ))}
      </ListSection>
      <ListSection>
        <ListRow label="Sign out" icon={{ ios: 'rectangle.portrait.and.arrow.right', android: 'logout' }} onPress={signOut} destructive first />
      </ListSection>
    </ListScreen>
  );
}
