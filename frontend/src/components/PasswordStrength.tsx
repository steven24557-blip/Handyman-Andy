import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, space } from '@/src/lib/theme';

export type PwStrength = { score: 0 | 1 | 2 | 3 | 4; label: string; color: string; ok: boolean; hint?: string };

export function assessPassword(pw: string): PwStrength {
  if (!pw) return { score: 0, label: '', color: colors.borderStrong, ok: false };
  let score: 0 | 1 | 2 | 3 | 4 = 0;
  if (pw.length >= 8) score = (score + 1) as any;
  if (/[A-Z]/.test(pw)) score = (score + 1) as any;
  if (/[a-z]/.test(pw)) score = (score + 1) as any;
  if (/\d/.test(pw)) score = (score + 1) as any;
  if (/[^A-Za-z0-9]/.test(pw)) score = (score + 1) as any;
  if (score > 4) score = 4;
  const map: Record<number, { label: string; color: string }> = {
    0: { label: 'TOO SHORT', color: colors.danger },
    1: { label: 'WEAK', color: colors.danger },
    2: { label: 'FAIR', color: '#f97316' },
    3: { label: 'GOOD', color: colors.primary },
    4: { label: 'STRONG', color: colors.success },
  };
  const info = map[score];
  const ok = pw.length >= 8;
  const hint = !ok
    ? 'At least 8 characters'
    : score < 3
      ? 'Add a number or symbol for a stronger password'
      : undefined;
  return { score, label: info.label, color: info.color, ok, hint };
}

type Props = { password: string; testID?: string };

export default function PasswordStrength({ password, testID }: Props) {
  const { score, label, color, hint } = useMemo(() => assessPassword(password), [password]);
  return (
    <View testID={testID} style={styles.wrap} accessibilityLiveRegion="polite">
      <View style={styles.bars}>
        {[0, 1, 2, 3].map((i) => (
          <View
            key={i}
            style={[
              styles.bar,
              { backgroundColor: i < score ? color : colors.border },
            ]}
          />
        ))}
      </View>
      <View style={styles.row}>
        {password.length > 0 ? (
          <Text style={[styles.label, { color }]}>{label}</Text>
        ) : (
          <Text style={styles.hint}>Password strength</Text>
        )}
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  bars: { flexDirection: 'row', gap: 4 },
  bar: { flex: 1, height: 4, borderRadius: radius.pill },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  hint: { color: colors.textTertiary, fontSize: 11, fontWeight: '600' },
});
