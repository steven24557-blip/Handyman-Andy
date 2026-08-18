import React, { useEffect, useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { CheckCircle2, KeyRound } from 'lucide-react-native';
import Button from '@/src/components/Button';
import PasswordStrength, { assessPassword } from '@/src/components/PasswordStrength';
import { api } from '@/src/lib/api';
import { colors, radius, space } from '@/src/lib/theme';

export default function ResetPasswordScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string }>();
  const [token, setToken] = useState((params.token as string) || '');
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  // On web, magic link may include ?token=… — pick it up here even if params misses it.
  useEffect(() => {
    if (Platform.OS === 'web' && !token && typeof window !== 'undefined') {
      const m = window.location.search.match(/[?&]token=([^&]+)/);
      if (m) setToken(decodeURIComponent(m[1]));
    }
  }, [token]);

  const strength = useMemo(() => assessPassword(pw), [pw]);
  const canSubmit = !!token && strength.ok && pw === confirm;

  const onSubmit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      await api.resetPassword(token, pw);
      setDone(true);
    } catch (e: any) {
      Alert.alert('Reset failed', e?.message || 'Link may have expired');
    } finally { setBusy(false); }
  };

  if (done) {
    return (
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.centered}>
          <View style={styles.card}>
            <CheckCircle2 size={64} color={colors.success} strokeWidth={2.5} />
            <Text style={styles.h1}>PASSWORD UPDATED</Text>
            <Text style={styles.bodyText}>Your password has been reset. Sign in with your new credentials.</Text>
            <Button
              testID="reset-goto-login-btn"
              label="SIGN IN"
              variant="primary"
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
          <View style={styles.iconWrap}><KeyRound size={36} color={colors.primary} strokeWidth={2.5} /></View>
          <Text style={styles.title}>SET NEW PASSWORD</Text>
          <Text style={styles.subtitle}>Choose a strong password. You will be signed out of all devices after reset.</Text>

          {!token ? (
            <View style={styles.field}>
              <Text style={styles.label}>RESET TOKEN</Text>
              <TextInput
                testID="reset-token-input"
                value={token}
                onChangeText={setToken}
                placeholder="Paste the token from your email"
                placeholderTextColor={colors.textTertiary}
                autoCapitalize="none"
                style={styles.input}
                editable={!busy}
              />
            </View>
          ) : null}

          <View style={styles.field}>
            <Text style={styles.label}>NEW PASSWORD</Text>
            <TextInput
              testID="reset-password-input"
              value={pw}
              onChangeText={setPw}
              placeholder="At least 8 characters"
              placeholderTextColor={colors.textTertiary}
              secureTextEntry
              autoCapitalize="none"
              style={styles.input}
              editable={!busy}
            />
            <PasswordStrength testID="reset-password-strength" password={pw} />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>CONFIRM PASSWORD</Text>
            <TextInput
              testID="reset-confirm-input"
              value={confirm}
              onChangeText={setConfirm}
              placeholder="Retype your password"
              placeholderTextColor={colors.textTertiary}
              secureTextEntry
              autoCapitalize="none"
              style={[styles.input, confirm && pw !== confirm && { borderColor: colors.danger }]}
              editable={!busy}
            />
            {confirm && pw !== confirm ? <Text style={styles.errText}>Passwords do not match</Text> : null}
          </View>

          <Button
            testID="reset-submit-btn"
            label={busy ? 'UPDATING…' : 'UPDATE PASSWORD'}
            variant="primary"
            disabled={!canSubmit || busy}
            loading={busy}
            onPress={onSubmit}
            fullWidth
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  centered: { flexGrow: 1, justifyContent: 'center', padding: space.lg },
  iconWrap: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: colors.primaryMuted,
    alignItems: 'center', justifyContent: 'center', alignSelf: 'center',
  },
  title: { color: colors.textPrimary, fontSize: 24, fontWeight: '900', letterSpacing: 2, textAlign: 'center' },
  subtitle: { color: colors.textSecondary, fontSize: 13, lineHeight: 20, textAlign: 'center' },
  field: { gap: 6 },
  label: { color: colors.textTertiary, fontSize: 11, fontWeight: '900', letterSpacing: 1.5 },
  input: {
    backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.borderStrong,
    borderRadius: radius.sm, padding: space.md, color: colors.textPrimary, fontSize: 14,
  },
  errText: { color: colors.danger, fontSize: 11, fontWeight: '700' },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 2,
    borderColor: colors.border, padding: space.xl, gap: space.md, alignItems: 'center',
  },
  h1: { color: colors.textPrimary, fontSize: 20, fontWeight: '900', letterSpacing: 2, textAlign: 'center' },
  bodyText: { color: colors.textSecondary, fontSize: 14, lineHeight: 21, textAlign: 'center' },
});
