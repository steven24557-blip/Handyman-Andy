import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, space } from '../lib/theme';

type Variant = 'primary' | 'outline' | 'danger' | 'ghost';

type Props = {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  icon?: React.ReactNode;
  testID?: string;
  fullWidth?: boolean;
};

export default function Button({
  label, onPress, variant = 'primary', disabled, loading, icon, testID, fullWidth,
}: Props) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        VARIANTS[variant],
        isDisabled && styles.disabled,
        fullWidth && { alignSelf: 'stretch' },
        pressed && !isDisabled && { transform: [{ scale: 0.97 }] },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? '#000' : colors.primary} />
      ) : (
        <View style={styles.row}>
          {icon}
          <Text style={[styles.label, LABEL_VARIANTS[variant], isDisabled && styles.disabledLabel]}>
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const VARIANTS = StyleSheet.create({
  primary: { backgroundColor: colors.primary, borderColor: colors.primaryDark },
  outline: { backgroundColor: 'transparent', borderColor: colors.borderStrong },
  danger: { backgroundColor: colors.danger, borderColor: '#b91c1c' },
  ghost: { backgroundColor: 'transparent', borderColor: 'transparent' },
});

const LABEL_VARIANTS = StyleSheet.create({
  primary: { color: '#0a0a0a' },
  outline: { color: colors.textPrimary },
  danger: { color: '#fff' },
  ghost: { color: colors.primary },
});

const styles = StyleSheet.create({
  base: {
    minHeight: 50,
    paddingHorizontal: space.lg,
    borderRadius: radius.sm,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  label: { fontSize: 14, fontWeight: '900', letterSpacing: 1, textTransform: 'uppercase' },
  disabled: { backgroundColor: colors.surfaceElevated, borderColor: colors.borderStrong },
  disabledLabel: { color: colors.textTertiary },
});
