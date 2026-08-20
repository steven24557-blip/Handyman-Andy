import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { Check, ChevronDown, Hammer, Mail, ShieldCheck, User as UserIcon, X } from 'lucide-react-native';
import FadeInView from '@/src/components/FadeInView';
import Button from '@/src/components/Button';
import { useAuth } from '@/src/lib/auth';
import { colors, radius, space } from '@/src/lib/theme';

const APP_VERSION = '2.0.0';

const DISCLAIMER = `PROFESSIONAL SERVICES DISCLAIMER\n\nBy using Handy-Andy: Job Site Assistant ("the Application"), you acknowledge and accept the following terms in full. Scroll to the bottom to enable the agreement checkbox.\n\n1. NATURE OF SERVICE — AI-assisted diagnostics, repair suggestions, BOM estimates, and field-safety evaluations. Informational guidance only, not a substitute for inspection by a licensed professional.\n\n2. NO PROFESSIONAL ADVICE — Nothing here constitutes legal, engineering, electrical, plumbing, structural, or code-compliance advice. Verify against local codes and manufacturer specs.\n\n3. SAFETY — Field work involves inherent risk. Follow lockout/tagout, wear PPE, disengage from tasks beyond your training or licensure.\n\n4. AI LIMITATIONS — AI vision can misidentify components and produce incorrect BOM suggestions. Verify on-site with proper test instruments.\n\n5. SUPPLY CHAIN — Inventory indicators are estimates from mock supplier feeds. Confirm availability and pricing with your distributor.\n\n6. DATA HANDLING — Photos are transmitted to AI vision providers. Do not upload images containing confidential customer information.\n\n7. LIMITATION OF LIABILITY — To the maximum extent permitted by law, providers shall not be liable for any damages arising from use.\n\n8. INDEMNIFICATION — You indemnify the operators against claims arising from your use of AI-generated recommendations.\n\n9. ACCEPTANCE — By tapping the agreement checkbox and proceeding, you acknowledge these terms in their entirety.\n\n— END OF DISCLAIMER —`;

WebBrowser.maybeCompleteAuthSession();

