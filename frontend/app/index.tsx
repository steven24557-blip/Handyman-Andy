import React, { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@/src/lib/auth';
import { colors } from '@/src/lib/theme';

export default function Index() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (user) router.replace('/(tabs)');
    else router.replace('/login');
  }, [user, loading, router]);

  return (
    <View testID="splash-screen" style={styles.container}>
      <Text style={styles.brand}>ANDY</Text>
      <Text style={styles.tag}>JOB SITE ASSISTANT</Text>
      <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brand: {
    color: colors.primary,
    fontSize: 64,
    fontWeight: '900',
    letterSpacing: 4,
  },
  tag: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 3,
    marginTop: 8,
  },
});
