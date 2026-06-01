import React, { useState } from 'react';
import { Alert, Linking, Modal, Pressable, StyleSheet, Text, View, ScrollView } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { X, CheckCircle2, Hammer, Wrench, Sparkles, Lock } from 'lucide-react-native';
import Button from './Button';
import { api } from '@/src/lib/api';
import { useSubscription } from '@/src/lib/subscription';
import { colors, radius, space } from '@/src/lib/theme';

const BENEFITS = [
  { Icon: Sparkles, label: 'UNLIMITED AI VISION SCANS', sub: 'Diagnostics, safety, job analysis — no caps.' },
  { Icon: Wrench, label: 'UNLIMITED JOBS', sub: 'Run as many active job sites as you can handle.' },
  { Icon: Hammer, label: 'CUSTOM MATERIAL MARKUPS', sub: 'Set 15/25/35% or your own. Unwatermarked estimates.' },
  { Icon: CheckCircle2, label: 'PARTS CHECKOUT + ACCOUNTING', sub: 'Push closed jobs to QuickBooks & Square.' },
];

export default function PaywallSheet() {
  const { paywallVisible, paywallReason, hidePaywall, refresh, sub } = useSubscription();
  const [loading, setLoading] = useState(false);

  const start = async () => {
    setLoading(true);
    try {
      const origin = process.env.EXPO_PUBLIC_BACKEND_URL || '';
      const res = await api.subCheckout(origin);
      const result = await WebBrowser.openAuthSessionAsync(res.checkout_url, `${origin}/billing/success`);
      if (result.type === 'success' && result.url) {
        const m = result.url.match(/session_id=([^&]+)/);
        if (m) {
          await api.subConfirm(decodeURIComponent(m[1]));
        }
      }
      await refresh();
      hidePaywall();
    } catch (e: any) {
      Alert.alert('Checkout failed', e?.message || '');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal animationType="slide" transparent visible={paywallVisible} onRequestClose={hidePaywall}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Pressable testID="paywall-close" onPress={hidePaywall} style={styles.close}>
            <X size={20} color={colors.textSecondary} />
          </Pressable>
          <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxl }}>
            <View style={styles.lockBadge}>
              <Lock size={14} color={colors.primary} />
              <Text style={styles.lockBadgeText}>PRO FEATURE</Text>
            </View>
            <Text style={styles.title}>UNLOCK ANDY HANDY PRO</Text>
            {paywallReason && <Text style={styles.reason}>{paywallReason}</Text>}

            <View style={styles.priceCard}>
              <Text style={styles.priceMain}>$39<Text style={styles.priceUnit}>/mo</Text></Text>
              <Text style={styles.priceTag}>Start your 7-Day Free Trial. $39/mo thereafter. Cancel anytime.</Text>
            </View>

            <View style={{ gap: space.md, marginTop: space.lg }}>
              {BENEFITS.map((b, i) => (
                <View key={i} style={styles.row}>
                  <View style={styles.bIcon}><b.Icon size={18} color={colors.primary} strokeWidth={2.5} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.bLabel}>{b.label}</Text>
                    <Text style={styles.bSub}>{b.sub}</Text>
                  </View>
                </View>
              ))}
            </View>

            {sub && (
              <View style={styles.usageRow}>
                <Text style={styles.usageText}>
                  USAGE THIS MONTH: <Text style={{ color: colors.primary }}>
                    {sub.ai_scan_count_this_month}/{sub.ai_limit_free}
                  </Text> AI scans · MAX {sub.job_limit_free} jobs on Free
                </Text>
              </View>
            )}

            <View style={{ height: space.lg }} />
            <Button
              testID="paywall-start-btn"
              label={loading ? 'LAUNCHING CHECKOUT…' : 'START FREE TRIAL'}
              onPress={start}
              loading={loading}
              fullWidth
            />
            <View style={{ height: space.sm }} />
            <Button label="MAYBE LATER" variant="ghost" onPress={hidePaywall} fullWidth />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.scrim, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
    maxHeight: '92%', borderTopWidth: 2, borderColor: colors.primary,
  },
  handle: { width: 40, height: 4, backgroundColor: colors.borderStrong, alignSelf: 'center', marginTop: 10, borderRadius: 2 },
  close: { position: 'absolute', right: 16, top: 12, padding: 6, zIndex: 2 },
  lockBadge: {
    alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: space.md, paddingVertical: 4, borderRadius: radius.pill,
    borderWidth: 1.5, borderColor: colors.primary, backgroundColor: 'rgba(234,179,8,0.08)',
  },
  lockBadgeText: { color: colors.primary, fontSize: 10, fontWeight: '900', letterSpacing: 1.5 },
  title: { color: colors.textPrimary, fontSize: 26, fontWeight: '900', letterSpacing: 1.2, marginTop: space.md },
  reason: { color: colors.textSecondary, marginTop: space.xs, fontSize: 13, lineHeight: 18 },
  priceCard: {
    marginTop: space.lg, padding: space.md, borderRadius: radius.md,
    borderWidth: 2, borderColor: colors.primary, backgroundColor: 'rgba(234,179,8,0.06)',
  },
  priceMain: { color: colors.primary, fontSize: 40, fontWeight: '900', letterSpacing: 1 },
  priceUnit: { fontSize: 18, fontWeight: '700', color: colors.textSecondary },
  priceTag: { color: colors.textPrimary, fontSize: 13, marginTop: 4, fontWeight: '600' },
  row: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  bIcon: {
    width: 36, height: 36, borderRadius: radius.sm,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderStrong,
    alignItems: 'center', justifyContent: 'center',
  },
  bLabel: { color: colors.textPrimary, fontWeight: '900', letterSpacing: 0.8, fontSize: 12 },
  bSub: { color: colors.textSecondary, fontSize: 12, marginTop: 2, lineHeight: 16 },
  usageRow: {
    marginTop: space.lg, padding: space.sm, borderRadius: radius.sm,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  usageText: { color: colors.textSecondary, fontSize: 11, fontWeight: '700', letterSpacing: 0.5, textAlign: 'center' },
});