export default function LoginScreen() {
  const { user, signInWithEmail, signInDev, consumeSessionId } = useAuth();
  const router = useRouter();
  const [scrolledToBottom, setScrolledToBottom] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [mode, setMode] = useState<'email' | 'username'>('email');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [loadingGoogle, setLoadingGoogle] = useState(false);
  const [loadingCreds, setLoadingCreds] = useState(false);

  // ---- hidden dev access ----
  const [devOpen, setDevOpen] = useState(false);
  const versionTapsRef = useRef({ count: 0, last: 0 });
  const logoLongPressTimer = useRef<any>(null);

  useEffect(() => {
    if (user) router.replace('/(tabs)');
  }, [user, router]);

  // OAuth redirect capture (mobile hot/cold links + web mount).
  useEffect(() => {
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined') {
        const raw = window.location.hash + '&' + window.location.search;
        handleRedirect(raw).then((consumed) => { if (consumed) cleanWebUrl(); });
      }
      return;
    }
    const sub = Linking.addEventListener('url', ({ url }) => { handleRedirect(url); });
    Linking.getInitialURL().then((u) => u && handleRedirect(u));
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const consumedRef = useRef<Set<string>>(new Set());
  const handleRedirect = useCallback(async (url: string): Promise<boolean> => {
    const m = url.match(/[#?&]session_id=([^&#]+)/);
    if (!m) return false;
    const sessionId = decodeURIComponent(m[1]);
    if (consumedRef.current.has(sessionId)) return false;
    consumedRef.current.add(sessionId);
    try {
      await consumeSessionId(sessionId);
      router.replace('/(tabs)');
      return true;
    } catch (e: any) {
      Alert.alert('Sign-in failed', e?.message || 'Could not validate session');
      return false;
    }
  }, [consumeSessionId, router]);

  const cleanWebUrl = () => {
    if (typeof window === 'undefined') return;
    try {
      const stripFromHash = window.location.hash.replace(/([#&])session_id=[^&]*&?/g, '$1').replace(/[#&]$/, '');
      const stripFromSearch = window.location.search.replace(/([?&])session_id=[^&]*&?/g, '$1').replace(/[?&]$/, '');
      window.history.replaceState(window.history.state, '', window.location.pathname + (stripFromSearch === '?' ? '' : stripFromSearch) + (stripFromHash === '#' ? '' : stripFromHash));
    } catch {}
  };

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
    if (contentOffset.y + layoutMeasurement.height >= contentSize.height - 20) {
      if (!scrolledToBottom) setScrolledToBottom(true);
    }
  };

  const onGoogleSignIn = async () => {
    if (!agreed) return;
    setLoadingGoogle(true);
    try {
      if (Platform.OS === 'web') {
        const redirectUrl = window.location.origin + '/';
        window.location.href = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
        return;
      }
      const redirectUrl = Linking.createURL('');
      const authUrl = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
      const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl, {
        preferEphemeralSession: true, showInRecents: false,
      });
      if (result.type === 'success' && result.url) await handleRedirect(result.url);
    } catch (e: any) {
      Alert.alert('Sign-in error', e?.message || 'OAuth failed');
    } finally {
      setLoadingGoogle(false);
    }
  };

  const onCredsSignIn = async () => {
    if (!agreed) return;
    if (!identifier.trim() || !password) {
      Alert.alert('Missing info', mode === 'email' ? 'Enter your email and password.' : 'Enter your username and password.');
      return;
    }
    setLoadingCreds(true);
    try {
      await signInWithEmail(identifier.trim(), password);
      router.replace('/(tabs)');
    } catch (e: any) {
      const msg = e?.message || 'Sign-in failed';
      if (e?.status === 403 && /verify/i.test(msg)) {
        Alert.alert(
          'Email not verified',
          'Check your inbox for the verification link. Need a new one?',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Resend', onPress: () => router.push({ pathname: '/verify-email', params: { email: identifier.trim(), resend: '1' } }) },
          ],
        );
      } else {
        Alert.alert('Sign-in failed', msg);
      }
    } finally {
      setLoadingCreds(false);
    }
  };

  // Hidden dev access — tap version 7 times within 3s, or long-press logo 3s.
  const onVersionTap = () => {
    const now = Date.now();
    const { count, last } = versionTapsRef.current;
    if (now - last > 3000) {
      versionTapsRef.current = { count: 1, last: now };
      return;
    }
    const next = count + 1;
    versionTapsRef.current = { count: next, last: now };
    if (next >= 7) {
      versionTapsRef.current = { count: 0, last: 0 };
      setDevOpen(true);
    }
  };

  const onLogoPressIn = () => {
    logoLongPressTimer.current = setTimeout(() => setDevOpen(true), 3000);
  };
  const onLogoPressOut = () => {
    if (logoLongPressTimer.current) clearTimeout(logoLongPressTimer.current);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ paddingBottom: space.xl }} keyboardShouldPersistTaps="handled">
          <Pressable
            onPressIn={onLogoPressIn}
            onPressOut={onLogoPressOut}
            testID="login-brand-logo"
            style={styles.header}
            accessible
            accessibilityLabel="Handy-Andy"
          >
            <View style={styles.brandRow}>
              <Hammer size={36} color={colors.primary} strokeWidth={2.5} />
              <View>
                <Text style={styles.brand}>HANDY-ANDY</Text>
                <Text style={styles.tag}>JOB SITE ASSISTANT</Text>
              </View>
            </View>
            <View style={styles.barRow}>
              <View style={[styles.stripe, { backgroundColor: colors.primary }]} />
              <View style={[styles.stripe, { backgroundColor: '#0a0a0a' }]} />
              <View style={[styles.stripe, { backgroundColor: colors.primary }]} />
              <View style={[styles.stripe, { backgroundColor: '#0a0a0a' }]} />
            </View>
          </Pressable>

          <View style={styles.disclaimerCard}>
            <View style={styles.disclaimerHead}>
              <ShieldCheck size={16} color={colors.primary} />
              <Text style={styles.disclaimerTitle}>SERVICES DISCLAIMER</Text>
              {!scrolledToBottom && (
                <View style={styles.scrollHint}>
                  <Text style={styles.scrollHintText}>SCROLL TO END</Text>
                  <ChevronDown size={12} color={colors.primary} />
                </View>
              )}
            </View>
            <ScrollView
              testID="disclaimer-scroll"
              style={styles.disclaimerScroll}
              nestedScrollEnabled
              onScroll={onScroll}
              scrollEventThrottle={80}
              showsVerticalScrollIndicator
            >
              <Text style={styles.disclaimerText}>{DISCLAIMER}</Text>
            </ScrollView>
          </View>

          <Pressable
            testID="login-agree-checkbox"
            disabled={!scrolledToBottom}
            onPress={() => setAgreed((a) => !a)}
            style={[styles.agreeRow, !scrolledToBottom && { opacity: 0.45 }]}
            accessibilityRole="checkbox"
            accessibilityLabel="I agree to the Professional Services Disclaimer"
            accessibilityState={{ checked: agreed, disabled: !scrolledToBottom }}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <View style={[styles.checkbox, agreed && { backgroundColor: colors.primary, borderColor: colors.primary }]}>
              {agreed && <Check size={16} color="#0a0a0a" strokeWidth={3.5} />}
            </View>
            <Text style={styles.agreeText}>I have read and agree to the disclaimer above.</Text>
          </Pressable>

          <View style={styles.actions}>
            <FadeInView from={{ opacity: 0, translateY: 12 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: 350 }}>
              <Button
                testID="login-google-btn"
                label={loadingGoogle ? 'CONNECTING…' : 'CONTINUE WITH GOOGLE'}
                variant="primary"
                disabled={!agreed || loadingGoogle}
                loading={loadingGoogle}
                onPress={onGoogleSignIn}
                fullWidth
              />
            </FadeInView>

            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>OR</Text>
              <View style={styles.dividerLine} />
            </View>

            <View style={styles.tabsRow}>
              <Pressable
                testID="login-tab-email"
                onPress={() => setMode('email')}
                style={[styles.tab, mode === 'email' && styles.tabActive]}
                accessibilityRole="tab"
                accessibilityState={{ selected: mode === 'email' }}
              >
                <Mail size={14} color={mode === 'email' ? colors.primary : colors.textTertiary} />
                <Text style={[styles.tabText, mode === 'email' && styles.tabTextActive]}>EMAIL</Text>
              </Pressable>
              <Pressable
                testID="login-tab-username"
                onPress={() => setMode('username')}
                style={[styles.tab, mode === 'username' && styles.tabActive]}
                accessibilityRole="tab"
                accessibilityState={{ selected: mode === 'username' }}
              >
                <UserIcon size={14} color={mode === 'username' ? colors.primary : colors.textTertiary} />
                <Text style={[styles.tabText, mode === 'username' && styles.tabTextActive]}>USERNAME</Text>
              </Pressable>
            </View>

            <TextInput
              testID="login-identifier-input"
              value={identifier}
              onChangeText={setIdentifier}
              placeholder={mode === 'email' ? 'you@example.com' : 'yourhandle'}
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType={mode === 'email' ? 'email-address' : 'default'}
              style={styles.input}
              editable={agreed && !loadingCreds}
            />
            <TextInput
              testID="login-password-input"
              value={password}
              onChangeText={setPassword}
              placeholder="Password"
              placeholderTextColor={colors.textTertiary}
              secureTextEntry
              autoCapitalize="none"
              style={styles.input}
              editable={agreed && !loadingCreds}
            />
            <Button
              testID="login-signin-btn"
              label={loadingCreds ? 'SIGNING IN…' : 'SIGN IN'}
              variant="primary"
              disabled={!agreed || loadingCreds}
              loading={loadingCreds}
              onPress={onCredsSignIn}
              fullWidth
            />

            <View style={styles.linkRow}>
              <Pressable testID="login-forgot-link" hitSlop={12} onPress={() => router.push('/forgot-password')}>
                <Text style={styles.link}>Forgot password?</Text>
              </Pressable>
              <Pressable testID="login-signup-link" hitSlop={12} onPress={() => router.push('/signup')}>
                <Text style={[styles.link, styles.linkStrong]}>Create account</Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.versionRow}>
            <Pressable
              testID="login-version"
              onPress={onVersionTap}
              hitSlop={12}
              accessible={false}
            >
              <Text style={styles.versionText}>v{APP_VERSION}</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <DevAccessModal
        visible={devOpen}
        onDismiss={() => setDevOpen(false)}
        onSuccess={async (email, secret) => {
          try {
            await signInDev(email, secret, email.split('@')[0]);
            setDevOpen(false);
            router.replace('/(tabs)');
          } catch (e: any) {
            Alert.alert('Dev login failed', e?.message || 'Invalid secret');
          }
        }}
      />
    </SafeAreaView>
  );
}

