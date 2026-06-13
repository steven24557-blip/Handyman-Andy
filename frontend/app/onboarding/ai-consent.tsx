import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Check, ShieldCheck, Cpu, Mic2, Brain } from 'lucide-react-native';
import Button from '@/src/components/Button';
import { api } from '@/src/lib/api';
import { useAuth } from '@/src/lib/auth';
import { colors, radius, space } from '@/src/lib/theme';

export const AI_CONSENT_VERSION = '1.0.0';

const ITEMS = [
  {
    key: 'gemini_vision',
    Icon: Brain,
    label: 'I consent to the secure streaming of my camera images to Google Gemini 2.5 Flash for operational analysis.',
  },
  {
    key: 'whisper_audio',
    Icon: Mic2,
    label: 'I consent to the processing of biometric audio inputs via OpenAI Whisper for secure job-site transcription.',
  },
  {
    key: 'no_training',
    Icon: Cpu,
    label: 'I acknowledge that, per third-party enterprise API terms, my operational data is used solely for real-time inference and is contractually barred from training public models.',
  },
];

export default function AIConsentScreen() {
  const router = useRouter();
  const { refresh } = useAuth();
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);

  const allChecked = ITEMS.every((i) => accepted[i.key]);

  const submit = async () => {
    if (!allChecked) return;
    setSubmitting(true);
    try {
      await api.recordConsent({
        consent_version: AI_CONSENT_VERSION,
        accepted_items: ITEMS.filter((i) => accepted[i.key]).map((i) => i.key),
        kind: 'ai_processing',
      });
      await refresh();
      router.replace('/(tabs)');
    } catch (e: any) {
      Alert.alert('Could not record consent', e?.message || '');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.badge}>
          <ShieldCheck size={14} color={colors.primary} />
          <Text style={styles.badgeText}>STEP 2 OF 2 · MANDATORY DISCLOSURE</Text>
        </View>
        <Text style={styles.title}>AI DATA PROCESSING & BIOMETRIC TRANSPARENCY</Text>
        <Text style={styles.lede}>
          Handy Andy uses third-party enterprise AI providers to deliver vision diagnostics, voice transcription, and synthesis. Per CCPA/CPRA § 1798.100 and EU AI Act Art. 50, you must explicitly consent to each data flow before continuing.
        </Text>

        <View style={{ gap: space.md, marginTop: space.lg }}>
          {ITEMS.map((it) => {
            const checked = !!accepted[it.key];
            return (
              <Pressable
                key={it.key}
                testID={`ai-consent-${it.key}`}
                onPress={() => setAccepted((p) => ({ ...p, [it.key]: !p[it.key] }))}
                style={[styles.card, checked && { borderColor: colors.primary, backgroundColor: 'rgba(234,179,8,0.06)' }]}
              >
                <View style={[styles.box, checked && { backgroundColor: colors.primary, borderColor: colors.primary }]}>
                  {checked && <Check size={16} color="#0a0a0a" strokeWidth={3.5} />}
                </View>
                <View style={styles.iconBox}><it.Icon size={18} color={colors.primary} /></View>
                <Text style={styles.cardText}>{it.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.fine}>
          You may revoke any consent at any time in Settings → Manage Privacy Consent. Your selections, IP address, user-agent, and timestamp are recorded in an immutable audit log retained for 7 years per Cal. Civ. Code § 1798.130.
        </Text>

        <View style={{ height: space.lg }} />
        <Button
          testID="ai-consent-continue"
          label={submitting ? 'RECORDING…' : 'CONFIRM & CONTINUE'}
          onPress={submit}
          disabled={!allChecked}
          loading={submitting}
          fullWidth
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: space.lg, paddingBottom: space.xxl },
  badge: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.md, paddingVertical: 4, borderRadius: radius.pill, borderWidth: 1.5, borderColor: colors.primary, backgroundColor: 'rgba(234,179,8,0.08)' },
  badgeText: { color: colors.primary, fontSize: 10, fontWeight: '900', letterSpacing: 1.5 },
  title: { color: colors.textPrimary, fontSize: 22, fontWeight: '900', letterSpacing: 1, marginTop: space.md, lineHeight: 28 },
  lede: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, marginTop: space.sm },
  card: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.md, borderWidth: 2, borderColor: colors.borderStrong, backgroundColor: colors.surface },
  box: { width: 26, height: 26, borderWidth: 2, borderColor: colors.borderStrong, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  iconBox: { width: 36, height: 36, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.background },
  cardText: { color: colors.textPrimary, fontSize: 13, lineHeight: 18, flex: 1, fontWeight: '600' },
  fine: { color: colors.textTertiary, fontSize: 11, lineHeight: 16, marginTop: space.lg, fontStyle: 'italic' },
});
