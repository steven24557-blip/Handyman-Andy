import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ChevronLeft, ShieldCheck, RefreshCw, Mail } from 'lucide-react-native';
import Button from '@/src/components/Button';
import { api } from '@/src/lib/api';
import { colors, radius, space } from '@/src/lib/theme';

export default function ConsentManager() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState<any[]>([]);

  const load = useCallback(async () => {
    try {
      const r = await api.listConsents();
      setLogs(r.consents || []);
    } catch (e: any) {
      Alert.alert('Could not load consents', e?.message || '');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const renew = async () => {
    router.push('/onboarding/ai-consent');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.top}>
        <Pressable testID="consent-back" onPress={() => router.back()} style={styles.icon}>
          <ChevronLeft size={22} color={colors.textPrimary} />
        </Pressable>
        <View style={styles.titleBox}>
          <ShieldCheck size={16} color={colors.primary} />
          <Text style={styles.title}>MANAGE PRIVACY CONSENT</Text>
        </View>
        <View style={{ width: 44 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.sectionLabel}>YOUR CCPA / CPRA RIGHTS</Text>
        <View style={styles.card}>
          <Text style={styles.rowTitle}>Right to Know</Text>
          <Text style={styles.rowBody}>Request the specific data we hold about you.</Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.rowTitle}>Right to Delete</Text>
          <Text style={styles.rowBody}>Settings → Delete Account permanently erases all your data.</Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.rowTitle}>Right to Limit Use of Sensitive PI</Text>
          <Text style={styles.rowBody}>Revoke voice biometric or photo consent here. Affected features will be disabled until you renew.</Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.rowTitle}>Right to Non-Discrimination</Text>
          <Text style={styles.rowBody}>We will not deny service or charge differently if you exercise any privacy right.</Text>
        </View>

        <Text style={styles.sectionLabel}>CONSENT AUDIT LOG</Text>
        {loading ? (
          <ActivityIndicator color={colors.primary} />
        ) : logs.length === 0 ? (
          <Text style={styles.dim}>No consent records yet.</Text>
        ) : (
          logs.map((l, i) => (
            <View key={i} style={styles.card}>
              <Text style={styles.rowTitle}>{(l.kind || 'consent').toUpperCase()} · v{l.consent_version}</Text>
              <Text style={styles.rowMeta}>
                {new Date(l.timestamp).toLocaleString()} · IP {l.ip || '—'} · UA {(l.user_agent || '').slice(0, 40)}…
              </Text>
              <Text style={styles.rowBody}>
                Accepted: {(l.accepted_items || []).join(', ') || '—'}
              </Text>
            </View>
          ))
        )}

        <View style={{ height: space.md }} />
        <Button testID="renew-consent-btn" label="RE-CONFIRM AI CONSENT" icon={<RefreshCw size={14} color="#0a0a0a" />} onPress={renew} fullWidth />
        <View style={{ height: space.sm }} />
        <Button
          testID="email-privacy-btn"
          label="EMAIL PRIVACY OFFICE"
          variant="outline"
          icon={<Mail size={14} color={colors.textPrimary} />}
          onPress={() => Linking.openURL('mailto:privacy@handyandy.app?subject=Privacy%20Request')}
          fullWidth
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: space.lg, borderBottomWidth: 1, borderBottomColor: colors.border },
  icon: { width: 44, height: 44, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface },
  titleBox: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  title: { color: colors.textPrimary, fontWeight: '900', letterSpacing: 1.2, fontSize: 13 },
  scroll: { padding: space.lg, paddingBottom: space.xxl, gap: space.sm },
  sectionLabel: { color: colors.primary, fontSize: 11, fontWeight: '900', letterSpacing: 1.5, marginTop: space.md },
  card: { padding: space.md, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  rowTitle: { color: colors.textPrimary, fontWeight: '900', fontSize: 13, letterSpacing: 0.4 },
  rowBody: { color: colors.textSecondary, fontSize: 13, lineHeight: 18, marginTop: 4 },
  rowMeta: { color: colors.textTertiary, fontSize: 11, marginTop: 2, fontFamily: 'monospace' },
  dim: { color: colors.textTertiary },
});