// ============================================================
// Hidden Dev Access Modal
// ============================================================
function DevAccessModal({
  visible, onDismiss, onSuccess,
}: { visible: boolean; onDismiss: () => void; onSuccess: (email: string, secret: string) => Promise<void> }) {
  const [email, setEmail] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onDismiss}>
      <View style={devStyles.scrim}>
        <View style={devStyles.card}>
          <View style={devStyles.head}>
            <Text style={devStyles.title}>DEVELOPER ACCESS</Text>
            <Pressable onPress={onDismiss} hitSlop={12} accessibilityLabel="Close">
              <X size={18} color={colors.textSecondary} />
            </Pressable>
          </View>
          <Text style={devStyles.hint}>
            Restricted. This bypass exists only for engineering diagnostics.
          </Text>
          <TextInput
            testID="dev-email-input"
            value={email}
            onChangeText={setEmail}
            placeholder="dev@handyandy.dev"
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="none"
            keyboardType="email-address"
            style={devStyles.input}
          />
          <TextInput
            testID="dev-secret-input"
            value={secret}
            onChangeText={setSecret}
            placeholder="Shared secret"
            placeholderTextColor={colors.textTertiary}
            secureTextEntry
            autoCapitalize="none"
            style={devStyles.input}
          />
          <Button
            testID="dev-submit-btn"
            label={busy ? 'AUTHENTICATING…' : 'ENTER'}
            variant="primary"
            disabled={busy || !email || !secret}
            loading={busy}
            onPress={async () => {
              setBusy(true);
              try { await onSuccess(email.trim(), secret.trim()); } finally { setBusy(false); }
            }}
            fullWidth
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  brand: { color: colors.primary, fontSize: 28, fontWeight: '900', letterSpacing: 4 },
  tag: { color: colors.textSecondary, fontSize: 10, fontWeight: '700', letterSpacing: 2 },
  barRow: { flexDirection: 'row', marginTop: space.md, gap: 2 },
  stripe: { flex: 1, height: 4, borderRadius: 1 },
  disclaimerCard: {
    margin: space.lg, marginBottom: space.md, borderWidth: 2,
    borderColor: colors.borderStrong, borderRadius: radius.md,
    backgroundColor: colors.surface, height: 200, overflow: 'hidden',
  },
  disclaimerHead: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    paddingHorizontal: space.md, paddingVertical: space.sm,
    borderBottomWidth: 1, borderBottomColor: colors.borderStrong,
    backgroundColor: colors.surfaceElevated,
  },
  disclaimerTitle: { color: colors.textPrimary, fontSize: 12, fontWeight: '900', letterSpacing: 1.5, flex: 1 },
  scrollHint: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  scrollHintText: { color: colors.primary, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  disclaimerScroll: { padding: space.md },
  disclaimerText: { color: colors.textSecondary, fontSize: 13, lineHeight: 20 },
  agreeRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: space.lg, paddingVertical: space.sm, gap: space.md,
  },
  checkbox: {
    width: 26, height: 26, borderWidth: 2, borderColor: colors.borderStrong,
    borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center',
  },
  agreeText: { color: colors.textPrimary, fontSize: 13, flex: 1, fontWeight: '600' },
  actions: { paddingHorizontal: space.lg, gap: space.md },
  divider: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.xs },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: { color: colors.textTertiary, fontSize: 10, fontWeight: '900', letterSpacing: 1.5 },
  tabsRow: {
    flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, padding: 4, gap: 4,
  },
  tab: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 10, borderRadius: radius.sm,
  },
  tabActive: { backgroundColor: colors.primaryMuted },
  tabText: { color: colors.textTertiary, fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  tabTextActive: { color: colors.primary },
  input: {
    backgroundColor: colors.background, borderWidth: 2, borderColor: colors.borderStrong,
    borderRadius: radius.sm, padding: space.md, color: colors.textPrimary, fontSize: 14,
  },
  linkRow: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: space.xs },
  link: { color: colors.textSecondary, fontSize: 13, fontWeight: '700' },
  linkStrong: { color: colors.primary },
  versionRow: { alignItems: 'center', paddingTop: space.lg, paddingBottom: space.sm },
  versionText: { color: colors.textTertiary, fontSize: 11, letterSpacing: 1, fontWeight: '600' },
});

const devStyles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', padding: space.lg },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.md, padding: space.lg,
    borderWidth: 2, borderColor: colors.primary, gap: space.md,
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: colors.primary, fontSize: 14, fontWeight: '900', letterSpacing: 2 },
  hint: { color: colors.textSecondary, fontSize: 12 },
  input: {
    backgroundColor: colors.background, borderWidth: 2, borderColor: colors.borderStrong,
    borderRadius: radius.sm, padding: space.md, color: colors.textPrimary, fontSize: 14,
  },
});
