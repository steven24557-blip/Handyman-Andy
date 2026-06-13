import React from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
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
  /** Optional override; defaults to label for screen readers. */
  accessibilityLabel?: string;
  /** Spoken hint about what happens on activation. */
  accessibilityHint?: string;
};

const MIN_TAP = Platform.OS === 'android' ? 48 : 44;

export default function Button({
  label, onPress, variant = 'primary', disabled, loading, icon, testID, fullWidth,
  accessibilityLabel, accessibilityHint,
}: Props) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={isDisabled}
      accessible
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
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
          <Text
            allowFontScaling
            maxFontSizeMultiplier={2}
            style={[styles.label, LABEL_VARIANTS[variant], isDisabled && styles.disabledLabel]}
          >
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
    minHeight: MIN_TAP,
    minWidth: MIN_TAP,
    paddingHorizontal: space.lg,
    paddingVertical: 12,
    borderRadius: radius.sm,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 1,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap', justifyContent: 'center' },
  label: { fontSize: 14, fontWeight: '900', letterSpacing: 1, textTransform: 'uppercase', textAlign: 'center' },
  disabled: { backgroundColor: colors.surfaceElevated, borderColor: colors.borderStrong },
  disabledLabel: { color: colors.textTertiary },
});
