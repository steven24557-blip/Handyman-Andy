import React, { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Slider from '@react-native-community/slider';
import { Volume2, Play, Mic2, Gauge, LogOut, Trash2, Briefcase, CreditCard, ShieldCheck, ChevronRight } from 'lucide-react-native';
import { createAudioPlayer } from 'expo-audio';

import Button from '@/src/components/Button';
import { api } from '@/src/lib/api';
import { useAuth } from '@/src/lib/auth';
import { useSubscription } from '@/src/lib/subscription';
import { colors, radius, space, text } from '@/src/lib/theme';
import { storage } from '@/src/utils/storage';
import { useRouter } from 'expo-router';

const PERSONAS = [
  { key: 'standard', name: 'STANDARD ANDY', desc: 'Calm pro tone' },
  { key: 'folksy', name: 'FOLKSY ANDY', desc: 'Friendly small-town' },
  { key: 'southern', name: 'SOUTHERN ANDY', desc: 'Easy drawl' },
  { key: 'sassy', name: 'SASSY ANDY', desc: 'Confident & playful' },
];

export default function SettingsScreen() {
  const { user, signOut, refresh: refreshAuth } = useAuth();
  const { sub, refresh: refreshSub, showPaywall } = useSubscription();
  const router = useRouter();
  const [persona, setPersona] = useState<string>('standard');
  const [pitch, setPitch] = useState<number>(1.0); // client-side cue (not sent)
  const [pace, setPace] = useState<number>(1.0);
  const [previewing, setPreviewing] = useState(false);
  const [subBusy, setSubBusy] = useState(false);
  const [qbBusy, setQbBusy] = useState(false);
  const [sqBusy, setSqBusy] = useState(false);
  const qbEnabled = user?.accounting?.quickbooks?.enabled || false;
  const sqEnabled = user?.accounting?.square?.enabled || false;

  useEffect(() => {
    (async () => {
      setPersona((await storage.getItem<string>('jp_voice_persona', 'standard')) || 'standard');
      setPitch((await storage.getItem<number>('jp_voice_pitch', 1.0)) || 1.0);
      setPace((await storage.getItem<number>('jp_voice_pace', 1.0)) || 1.0);
    })();
  }, []);

  const savePersona = async (p: string) => {
    setPersona(p);
    await storage.setItem('jp_voice_persona', p);
  };

  const savePitch = async (v: number) => {
    setPitch(v);
    await storage.setItem('jp_voice_pitch', v);
  };

  const savePace = async (v: number) => {
    setPace(v);
    await storage.setItem('jp_voice_pace', v);
  };

  const preview = async () => {
    setPreviewing(true);
    try {
      const res = await api.greet(persona, pace);
      if (res?.audio_base64) {
        const player = createAudioPlayer({ uri: `data:audio/mp3;base64,${res.audio_base64}` });
        player.play();
      }
    } catch (e: any) {
      Alert.alert('Preview failed', e?.message || '');
    } finally {
      setPreviewing(false);
    }
  };

  const replayGreeting = async () => {
    await storage.removeItem('jp_voice_greeted');
    Alert.alert('Greeting reset', 'You will be greeted again on next launch.');
  };

  const onLogout = async () => {
    await signOut();
    router.replace('/login');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <View>
            <Text style={styles.tag}>OPERATOR</Text>
            <Text style={styles.brand}>{user?.name || 'Field Tech'}</Text>
            <Text style={styles.email}>{user?.email}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <CreditCard size={16} color={colors.primary} />
            <Text style={styles.sectionTitle}>SUBSCRIPTION</Text>
          </View>
          <View style={styles.personaCard}>
            <Text style={styles.personaName}>
              {sub?.is_pro ? (sub?.status === 'trialing' ? 'TRIALING · PRO ACCESS' : 'ACTIVE · PRO') : 'FREE TIER'}
            </Text>
            <Text style={styles.personaDesc}>
              {sub?.is_pro
                ? `Unlimited AI scans · jobs · markups`
                : `${sub?.ai_scan_count_this_month || 0}/${sub?.ai_limit_free || 2} AI scans · max ${sub?.job_limit_free || 3} jobs`}
            </Text>
          </View>
          {!sub?.is_pro && (
            <Button label="UPGRADE TO PRO — $39/MO" onPress={() => showPaywall('Unlock everything Andy can do.')} fullWidth />
          )}
          {sub?.is_pro && sub?.status !== 'canceled' && (
            <Button
              testID="cancel-sub-btn"
              label={subBusy ? 'CANCELING…' : 'CANCEL SUBSCRIPTION'}
              variant="outline"
              loading={subBusy}
              onPress={async () => {
                setSubBusy(true);
                try { await api.subCancel(); await refreshSub(); }
                catch (e: any) { Alert.alert('Cancel failed', e?.message || ''); }
                finally { setSubBusy(false); }
              }}
              fullWidth
            />
          )}
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Briefcase size={16} color={colors.primary} />
            <Text style={styles.sectionTitle}>FINANCIAL INTEGRATIONS</Text>
          </View>
          {[
            { key: 'quickbooks', name: 'QUICKBOOKS ONLINE', enabled: qbEnabled, busy: qbBusy, setBusy: setQbBusy },
            { key: 'square', name: 'SQUARE', enabled: sqEnabled, busy: sqBusy, setBusy: setSqBusy },
          ].map((p) => (
            <View key={p.key} style={[styles.personaCard, p.enabled && { borderColor: colors.success }]}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.personaName}>{p.name}</Text>
                  <Text style={styles.personaDesc}>{p.enabled ? 'Connected · syncing closed jobs' : 'Not connected'}</Text>
                </View>
                <Button
                  testID={`acct-${p.key}-btn`}
                  label={p.busy ? '…' : (p.enabled ? 'DISCONNECT' : 'CONNECT')}
                  variant={p.enabled ? 'outline' : 'primary'}
                  loading={p.busy}
                  onPress={async () => {
                    p.setBusy(true);
                    try {
                      await api.accountingConnect(p.key as any, !p.enabled);
                      await refreshAuth();
                    } catch (e: any) {
                      Alert.alert('Failed', e?.message || '');
                    } finally { p.setBusy(false); }
                  }}
                />
              </View>
            </View>
          ))}
        </View>


        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Mic2 size={16} color={colors.primary} />
            <Text style={styles.sectionTitle}>VOICE PERSONA (ANDY)</Text>
          </View>
          <View style={styles.personaGrid}>
            {PERSONAS.map((p) => {
              const active = persona === p.key;
              return (
                <Pressable
                  key={p.key}
                  testID={`persona-${p.key}`}
                  onPress={() => savePersona(p.key)}
                  style={[styles.personaCard, active && styles.personaCardActive]}
                >
                  <Text style={[styles.personaName, active && { color: '#0a0a0a' }]}>{p.name}</Text>
                  <Text style={[styles.personaDesc, active && { color: '#0a0a0a' }]}>{p.desc}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Gauge size={16} color={colors.primary} />
            <Text style={styles.sectionTitle}>VOICE PARAMETERS</Text>
          </View>

          <View style={styles.sliderRow}>
            <Text style={styles.sliderLabel}>PITCH</Text>
            <Text style={styles.sliderValue}>{pitch.toFixed(2)}x</Text>
          </View>
          <Slider
            minimumValue={0.5}
            maximumValue={1.5}
            step={0.05}
            value={pitch}
            onSlidingComplete={savePitch}
            minimumTrackTintColor={colors.primary}
            maximumTrackTintColor={colors.borderStrong}
            thumbTintColor={colors.primary}
          />

          <View style={styles.sliderRow}>
            <Text style={styles.sliderLabel}>PACE</Text>
            <Text style={styles.sliderValue}>{pace.toFixed(2)}x</Text>
          </View>
          <Slider
            minimumValue={0.6}
            maximumValue={1.6}
            step={0.05}
            value={pace}
            onSlidingComplete={savePace}
            minimumTrackTintColor={colors.primary}
            maximumTrackTintColor={colors.borderStrong}
            thumbTintColor={colors.primary}
          />

          <View style={{ height: space.md }} />
          <Button
            testID="settings-preview-btn"
            label={previewing ? 'GENERATING…' : 'PREVIEW VOICE'}
            icon={<Play size={16} color="#0a0a0a" />}
            onPress={preview}
            loading={previewing}
            fullWidth
          />
          <View style={{ height: space.sm }} />
          <Button
            testID="settings-reset-greeting-btn"
            label="REPLAY GREETING NEXT LAUNCH"
            variant="outline"
            icon={<Volume2 size={16} color={colors.textPrimary} />}
            onPress={replayGreeting}
            fullWidth
          />
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <ShieldCheck size={16} color={colors.primary} />
            <Text style={styles.sectionTitle}>PRIVACY & LEGAL</Text>
          </View>
          <Pressable testID="settings-privacy-row" onPress={() => router.push('/privacy')} style={styles.legalRow}>
            <Text style={styles.legalLabel}>Privacy Policy</Text>
            <ChevronRight size={16} color={colors.textTertiary} />
          </Pressable>
          <Pressable testID="settings-terms-row" onPress={() => router.push('/terms')} style={styles.legalRow}>
            <Text style={styles.legalLabel}>Terms of Service</Text>
            <ChevronRight size={16} color={colors.textTertiary} />
          </Pressable>
          <Pressable testID="settings-consent-row" onPress={() => router.push('/consent')} style={styles.legalRow}>
            <Text style={styles.legalLabel}>Manage Privacy Consent</Text>
            <ChevronRight size={16} color={colors.textTertiary} />
          </Pressable>
        </View>

        <View style={styles.section}>
          <Button
            testID="settings-logout-btn"
            label="SIGN OUT"
            variant="danger"
            icon={<LogOut size={16} color="#fff" />}
            onPress={onLogout}
            fullWidth
          />
          <View style={{ height: space.sm }} />
          <Button
            testID="settings-delete-account-btn"
            label="DELETE ACCOUNT"
            variant="outline"
            icon={<Trash2 size={16} color={colors.danger} />}
            onPress={() => {
              // Anti-dark-pattern: single confirm step, symmetric buttons,
              // no email-support detour, no multi-step verification chain.
              Alert.alert(
                'Delete account?',
                'This permanently and immediately erases your account, all jobs, photos, voice transcripts, and audit history. This cannot be undone.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Delete now',
                    style: 'destructive',
                    onPress: async () => {
                      try { await api.deleteAccount(); } catch {}
                      await signOut();
                      router.replace('/login');
                    },
                  },
                ],
                { cancelable: true },
              );
            }}
            fullWidth
          />
        </View>

        <Text style={styles.footer}>HANDY-ANDY · v2.0 · BUILD 26.02</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: space.lg, paddingBottom: space.xxl, gap: space.lg },
  header: { marginBottom: space.sm },
  tag: { color: colors.primary, fontSize: 11, fontWeight: '900', letterSpacing: 2 },
  brand: { color: colors.textPrimary, fontSize: 22, fontWeight: '900', letterSpacing: 0.8, marginTop: 2 },
  email: { color: colors.textSecondary, fontSize: 12, marginTop: 4 },
  section: { gap: space.sm },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: 4 },
  sectionTitle: { color: colors.textPrimary, fontSize: 13, fontWeight: '900', letterSpacing: 1.5 },
  personaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  personaCard: {
    flexBasis: '47%', flexGrow: 1,
    padding: space.md, borderRadius: radius.md,
    backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.borderStrong,
  },
  personaCardActive: { backgroundColor: colors.primary, borderColor: colors.primaryDark },
  personaName: { color: colors.textPrimary, fontWeight: '900', letterSpacing: 1, fontSize: 13 },
  personaDesc: { color: colors.textSecondary, fontSize: 12, marginTop: 4 },
  sliderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: space.sm },
  sliderLabel: { color: colors.textSecondary, fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  sliderValue: { color: colors.primary, fontWeight: '900', fontSize: 13 },
  footer: {
    color: colors.textTertiary, textAlign: 'center', fontSize: 10,
    letterSpacing: 2, fontWeight: '700', marginTop: space.md,
  },
});
