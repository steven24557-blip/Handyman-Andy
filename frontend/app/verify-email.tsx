import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { CheckCircle2, Mail, XCircle } from 'lucide-react-native';
import Button from '@/src/components/Button';
import { useAuth } from '@/src/lib/auth';
import { api } from '@/src/lib/api';
import { colors, radius, space } from '@/src/lib/theme';

type Phase = 'verifying' | 'success' | 'failed' | 'resend';

export default function VerifyEmailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string; email?: string; resend?: string }>();
  const { installSession } = useAuth();
  const [phase, setPhase] = useState<Phase>(params.resend === '1' ? 'resend' : (params.token ? 'verifying' : 'resend'));
  const [errorMsg, setErrorMsg] = useState('');
  const [email, setEmail] = useState((params.email as string) || '');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Grab token from window on web if params missed it (deep link).
    let token = (params.token as string) || '';
    if (!token && Platform.OS === 'web' && typeof window !== 'undefined') {
      const m = window.location.search.match(/[?&]token=([^&]+)/);
      if (m) token = decodeURIComponent(m[1]);
    }
    if (!token) { return; }
    (async () => {
      try {
        const r = await api.verifyEmail(token);
        await installSession({ session_token: r.session_token, user: r.user });
        setPhase('success');
        setTimeout(() => router.replace('/(tabs)'), 1400);
      } catch (e: any) {
        setErrorMsg(e?.message || 'Verification failed');
        setPhase('failed');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onResend = async () => {
    if (!email.trim()) { Alert.alert('Missing', 'Enter your email.'); return; }
    setBusy(true);
    try {
      await api.resendVerification(email.trim());
      Alert.alert('Sent', 'If that account exists, a new link is on the way.');
    } catch (e: any) {
      Alert.alert('Try again', e?.message || 'Rate limit reached');
    } finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.centered}>
        {phase === 'verifying' && (
          <View style={styles.card}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.h1}>VERIFYING…</Text>
            <Text style={styles.body}>Confirming your link with Handy-Andy.</Text>
          </View>
        )}
        {phase === 'success' && (
          <View style={styles.card}>
            <CheckCircle2 size={64} color={colors.success} strokeWidth={2.5} />
            <Text style={styles.h1}>YOU ARE IN</Text>
            <Text style={styles.body}>Your email is verified. Loading your dashboard…</Text>
          </View>
        )}
        {phase === 'failed' && (
          <View style={styles.card}>
            <XCircle size={64} color={colors.danger} strokeWidth={2.5} />
            <Text style={styles.h1}>LINK EXPIRED</Text>
            <Text style={styles.body}>{errorMsg}</Text>
            <Text style={styles.body}>Get a new verification link:</Text>
            <TextInput
              testID="verify-email-input"
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="none"
              keyboardType="email-address"
              style={styles.input}
            />
            <Button
              testID="verify-resend-btn"
              label={busy ? 'SENDING…' : 'SEND NEW LINK'}
              variant="primary"
              loading={busy}
              disabled={busy || !email.trim()}
              onPress={onResend}
              fullWidth
            />
            <Button
              testID="verify-back-btn"
              label="BACK TO SIGN IN"
              variant="ghost"
              onPress={() => router.replace('/login')}
              fullWidth
            />
          </View>
        )}
        {phase === 'resend' && (
          <View style={styles.card}>
            <View style={styles.iconWrap}>
              <Mail size={44} color={colors.primary} strokeWidth={2.5} />
            </View>
            <Text style={styles.h1}>VERIFY YOUR EMAIL</Text>
            <Text style={styles.body}>
              Enter your email to resend the verification link.
            </Text>
            <TextInput
              testID="verify-email-input"
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="none"
              keyboardType="email-address"
              style={styles.input}
            />
            <Button
              testID="verify-resend-btn"
              label={busy ? 'SENDING…' : 'SEND VERIFICATION LINK'}
              variant="primary"
              loading={busy}
              disabled={busy || !email.trim()}
              onPress={onResend}
              fullWidth
            />
            <Button
              testID="verify-back-btn"
              label="BACK TO SIGN IN"
              variant="ghost"
              onPress={() => router.replace('/login')}
              fullWidth
            />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  centered: { flexGrow: 1, justifyContent: 'center', padding: space.lg },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 2,
    borderColor: colors.border, padding: space.xl, gap: space.md, alignItems: 'center',
  },
  iconWrap: {
    width: 84, height: 84, borderRadius: 42, backgroundColor: colors.primaryMuted,
    alignItems: 'center', justifyContent: 'center',
  },
  h1: { color: colors.textPrimary, fontSize: 20, fontWeight: '900', letterSpacing: 2, textAlign: 'center' },
  body: { color: colors.textSecondary, fontSize: 14, lineHeight: 21, textAlign: 'center' },
  input: {
    backgroundColor: colors.background, borderWidth: 2, borderColor: colors.borderStrong,
    borderRadius: radius.sm, padding: space.md, color: colors.textPrimary, fontSize: 14,
    width: '100%',
  },
});
