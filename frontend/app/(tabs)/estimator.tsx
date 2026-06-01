import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Calculator, Percent, Lock, FileText, ChevronRight } from 'lucide-react-native';
import Button from '@/src/components/Button';
import { api } from '@/src/lib/api';
import { useSubscription } from '@/src/lib/subscription';
import { useAuth } from '@/src/lib/auth';
import { colors, radius, space, text } from '@/src/lib/theme';

const PRESETS = [15, 25, 35];

export default function Estimator() {
  const { user, refresh: refreshUser } = useAuth();
  const { sub, showPaywall, refresh: refreshSub } = useSubscription();
  const router = useRouter();
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [markup, setMarkup] = useState<number>(20);
  const [custom, setCustom] = useState<string>('20');
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState(false);

  const isPro = sub?.is_pro;

  const fetchJobs = useCallback(async () => {
    try {
      const r = await api.listJobs();
      setJobs(r.jobs || []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchJobs(); }, [fetchJobs]);
  useEffect(() => {
    if (user?.global_markup_percent != null) {
      setMarkup(user.global_markup_percent);
      setCustom(String(user.global_markup_percent));
    }
  }, [user]);

  const applyMarkup = async (pct: number) => {
    if (!isPro) { showPaywall('Custom markups are a Pro feature.'); return; }
    setSaving(true);
    try {
      await api.updateMarkup(pct);
      setMarkup(pct);
      setCustom(String(pct));
      setFlash(true); setTimeout(() => setFlash(false), 700);
      await refreshUser();
    } catch (e: any) {
      if (e?.status === 402) showPaywall(e.message);
      else Alert.alert('Could not save', e?.message || '');
    } finally { setSaving(false); }
  };

  const summary = useMemo(() => {
    let cost = 0, client = 0, items = 0;
    for (const j of jobs) {
      for (const b of (j.bom || [])) {
        const u = parseFloat(b.unit_price ?? 0) || 0;
        const q = parseFloat(String(b.quantity || '1').replace(/[^0-9.]/g, '')) || 1;
        cost += u * q;
        client += u * (1 + markup / 100) * q;
        items += 1;
      }
    }
    return { cost, client, items, profit: client - cost };
  }, [jobs, markup]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <Calculator size={22} color={colors.primary} />
          <View>
            <Text style={styles.h1}>ESTIMATOR</Text>
            <Text style={styles.tag}>Material markup engine · Client estimates</Text>
          </View>
        </View>

        <View style={styles.panel}>
          <View style={styles.panelHead}>
            <Percent size={14} color={colors.primary} />
            <Text style={styles.panelTitle}>GLOBAL MATERIAL MARKUP</Text>
            {!isPro && <View style={styles.lockChip}><Lock size={10} color={colors.primary} /><Text style={styles.lockChipText}>PRO</Text></View>}
          </View>
          <View style={styles.row}>
            {PRESETS.map((p) => {
              const active = markup === p;
              return (
                <Pressable
                  key={p}
                  testID={`markup-${p}`}
                  onPress={() => applyMarkup(p)}
                  disabled={saving}
                  style={[styles.preset, active && styles.presetActive]}
                >
                  <Text style={[styles.presetText, active && { color: '#0a0a0a' }]}>+{p}%</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={[styles.bigPct, flash && { borderColor: colors.primary, backgroundColor: 'rgba(234,179,8,0.12)' }]}>
            <Text style={styles.bigPctNum}>{markup}<Text style={styles.bigPctUnit}>%</Text></Text>
            <Text style={styles.bigPctLabel}>APPLIED MARKUP</Text>
          </View>

          <Button
            testID="apply-custom-markup"
            label={saving ? 'SAVING…' : `APPLY ${custom}% CUSTOM`}
            variant="outline"
            onPress={() => {
              const v = parseInt(custom, 10);
              if (!isNaN(v) && v >= 0 && v <= 200) applyMarkup(v);
            }}
            loading={saving}
            fullWidth
          />
        </View>

        <View style={styles.summaryGrid}>
          <View style={styles.kpi}>
            <Text style={styles.kpiLabel}>COST</Text>
            <Text style={styles.kpiVal}>${summary.cost.toFixed(2)}</Text>
          </View>
          <View style={[styles.kpi, { borderColor: colors.primary }]}>
            <Text style={styles.kpiLabel}>CLIENT PRICE</Text>
            <Text style={[styles.kpiVal, { color: colors.primary }]}>${summary.client.toFixed(2)}</Text>
          </View>
          <View style={styles.kpi}>
            <Text style={styles.kpiLabel}>PROFIT</Text>
            <Text style={[styles.kpiVal, { color: colors.success }]}>${summary.profit.toFixed(2)}</Text>
          </View>
          <View style={styles.kpi}>
            <Text style={styles.kpiLabel}>ITEMS</Text>
            <Text style={styles.kpiVal}>{summary.items}</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>JOBS</Text>
        {loading ? (
          <ActivityIndicator color={colors.primary} />
        ) : jobs.length === 0 ? (
          <Text style={styles.dim}>No jobs yet.</Text>
        ) : (
          jobs.map((j) => {
            const itemTotal = (j.bom || []).reduce((acc: number, b: any) => {
              const u = parseFloat(b.unit_price ?? 0) || 0;
              const q = parseFloat(String(b.quantity || '1').replace(/[^0-9.]/g, '')) || 1;
              return acc + u * (1 + markup / 100) * q;
            }, 0);
            return (
              <Pressable key={j.job_id} onPress={() => router.push(`/job/${j.job_id}`)} style={styles.jobRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.jobTitle} numberOfLines={1}>{j.title}</Text>
                  <Text style={styles.jobMeta}>{(j.bom || []).length} parts</Text>
                </View>
                <Text style={styles.jobTotal}>${itemTotal.toFixed(2)}</Text>
                <View style={styles.estimateLink}>
                  <FileText size={12} color={colors.primary} />
                  <Text style={styles.estimateLinkText}>ESTIMATE</Text>
                </View>
                <ChevronRight size={16} color={colors.textTertiary} />
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  h1: { color: colors.textPrimary, fontSize: 22, fontWeight: '900', letterSpacing: 1.5 },
  tag: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  panel: { backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md, gap: space.sm, borderWidth: 1, borderColor: colors.border },
  panelHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  panelTitle: { color: colors.textPrimary, fontSize: 12, fontWeight: '900', letterSpacing: 1.2, flex: 1 },
  lockChip: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, borderWidth: 1, borderColor: colors.primary, backgroundColor: 'rgba(234,179,8,0.08)' },
  lockChipText: { color: colors.primary, fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  row: { flexDirection: 'row', gap: space.sm },
  preset: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: radius.sm, borderWidth: 2, borderColor: colors.borderStrong, backgroundColor: colors.surfaceElevated },
  presetActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  presetText: { color: colors.textPrimary, fontSize: 14, fontWeight: '900', letterSpacing: 1 },
  bigPct: { borderRadius: radius.md, paddingVertical: space.md, alignItems: 'center', borderWidth: 2, borderColor: colors.borderStrong, backgroundColor: colors.background },
  bigPctNum: { color: colors.textPrimary, fontSize: 44, fontWeight: '900', letterSpacing: 1 },
  bigPctUnit: { fontSize: 22, color: colors.textSecondary },
  bigPctLabel: { color: colors.textTertiary, fontSize: 11, fontWeight: '900', letterSpacing: 1.5, marginTop: 4 },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  kpi: { flexBasis: '47%', flexGrow: 1, padding: space.sm, borderRadius: radius.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderStrong },
  kpiLabel: { color: colors.textTertiary, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  kpiVal: { color: colors.textPrimary, fontSize: 20, fontWeight: '900', marginTop: 4 },
  sectionTitle: { color: colors.primary, fontSize: 12, fontWeight: '900', letterSpacing: 1.5, marginTop: space.md },
  dim: { color: colors.textTertiary },
  jobRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  jobTitle: { color: colors.textPrimary, fontWeight: '800' },
  jobMeta: { color: colors.textTertiary, fontSize: 11, marginTop: 2 },
  jobTotal: { color: colors.primary, fontWeight: '900', fontSize: 14 },
  estimateLink: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  estimateLinkText: { color: colors.primary, fontSize: 10, fontWeight: '900', letterSpacing: 0.8 },
});
