import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Plus, LogOut, Mic } from 'lucide-react-native';
import FadeInView from '@/src/components/FadeInView';
import { createAudioPlayer } from 'expo-audio';
import { useSubscription } from '@/src/lib/subscription';

import JobCard from '@/src/components/JobCard';
import { api } from '@/src/lib/api';
import { useAuth } from '@/src/lib/auth';
import { colors, radius, space } from '@/src/lib/theme';
import { storage } from '@/src/utils/storage';

const FILTERS: { key: string; label: string }[] = [
  { key: 'all', label: 'ALL' },
  { key: 'emergent', label: 'EMERGENT' },
  { key: 'in_progress', label: 'IN PROGRESS' },
  { key: 'open', label: 'OPEN' },
  { key: 'closed', label: 'CLOSED' },
];

export default function Dashboard() {
  const { user, signOut } = useAuth();
  const { showPaywall, refresh: refreshSub } = useSubscription();
  const router = useRouter();
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<string>('all');

  const fetchJobs = useCallback(async () => {
    try {
      const res = await api.listJobs();
      setJobs(res.jobs || []);
    } catch (e: any) {
      Alert.alert('Unable to load jobs', e?.message || 'Try again');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchJobs(); }, [fetchJobs]);

  // Voice greeting (one-time per device, persona-aware)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user) return;
      const greeted = await storage.getItem<boolean>('jp_voice_greeted', false);
      if (greeted) return;
      const persona = (await storage.getItem<string>('jp_voice_persona', 'standard')) || 'standard';
      const pace = (await storage.getItem<number>('jp_voice_pace', 1.0)) || 1.0;
      try {
        const res = await api.greet(persona, pace);
        if (cancelled || !res?.audio_base64) return;
        const uri = `data:audio/mp3;base64,${res.audio_base64}`;
        const player = createAudioPlayer({ uri });
        player.play();
        await storage.setItem('jp_voice_greeted', true);
      } catch {
        // soft-fail — TTS isn't critical to the dashboard
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  const filtered = useMemo(() => {
    if (filter === 'all') return jobs;
    return jobs.filter((j) => (j.status || '').toLowerCase() === filter);
  }, [jobs, filter]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: jobs.length };
    for (const j of jobs) c[j.status] = (c[j.status] || 0) + 1;
    return c;
  }, [jobs]);

  const onLogout = async () => {
    await storage.removeItem('jp_voice_greeted');
    await signOut();
    router.replace('/login');
  };

  const createDemo = async () => {
    try {
      await api.createJob({
        title: 'New Job — Untitled',
        description: 'Tap to edit details.',
        status: 'open',
      });
      fetchJobs();
    } catch (e: any) {
      if (e?.status === 402) {
        showPaywall(e.message || 'Free tier capped at 3 active jobs.');
        await refreshSub();
      } else {
        Alert.alert('Could not create job', e?.message || '');
      }
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <View>
          <Text style={styles.userHi}>FIELD TECH</Text>
          <Text style={styles.userName} numberOfLines={1}>{user?.name || 'Operator'}</Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable
            testID="dashboard-voice-btn"
            onPress={() => router.push('/job/voice-intake')}
            style={styles.iconBtn}
            accessible
            accessibilityRole="button"
            accessibilityLabel="Start voice walkthrough"
            accessibilityHint="Opens the hands-free voice intake recorder"
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Mic size={18} color={colors.primary} strokeWidth={2.6} />
          </Pressable>
          <Pressable
            testID="dashboard-new-job-btn"
            onPress={createDemo}
            style={styles.iconBtn}
            accessible
            accessibilityRole="button"
            accessibilityLabel="Create new job"
            accessibilityHint="Adds a blank job to your dashboard"
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Plus size={18} color={colors.primary} strokeWidth={3} />
          </Pressable>
          <Pressable
            testID="dashboard-logout-btn"
            onPress={onLogout}
            style={styles.iconBtn}
            accessible
            accessibilityRole="button"
            accessibilityLabel="Sign out"
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <LogOut size={18} color={colors.textSecondary} strokeWidth={2.4} />
          </Pressable>
        </View>
      </View>

      <View style={styles.filterRow}>
        {FILTERS.map((f) => {
          const active = filter === f.key;
          return (
            <Pressable
              key={f.key}
              testID={`filter-${f.key}`}
              onPress={() => setFilter(f.key)}
              style={[styles.chip, active && styles.chipActive]}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>
                {f.label} {counts[f.key] ? `· ${counts[f.key]}` : ''}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <FlatList
        testID="job-list"
        data={filtered}
        keyExtractor={(j) => j.job_id}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={() => <View style={{ height: space.md }} />}
        refreshControl={
          <RefreshControl
            tintColor={colors.primary}
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); fetchJobs(); }}
          />
        }
        renderItem={({ item, index }) => (
          <FadeInView
            from={{ opacity: 0, translateY: 18 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 320, delay: index * 60 }}
          >
            <JobCard job={item} onPress={() => router.push(`/job/${item.job_id}`)} />
          </FadeInView>
        )}
        ListEmptyComponent={
          !loading ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>NO JOBS IN QUEUE</Text>
              <Text style={styles.emptyText}>Tap + to create the first one.</Text>
            </View>
          ) : null
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  userHi: { color: colors.primary, fontSize: 11, fontWeight: '900', letterSpacing: 2 },
  userName: { color: colors.textPrimary, fontSize: 22, fontWeight: '900', letterSpacing: 0.8 },
  headerActions: { flexDirection: 'row', gap: space.sm },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.xs,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  chip: {
    paddingHorizontal: space.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.textSecondary, fontSize: 11, fontWeight: '800', letterSpacing: 0.7 },
  chipTextActive: { color: '#0a0a0a' },
  listContent: { paddingHorizontal: space.lg, paddingTop: space.xs, paddingBottom: space.xxl },
  empty: { alignItems: 'center', paddingVertical: space.xxl },
  emptyTitle: { color: colors.textSecondary, fontWeight: '900', fontSize: 14, letterSpacing: 2 },
  emptyText: { color: colors.textTertiary, marginTop: 4, fontSize: 13 },
});
