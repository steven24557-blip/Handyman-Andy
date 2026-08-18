import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, Check, Mail } from 'lucide-react-native';
import Button from '@/src/components/Button';
import PasswordStrength, { assessPassword } from '@/src/components/PasswordStrength';
import { useAuth } from '@/src/lib/auth';
import { api } from '@/src/lib/api';
import { colors, radius, space } from '@/src/lib/theme';

type UsernameStatus = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';

export default function SignUpScreen() {
  const router = useRouter();
  const { signUpWithEmail } = useAuth();

  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [terms, setTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uStatus, setUStatus] = useState<UsernameStatus>('idle');
  const [sent, setSent] = useState(false);

  const strength = useMemo(() => assessPassword(password), [password]);

  // Debounced username availability check
  useEffect(() => {
    if (!username) { setUStatus('idle'); return; }
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) { setUStatus('invalid'); return; }
    setUStatus('checking');
    const t = setTimeout(async () => {
      try {
        const r = await api.usernameCheck(username);
        setUStatus(r.available ? 'available' : 'taken');
      } catch { setUStatus('idle'); }
    }, 400);
    return () => clearTimeout(t);
  }, [username]);

  const canSubmit =
    !!email && !!password && !!confirm && terms && strength.ok &&
    password === confirm && (uStatus === 'idle' || uStatus === 'available');

  const onSubmit = useCallback(async () => {
    if (!canSubmit) return;
    if (password !== confirm) { Alert.alert('Mismatch', 'Passwords do not match.'); return; }
    setBusy(true);
    try {
      const r = await signUpWithEmail(email.trim(), password, username.trim() || undefined, terms);
      if (r.email_verification_sent) setSent(true);
    } catch (e: any) {
      Alert.alert('Sign-up failed', e?.message || 'Please try again');
    } finally { setBusy(false); }
  }, [canSubmit, confirm, email, password, signUpWithEmail, terms, username]);

  if (sent) {
    return (
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.centered}>
          <View style={styles.checkCard}>
            <View style={styles.checkIconWrap}>
              <Mail size={44} color={colors.primary} strokeWidth={2.5} />
            </View>
            <Text style={styles.h1}>CHECK YOUR EMAIL</Text>
            <Text style={styles.bodyText}>
              We sent a verification link to{'\n'}
              <Text style={styles.emailLine}>{email.trim().toLowerCase()}</Text>.{'\n'}
              Tap it to activate your account.
            </Text>
            <Text style={styles.helper}>
              The link expires in 24 hours. Check spam or promotions folder if you do not see it.
            </Text>
            <Button
              testID="signup-resend-btn"
              label="RESEND EMAIL"
              variant="outline"
              onPress={async () => {
                try { await api.resendVerification(email.trim()); Alert.alert('Sent', 'A new verification email is on the way.'); }
                catch { /* silent */ }
              }}
              fullWidth
            />
            <Button
              testID="signup-back-to-login-btn"
              label="BACK TO SIGN IN"
              variant="ghost"
              onPress={() => router.replace('/login')}
              fullWidth
            />
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }} keyboardShouldPersistTaps="handled">
          <Pressable
            testID="signup-back-btn"
            onPress={() => router.back()}
            hitSlop={12}
            style={styles.backRow}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <ArrowLeft size={18} color={colors.textSecondary} />
            <Text style={styles.backText}>BACK</Text>
          </Pressable>

          <Text style={styles.title}>CREATE ACCOUNT</Text>
          <Text style={styles.subtitle}>
            Get 14 days of Handy-Andy Pro on the house. No credit card required.
          </Text>

          <View style={styles.field}>
            <Text style={styles.label}>EMAIL</Text>
            <TextInput
              testID="signup-email-input"
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              style={styles.input}
              editable={!busy}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>USERNAME (optional)</Text>
            <TextInput
              testID="signup-username-input"
              value={username}
              onChangeText={setUsername}
              placeholder="yourhandle"
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
              editable={!busy}
            />
            <UsernameHint status={uStatus} value={username} />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>PASSWORD</Text>
            <TextInput
              testID="signup-password-input"
              value={password}
              onChangeText={setPassword}
              placeholder="At least 8 characters"
              placeholderTextColor={colors.textTertiary}
              secureTextEntry
              autoCapitalize="none"
              style={styles.input}
              editable={!busy}
            />
            <PasswordStrength testID="signup-password-strength" password={password} />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>CONFIRM PASSWORD</Text>
            <TextInput
              testID="signup-confirm-input"
              value={confirm}
              onChangeText={setConfirm}
              placeholder="Retype your password"
              placeholderTextColor={colors.textTertiary}
              secureTextEntry
              autoCapitalize="none"
              style={[styles.input, confirm && password !== confirm && { borderColor: colors.danger }]}
              editable={!busy}
            />
            {confirm && password !== confirm ? (
              <Text style={styles.errText}>Passwords do not match</Text>
            ) : null}
          </View>

          <Pressable
            testID="signup-terms-checkbox"
            onPress={() => setTerms((v) => !v)}
            style={styles.termsRow}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: terms }}
            hitSlop={12}
          >
            <View style={[styles.checkbox, terms && { backgroundColor: colors.primary, borderColor: colors.primary }]}>
              {terms && <Check size={14} color="#0a0a0a" strokeWidth={3.5} />}
            </View>
            <Text style={styles.termsText}>
              I agree to the{' '}
              <Text style={styles.link} onPress={() => router.push('/terms')}>Terms of Service</Text>
              {' '}and{' '}
              <Text style={styles.link} onPress={() => router.push('/privacy')}>Privacy Policy</Text>.
            </Text>
          </Pressable>

          <Button
            testID="signup-submit-btn"
            label={busy ? 'CREATING ACCOUNT…' : 'CREATE ACCOUNT'}
            variant="primary"
            disabled={!canSubmit || busy}
            loading={busy}
            onPress={onSubmit}
            fullWidth
          />

          <Pressable testID="signup-signin-link" hitSlop={12} onPress={() => router.replace('/login')} style={{ alignSelf: 'center', paddingTop: space.sm }}>
            <Text style={styles.altLink}>Already have an account? <Text style={{ color: colors.primary, fontWeight: '900' }}>Sign in</Text></Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function UsernameHint({ status, value }: { status: UsernameStatus; value: string }) {
  if (!value) return null;
  const map: Record<UsernameStatus, { c: string; t: string }> = {
    idle: { c: colors.textTertiary, t: '' },
    checking: { c: colors.textTertiary, t: 'Checking availability…' },
    available: { c: colors.success, t: '✓ Available' },
    taken: { c: colors.danger, t: '× Already taken' },
    invalid: { c: colors.danger, t: '3–20 characters, letters/numbers/underscore' },
  };
  const { c, t } = map[status];
  if (!t) return null;
  return <Text style={{ color: c, fontSize: 11, fontWeight: '700', marginTop: 4 }}>{t}</Text>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  centered: { flexGrow: 1, justifyContent: 'center', padding: space.lg },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: space.xs },
  backText: { color: colors.textSecondary, fontSize: 11, fontWeight: '900', letterSpacing: 1.5 },
  title: { color: colors.textPrimary, fontSize: 26, fontWeight: '900', letterSpacing: 2 },
  subtitle: { color: colors.textSecondary, fontSize: 13, lineHeight: 20 },
  field: { gap: 6 },
  label: { color: colors.textTertiary, fontSize: 11, fontWeight: '900', letterSpacing: 1.5 },
  input: {
    backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.borderStrong,
    borderRadius: radius.sm, padding: space.md, color: colors.textPrimary, fontSize: 14,
  },
  termsRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, paddingVertical: 4 },
  checkbox: {
    width: 22, height: 22, borderWidth: 2, borderColor: colors.borderStrong,
    borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', marginTop: 2,
  },
  termsText: { color: colors.textSecondary, fontSize: 12, flex: 1, lineHeight: 18 },
  link: { color: colors.primary, fontWeight: '700', textDecorationLine: 'underline' },
  errText: { color: colors.danger, fontSize: 11, fontWeight: '700' },
  altLink: { color: colors.textSecondary, fontSize: 13 },

  // "Check your email" state
  checkCard: {
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 2,
    borderColor: colors.border, padding: space.xl, gap: space.md, alignItems: 'center',
  },
  checkIconWrap: {
    width: 84, height: 84, borderRadius: 42, backgroundColor: colors.primaryMuted,
    alignItems: 'center', justifyContent: 'center',
  },
  h1: { color: colors.textPrimary, fontSize: 20, fontWeight: '900', letterSpacing: 2, textAlign: 'center' },
  bodyText: { color: colors.textSecondary, fontSize: 14, lineHeight: 21, textAlign: 'center' },
  emailLine: { color: colors.primary, fontWeight: '900' },
  helper: { color: colors.textTertiary, fontSize: 11, textAlign: 'center', lineHeight: 16, marginBottom: space.sm },
});
