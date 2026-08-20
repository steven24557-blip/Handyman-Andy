import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { ArrowLeft, CheckCircle2, Sparkles, Zap } from 'lucide-react-native';
import Button from '@/src/components/Button';
import { api } from '@/src/lib/api';
import { useSubscription } from '@/src/lib/subscription';
import { colors, radius, space } from '@/src/lib/theme';

type Plan = {
  id: 'monthly' | 'annual';
  name: string;
  interval: 'month' | 'year';
  amount_display: string;
  period_display: string;
  monthly_equivalent?: string;
  savings_pct?: number;
};

const FEATURES: { icon: any; label: string }[] = [
  { icon: Sparkles, label: 'Unlimited AI photo analysis' },
  { icon: Sparkles, label: 'Unlimited voice intake & diagnostics' },
  { icon: Sparkles, label: 'Full history & PDF reports' },
  { icon: Sparkles, label: 'Advanced hazard scanning' },
  { icon: Sparkles, label: 'Priority support' },
  { icon: Sparkles, label: 'Future AR mascot enhancements' },
];

export default function PricingScreen() {
  const router = useRouter();
  const { sub, refresh } = useSubscription();
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [trialDays, setTrialDays] = useState(14);
  const [selected, setSelected] = useState<'monthly' | 'annual'>('annual');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.subscriptionPlans();
        setPlans(r.plans);
        setTrialDays(r.trial_days);
      } catch (e: any) {
        Alert.alert('Could not load pricing', e?.message || 'Try again');
      } finally { setLoading(false); }
    })();
    refresh();
  }, [refresh]);

  const onUpgrade = async () => {
    setBusy(true);
    try {
      const origin =
        Platform.OS === 'web'
          ? window.location.origin
          : (process.env.EXPO_PUBLIC_BACKEND_URL || '');
      const r = await api.subscriptionCheckout(selected, origin);
      if (Platform.OS === 'web') {
        window.location.href = r.checkout_url;
      } else {
        await WebBrowser.openBrowserAsync(r.checkout_url);
        // Refresh on return so trial → active flip is visible even before webhook fires.
        await refresh();
      }
    } catch (e: any) {
      Alert.alert('Upgrade failed', e?.message || 'Try again');
    } finally { setBusy(false); }
  };

  const openPortal = async () => {
    if (!sub?.is_pro || sub?.status === 'trialing') {
      Alert.alert('Not available', 'Manage Subscription becomes available after your first paid billing cycle.');
      return;
    }
    setBusy(true);
    try {
      const origin =
        Platform.OS === 'web'
          ? window.location.origin
          : (process.env.EXPO_PUBLIC_BACKEND_URL || '');
      const r = await api.subscriptionPortal(origin);
      if (Platform.OS === 'web') window.location.href = r.portal_url;
      else await Linking.openURL(r.portal_url);
    } catch (e: any) {
      Alert.alert('Portal error', e?.message || 'Try again');
    } finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ paddingBottom: space.xl }}>
        <View style={styles.header}>
          <Pressable testID="pricing-back" onPress={() => router.back()} hitSlop={12} style={styles.backRow}>
            <ArrowLeft size={18} color={colors.textSecondary} />
            <Text style={styles.backText}>BACK</Text>
          </Pressable>
          <View style={styles.brandRow}>
            <Zap size={20} color={colors.primary} />
            <Text style={styles.brand}>HANDY-ANDY PRO</Text>
          </View>
          <Text style={styles.title}>Do more. Bill more.</Text>
          <Text style={styles.subtitle}>
            Try Pro free for <Text style={styles.strong}>{trialDays} days</Text>. No card required. Cancel anytime.
          </Text>

          {sub?.in_trial ? (
            <View testID="pricing-trial-banner" style={styles.trialBanner}>
              <Text style={styles.trialText}>
                <Text style={styles.strong}>{sub.trial_days_remaining} day{sub.trial_days_remaining === 1 ? '' : 's'}</Text> left in your free trial
              </Text>
            </View>
          ) : sub?.status === 'active' ? (
            <View testID="pricing-active-banner" style={[styles.trialBanner, { backgroundColor: colors.success + '22', borderColor: colors.success }]}>
              <Text style={styles.trialText}>You are on Handy-Andy Pro. Thanks for supporting the app!</Text>
            </View>
          ) : null}
        </View>

        {loading || !plans ? (
          <View style={styles.loader}><ActivityIndicator color={colors.primary} /></View>
        ) : (
          <View style={styles.plansWrap}>
            {plans.map((plan) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                selected={selected === plan.id}
                onSelect={() => setSelected(plan.id)}
              />
            ))}
          </View>
        )}

        <View style={styles.features}>
          <Text style={styles.featuresTitle}>WHAT YOU GET</Text>
          {FEATURES.map((f, i) => (
            <View key={i} style={styles.featureRow}>
              <CheckCircle2 size={18} color={colors.primary} strokeWidth={2.5} />
              <Text style={styles.featureText}>{f.label}</Text>
            </View>
          ))}
        </View>

        <View style={styles.actions}>
          <Button
            testID="pricing-upgrade-btn"
            label={busy ? 'OPENING CHECKOUT…' : `UPGRADE TO ${selected.toUpperCase()}`}
            variant="primary"
            loading={busy}
            disabled={busy || !plans}
            onPress={onUpgrade}
            fullWidth
          />
          {sub?.status === 'active' || (sub?.stripe_subscription_id as any) ? (
            <Button
              testID="pricing-manage-btn"
              label="MANAGE SUBSCRIPTION"
              variant="outline"
              onPress={openPortal}
              fullWidth
            />
          ) : null}
          <Text style={styles.finePrint}>
            Prices in USD. Billed at the end of your {trialDays}-day free trial. Cancel or change plan anytime from Settings.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function PlanCard({ plan, selected, onSelect }: { plan: Plan; selected: boolean; onSelect: () => void }) {
  const isAnnual = plan.id === 'annual';
  return (
    <Pressable
      testID={`pricing-plan-${plan.id}`}
      onPress={onSelect}
      style={[styles.card, selected && styles.cardSelected, isAnnual && !selected && styles.cardHint]}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
    >
      {isAnnual ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>SAVE {plan.savings_pct}%</Text>
        </View>
      ) : null}
      <View style={styles.cardHead}>
        <View style={[styles.radio, selected && styles.radioActive]}>
          {selected ? <View style={styles.radioDot} /> : null}
        </View>
        <Text style={styles.planName}>{plan.name.replace('Handy-Andy Pro ', '').replace(/[()]/g, '').toUpperCase()}</Text>
      </View>
      <Text style={styles.price}>{plan.amount_display}</Text>
      <Text style={styles.period}>{plan.period_display}</Text>
      {isAnnual && plan.monthly_equivalent ? (
        <Text style={styles.equivalent}>Just {plan.monthly_equivalent}/mo</Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { padding: space.lg, gap: space.sm },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  backText: { color: colors.textSecondary, fontSize: 11, fontWeight: '900', letterSpacing: 1.5 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: space.xs },
  brand: { color: colors.primary, fontSize: 12, fontWeight: '900', letterSpacing: 2 },
  title: { color: colors.textPrimary, fontSize: 30, fontWeight: '900', letterSpacing: 0.5 },
  subtitle: { color: colors.textSecondary, fontSize: 14, lineHeight: 21 },
  strong: { color: colors.primary, fontWeight: '900' },

  trialBanner: {
    marginTop: space.sm, paddingVertical: 10, paddingHorizontal: space.md,
    borderRadius: radius.sm, backgroundColor: colors.primaryMuted,
    borderWidth: 1, borderColor: colors.primary,
  },
  trialText: { color: colors.textPrimary, fontSize: 13, textAlign: 'center', fontWeight: '700' },

  loader: { padding: space.xl, alignItems: 'center' },
  plansWrap: { flexDirection: 'row', paddingHorizontal: space.lg, gap: space.md },
  card: {
    flex: 1, backgroundColor: colors.surface, borderRadius: radius.md,
    borderWidth: 2, borderColor: colors.border,
    padding: space.lg, gap: 4, position: 'relative', minHeight: 180,
  },
  cardHint: { borderColor: colors.primary + '55' },
  cardSelected: { borderColor: colors.primary, backgroundColor: colors.primaryMuted },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.xs },
  radio: {
    width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colors.borderStrong,
    alignItems: 'center', justifyContent: 'center',
  },
  radioActive: { borderColor: colors.primary },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },
  planName: { color: colors.textSecondary, fontSize: 11, fontWeight: '900', letterSpacing: 1.5 },
  price: { color: colors.textPrimary, fontSize: 32, fontWeight: '900', letterSpacing: -0.5 },
  period: { color: colors.textTertiary, fontSize: 12, fontWeight: '700' },
  equivalent: { color: colors.primary, fontSize: 12, fontWeight: '900', marginTop: 4 },
  badge: {
    position: 'absolute', top: -10, right: 10, backgroundColor: colors.primary,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill,
  },
  badgeText: { color: '#0a0a0a', fontSize: 10, fontWeight: '900', letterSpacing: 1 },

  features: {
    marginTop: space.lg, marginHorizontal: space.lg,
    padding: space.lg, borderRadius: radius.md,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    gap: 10,
  },
  featuresTitle: { color: colors.textTertiary, fontSize: 11, fontWeight: '900', letterSpacing: 1.5, marginBottom: space.xs },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  featureText: { color: colors.textPrimary, fontSize: 14, flex: 1, lineHeight: 20 },

  actions: { padding: space.lg, gap: space.sm },
  finePrint: { color: colors.textTertiary, fontSize: 11, textAlign: 'center', lineHeight: 16, marginTop: space.xs },
});
