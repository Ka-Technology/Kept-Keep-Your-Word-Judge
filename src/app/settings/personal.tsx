// Settings → Personal information (T48): email (changeable for email accounts, T207, decision 168; Apple and
// Google accounts' comes from them) and sign-in method, name (T145, decision
// 100: accounts from before add theirs here), username and state (changeable, T39), date of birth
// (locked: it's the 18+ check), and Change password for email accounts. The profile photo is changed
// on your profile. As in the A3 mockup since T128 (full-set/ui-set-1-personal.jpg): "Personal info"
// large, one card of rows, each a small label over its value, a lock on the date of birth.

import { router } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import { ListRow, ListScreen, ListSection } from '@/components/list';
import { StatePicker } from '@/components/profile-fields';
import { PageTitle } from '@/components/tab-title';
import { useAuth } from '@/lib/auth';
import { signInMethodLabel } from '@/lib/auth-state';
import { fromDateString, profileSaveMessage } from '@/lib/profile';
import { US_STATES } from '@/lib/us-states';

export default function PersonalInformation() {
  const { session, profile, updateProfile } = useAuth();
  const [pickingState, setPickingState] = useState(false);

  const name = profile?.first_name && profile.last_name ? `${profile.first_name} ${profile.last_name}` : undefined;
  const stateName = US_STATES.find((s) => s.code === profile?.state_code)?.name ?? profile?.state_code ?? '';
  const dob = profile ? fromDateString(profile.date_of_birth).toLocaleDateString(undefined, { dateStyle: 'long' }) : '';
  // Only email accounts have a password to change; Google and Apple users sign in with those.
  const hasPassword = session?.user.app_metadata.provider === 'email';

  /** Saves a newly picked state. The row shows it as soon as it's saved; a failure says why. */
  async function chooseState(code: string) {
    setPickingState(false);
    if (code === profile?.state_code) return;
    const result = await updateProfile({ state_code: code });
    if (result !== 'saved') Alert.alert("Couldn't change your state", profileSaveMessage(result));
  }

  return (
    <ListScreen>
      <PageTitle title="Personal info" />
      <ListSection
        footer={`Only you see your name, email, date of birth and state. ${
          hasPassword ? 'Your date of birth can’t be changed.' : `Your email comes from ${signInMethodLabel(session?.user.app_metadata.provider)}, and your date of birth can’t be changed.`
        } Change your profile photo on your profile.`}
      >
        <ListRow overline="Name" label={name ?? 'Add your name'} onPress={() => router.push('/edit-name')} first />
        <ListRow overline="Username" label={`@${profile?.username ?? ''}`} onPress={() => router.push('/edit-username')} />
        <ListRow overline="Email" label={session?.user.email ?? ''} onPress={hasPassword ? () => router.push('/change-email') : undefined} />
        <ListRow overline="Date of birth" label={dob} locked />
        <ListRow overline="State" label={stateName} onPress={() => setPickingState(true)} />
        <ListRow overline="Signs in with" label={signInMethodLabel(session?.user.app_metadata.provider)} />
      </ListSection>
      {hasPassword && (
        <ListSection>
          <ListRow label="Change password" icon={{ ios: 'lock', android: 'lock' }} onPress={() => router.push('/change-password')} first />
        </ListSection>
      )}

      <StatePicker
        visible={pickingState}
        selected={profile?.state_code ?? null}
        onPick={chooseState}
        onClose={() => setPickingState(false)}
      />
    </ListScreen>
  );
}
