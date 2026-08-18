import React, { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, KeyRound, Mail } from 'lucide-react-native';
import Button from '@/src/components/Button';
import { api } from '@/src/lib/api';
import { colors, radius, space } from '@/src/lib/theme';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const onSubmit = async () => {
    if (!email.trim()) { Alert.alert('Missing', 'Enter your email.'); return; }
    setBusy(true);
    try {
      await api.forgotPassword(email.trim());
      setSent(true);
    } catch (e: any) {
      Alert.alert('Try again', e?.message || 'Something went wrong');
    } finally { setBusy(false); }
  };

  if (sent) {
    return (
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.centered}>
          <View style={styles.card}>
            <View style={styles.iconWrap}>
              <Mail size={44} color={colors.primary} strokeWidth={2.5} />
            </View>
            <Text style={styles.h1}>CHECK YOUR EMAIL</Text>
            <Text style={styles.bodyText}>
              If an account exists for{'\n'}
              <Text style={styles.emailLine}>{email.trim().toLowerCase()}</Text>{'\n'}
              a reset link is on its way. It expires in 1 hour.
            </Text>
            <Text style={styles.helper}>
              For security, we do not reveal whether the address is registered.
            </Text>
            <Button
              testID="forgot-back-btn"
              label="BACK TO SIGN IN"
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
          <Pressable testID="forgot-back-nav" onPress={() => router.back()} style={styles.backRow} hitSlop={12}>
            <ArrowLeft size={18} color={colors.textSecondary} />
            <Text style={styles.backText}>BACK</Text>
          </Pressable>

          <View style={styles.iconWrap}>
            <KeyRound size={36} color={colors.primary} strokeWidth={2.5} />
          </View>
          <Text style={styles.title}>FORGOT PASSWORD</Text>
          <Text style={styles.subtitle}>
            Enter the email associated with your account. If it matches, we'll send you a secure link to set a new password.
          </Text>

          <View style={styles.field}>
            <Text style={styles.label}>EMAIL</Text>
            <TextInput
              testID="forgot-email-input"
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

          <Button
            testID="forgot-submit-btn"
            label={busy ? 'SENDING…' : 'SEND RESET LINK'}
            variant="primary"
            disabled={!email.trim() || busy}
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
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: space.xs },
  backText: { color: colors.textSecondary, fontSize: 11, fontWeight: '900', letterSpacing: 1.5 },
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
  card: {
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 2,
    borderColor: colors.border, padding: space.xl, gap: space.md, alignItems: 'center',
  },
  h1: { color: colors.textPrimary, fontSize: 20, fontWeight: '900', letterSpacing: 2, textAlign: 'center' },
  bodyText: { color: colors.textSecondary, fontSize: 14, lineHeight: 21, textAlign: 'center' },
  emailLine: { color: colors.primary, fontWeight: '900' },
  helper: { color: colors.textTertiary, fontSize: 11, textAlign: 'center', lineHeight: 16, marginBottom: space.sm },
});
