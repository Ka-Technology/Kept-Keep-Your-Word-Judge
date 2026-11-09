// Settings → About Kept (T48): Kept's mark at the top (T51), How Kept works (the tutorial), the official
// rules and each policy (T50, one page each), Send feedback (T158), how to reach Kept, who runs Kept, the display font's
// license notice, the open-source licenses (T179), and the app's version, read from app.json through expo-constants. As in the A3
// mockup since T133 (full-set/ui-set-6-about.jpg): "About Kept" large, the K stamp beside the version
// in a card, one card of rows with outline icons, "Apple is not a sponsor of Kept." under it.

import Constants from 'expo-constants';
import { router } from 'expo-router';
import type { SymbolViewProps } from 'expo-symbols';
import { Alert, Linking, StyleSheet, Text, View } from 'react-native';

import { DayStamp } from '@/components/big-stamp';
import { ListRow, ListScreen, ListSection } from '@/components/list';
import { PageTitle } from '@/components/tab-title';
import { OPERATOR, POLICIES, POLICY_IDS, type PolicyId } from '@/lib/policies';
import { RADIUS, SPACE, TEXT, useColors, useStyles, type Colors } from '@/lib/theme';

const POLICY_ICONS: Record<PolicyId, SymbolViewProps['name']> = {
  terms: { ios: 'doc.text', android: 'description' },
  privacy: { ios: 'shield', android: 'shield' },
  refunds: { ios: 'dollarsign.arrow.circlepath', android: 'currency_exchange' },
  community: { ios: 'person.2', android: 'group' },
};

/**
 * Opens Mail to Kept. Without the Mail app iOS offers to restore it, and cancelling that rejects the
 * open (T152): then the address shows instead, to write from another app.
 */
function contactKept() {
  Linking.openURL(`mailto:${OPERATOR.email}`).catch(() => Alert.alert('Email Kept', `Write to ${OPERATOR.email} from any email app.`));
}

export default function AboutKept() {
  const styles = useStyles(makeStyles);
  const colors = useColors();
  const version = Constants.expoConfig?.version ?? '';
  return (
    <ListScreen>
      <PageTitle title="About Kept" />
      <View style={styles.versionCard} accessible accessibilityLabel={`Kept, version ${version}, demo`}>
        <DayStamp kind="kept" color={colors.stamp} size={72} />
        <View style={styles.versionText}>
          <Text style={styles.version}>Version {version} (demo)</Text>
          <Text style={styles.tagline}>Your word, stamped.</Text>
        </View>
      </View>
      <ListSection footer="Apple is not a sponsor of Kept. The rules and policies are drafts until a lawyer has reviewed them.">
        <ListRow label="How Kept works" icon={{ ios: 'book', android: 'menu_book' }} onPress={() => router.push('/tutorial')} first />
        <ListRow label="Official rules" icon={{ ios: 'list.bullet.rectangle', android: 'gavel' }} onPress={() => router.push('/rules')} />
        {POLICY_IDS.map((doc) => (
          <ListRow key={doc} label={POLICIES[doc].title} icon={POLICY_ICONS[doc]} onPress={() => router.push({ pathname: '/policy/[doc]', params: { doc } })} />
        ))}
        <ListRow label="Send feedback" icon={{ ios: 'bubble.left', android: 'chat_bubble' }} onPress={() => router.push('/feedback')} />
        <ListRow label={`Contact ${OPERATOR.email}`} icon={{ ios: 'envelope', android: 'mail' }} onPress={contactKept} />
        <ListRow label="Open-source licenses" icon={{ ios: 'shippingbox', android: 'inventory_2' }} onPress={() => router.push('/settings/licenses')} />
      </ListSection>
      <ListSection
        title="Who runs Kept"
        footer="Titles are set in Bricolage Grotesque, © The Bricolage Grotesque Project Authors, used under the SIL Open Font License 1.1."
      >
        <ListRow label={OPERATOR.name} detail={OPERATOR.place} first />
      </ListSection>
    </ListScreen>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    versionCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACE.xl,
      padding: SPACE.xl,
      borderRadius: RADIUS.tile,
      borderCurve: 'continuous',
      backgroundColor: c.card,
      boxShadow: c.tileShadow || undefined,
    },
    versionText: { flex: 1, gap: SPACE.xxs },
    version: { ...TEXT.row, color: c.secondaryText },
    tagline: { ...TEXT.note, color: c.secondaryText },
  });
