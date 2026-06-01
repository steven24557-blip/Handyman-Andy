import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import Svg, { Path } from 'react-native-svg';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import {
  ChevronLeft,
  Sparkles,
  Camera,
  ArrowLeftRight,
  Eraser,
  Pencil,
  Wrench,
  AlertOctagon,
  CheckCircle2,
  PackageCheck,
  PackageX,
} from 'lucide-react-native';
import FadeInView from '@/src/components/FadeInView';
import { runOnJS } from 'react-native-reanimated';

import Button from '@/src/components/Button';
import StatusBadge from '@/src/components/StatusBadge';
import { api } from '@/src/lib/api';
import { colors, radius, space, text } from '@/src/lib/theme';

const STATUSES = ['open', 'in_progress', 'emergent', 'closed'] as const;
const STROKES = ['#EAB308', '#ef4444', '#22c55e', '#3b82f6', '#ffffff'];

type Stroke = { color: string; d: string };

export default function JobDetails() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [job, setJob] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [savingPhoto, setSavingPhoto] = useState<'before' | 'after' | null>(null);
  const [showAfter, setShowAfter] = useState(false);
  const [annotateMode, setAnnotateMode] = useState(false);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [currentStroke, setCurrentStroke] = useState<string>('');
  const [color, setColor] = useState<string>(STROKES[0]);

  const load = useCallback(async () => {
    try {
      const res = await api.getJob(id!);
      setJob(res.job);
    } catch (e: any) {
      Alert.alert('Job not found', e?.message || '');
      router.back();
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => { load(); }, [load]);

  const photos = job?.photos || [];
  const beforePhoto = useMemo(() => photos.find((p: any) => p.label === 'before') || photos[0], [photos]);
  const afterPhoto = useMemo(() => photos.find((p: any) => p.label === 'after'), [photos]);
  const activePhoto = showAfter && afterPhoto ? afterPhoto : beforePhoto;

  const updateStatus = async (status: string) => {
    try {
      const res = await api.updateJob(id!, { status });
      setJob(res.job);
    } catch (e: any) {
      Alert.alert('Update failed', e?.message || '');
    }
  };

  const attachPhoto = async (label: 'before' | 'after') => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission required', 'Allow photo library access.'); return; }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.55,
      base64: true,
      allowsEditing: false,
    });
    if (res.canceled || !res.assets?.length) return;
    const a = res.assets[0];
    setSavingPhoto(label);
    try {
      const b64 = a.base64 || (await FileSystem.readAsStringAsync(a.uri, { encoding: 'base64' as any }));
      await api.addPhoto(id!, label, b64);
      await load();
      if (label === 'after') setShowAfter(true);
    } catch (e: any) {
      Alert.alert('Upload failed', e?.message || '');
    } finally {
      setSavingPhoto(null);
    }
  };

  const runAI = async () => {
    if (!beforePhoto?.base64) {
      Alert.alert('Add a photo first', 'AI vision needs a "Before" photo to analyse.');
      return;
    }
    setAnalyzing(true);
    try {
      const res = await api.analyzeJob(beforePhoto.base64, job.description);
      const updates: any = {
        tools_suggested: res.tools || [],
        bom: res.bom || [],
        ai_diagnostic: res.diagnostic || '',
      };
      if (res.safety_notes) updates.safety_notes = res.safety_notes;
      const out = await api.updateJob(id!, updates);
      setJob(out.job);
    } catch (e: any) {
      Alert.alert('AI failed', e?.message || 'Try again');
    } finally {
      setAnalyzing(false);
    }
  };

  // Drawing gestures (gesture-handler v2 worklets → JS state via runOnJS)
  const startStroke = useCallback((x: number, y: number) => {
    setCurrentStroke(`M ${x.toFixed(1)} ${y.toFixed(1)}`);
  }, []);
  const extendStroke = useCallback((x: number, y: number) => {
    setCurrentStroke((s) => (s ? `${s} L ${x.toFixed(1)} ${y.toFixed(1)}` : `M ${x.toFixed(1)} ${y.toFixed(1)}`));
  }, []);
  const finishStroke = useCallback((c: string) => {
    setCurrentStroke((s) => {
      if (s) setStrokes((prev) => [...prev, { color: c, d: s }]);
      return '';
    });
  }, []);

  const pan = useMemo(
    () => Gesture.Pan()
      .minDistance(0)
      .onBegin((e) => { runOnJS(startStroke)(e.x, e.y); })
      .onUpdate((e) => { runOnJS(extendStroke)(e.x, e.y); })
      .onEnd(() => { runOnJS(finishStroke)(color); }),
    [color, startStroke, extendStroke, finishStroke],
  );

  if (loading || !job) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.loadingWrap}><ActivityIndicator color={colors.primary} /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.topRow}>
          <Pressable testID="job-back-btn" onPress={() => router.back()} style={styles.iconBtn}>
            <ChevronLeft size={22} color={colors.textPrimary} />
          </Pressable>
          <StatusBadge status={job.status} />
        </View>

        <Text style={styles.title}>{job.title}</Text>
        {!!job.location && <Text style={styles.location}>{job.location}</Text>}
        {!!job.description && <Text style={styles.desc}>{job.description}</Text>}

        <View style={styles.statusRow}>
          {STATUSES.map((s) => {
            const active = s === job.status;
            return (
              <Pressable
                key={s}
                testID={`status-set-${s}`}
                onPress={() => updateStatus(s)}
                style={[styles.statusChip, active && { backgroundColor: colors.primary, borderColor: colors.primary }]}
              >
                <Text style={[styles.statusChipText, active && { color: '#0a0a0a' }]}>
                  {s.replace('_', ' ').toUpperCase()}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Photo canvas */}
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>VISUAL SHOWCASE</Text>
            {beforePhoto && afterPhoto && (
              <Pressable
                testID="toggle-before-after"
                onPress={() => setShowAfter((v) => !v)}
                style={styles.swapBtn}
              >
                <ArrowLeftRight size={14} color={colors.primary} />
                <Text style={styles.swapBtnText}>{showAfter ? 'AFTER' : 'BEFORE'}</Text>
              </Pressable>
            )}
          </View>

          <View style={styles.canvasWrap}>
            {activePhoto ? (
              <>
                <Image
                  source={{ uri: `data:image/jpeg;base64,${activePhoto.base64}` }}
                  style={styles.canvasImg}
                />
                {annotateMode ? (
                  <GestureDetector gesture={pan}>
                    <View style={StyleSheet.absoluteFill}>
                      <Svg style={StyleSheet.absoluteFill}>
                        {strokes.map((s, i) => (
                          <Path key={i} d={s.d} stroke={s.color} strokeWidth={4} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                        ))}
                        {!!currentStroke && (
                          <Path d={currentStroke} stroke={color} strokeWidth={4} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                        )}
                      </Svg>
                    </View>
                  </GestureDetector>
                ) : strokes.length > 0 ? (
                  <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
                    {strokes.map((s, i) => (
                      <Path key={i} d={s.d} stroke={s.color} strokeWidth={4} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                    ))}
                  </Svg>
                ) : null}
              </>
            ) : (
              <View style={styles.canvasEmpty}>
                <Camera size={32} color={colors.textTertiary} />
                <Text style={styles.canvasEmptyText}>No photo yet</Text>
              </View>
            )}
          </View>

          <View style={styles.toolbar}>
            <Pressable
              testID="annotate-toggle"
              onPress={() => setAnnotateMode((v) => !v)}
              style={[styles.toolBtn, annotateMode && { backgroundColor: colors.primary, borderColor: colors.primary }]}
            >
              <Pencil size={14} color={annotateMode ? '#0a0a0a' : colors.textPrimary} />
              <Text style={[styles.toolBtnText, annotateMode && { color: '#0a0a0a' }]}>
                {annotateMode ? 'DRAWING' : 'DRAW'}
              </Text>
            </Pressable>
            <Pressable
              testID="annotate-erase"
              onPress={() => setStrokes([])}
              style={styles.toolBtn}
            >
              <Eraser size={14} color={colors.textPrimary} />
              <Text style={styles.toolBtnText}>CLEAR</Text>
            </Pressable>
            <View style={styles.colorRow}>
              {STROKES.map((c) => (
                <Pressable
                  key={c}
                  testID={`color-${c}`}
                  onPress={() => setColor(c)}
                  style={[styles.colorDot, { backgroundColor: c }, color === c && styles.colorDotActive]}
                />
              ))}
            </View>
          </View>

          <View style={styles.photoBtnRow}>
            <Button
              testID="add-before-btn"
              label={savingPhoto === 'before' ? 'SAVING…' : 'ADD BEFORE'}
              variant="outline"
              icon={<Camera size={14} color={colors.textPrimary} />}
              onPress={() => attachPhoto('before')}
              loading={savingPhoto === 'before'}
            />
            <Button
              testID="add-after-btn"
              label={savingPhoto === 'after' ? 'SAVING…' : 'ADD AFTER'}
              variant="outline"
              icon={<CheckCircle2 size={14} color={colors.textPrimary} />}
              onPress={() => attachPhoto('after')}
              loading={savingPhoto === 'after'}
            />
          </View>
        </View>

        <Button
          testID="job-ai-analyze-btn"
          label={analyzing ? 'ANALYZING JOB-SITE…' : 'AI ANALYZE JOB-SITE'}
          icon={<Sparkles size={16} color="#0a0a0a" />}
          onPress={runAI}
          loading={analyzing}
          fullWidth
        />

        {!!job.ai_diagnostic && (
          <FadeInView
            from={{ opacity: 0, translateY: 8 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 300 }}
            style={styles.aiBlock}
          >
            <Text style={styles.sectionTitle}>AI DIAGNOSTIC</Text>
            <Text style={styles.aiText}>{job.ai_diagnostic}</Text>
          </FadeInView>
        )}

        {/* Safety notes */}
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <AlertOctagon size={14} color={colors.danger} />
            <Text style={styles.sectionTitle}>SAFETY NOTES</Text>
          </View>
          <TextInput
            testID="safety-notes-input"
            value={job.safety_notes}
            onChangeText={(t) => setJob({ ...job, safety_notes: t })}
            onBlur={() => api.updateJob(id!, { safety_notes: job.safety_notes }).catch(() => {})}
            placeholder="Lockout/tagout, PPE, hazards…"
            placeholderTextColor={colors.textTertiary}
            multiline
            style={styles.notesInput}
          />
        </View>

        {/* Tools */}
        {!!job.tools_suggested?.length && (
          <View style={styles.section}>
            <View style={styles.sectionHead}>
              <Wrench size={14} color={colors.primary} />
              <Text style={styles.sectionTitle}>SUGGESTED TOOLS</Text>
            </View>
            <View style={styles.chipWrap}>
              {job.tools_suggested.map((t: string, i: number) => (
                <View key={i} style={styles.toolChip}><Text style={styles.toolChipText}>{t}</Text></View>
              ))}
            </View>
          </View>
        )}

        {/* BOM */}
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <PackageCheck size={14} color={colors.primary} />
            <Text style={styles.sectionTitle}>BILL OF MATERIALS</Text>
          </View>
          {(job.bom || []).length === 0 ? (
            <Text style={styles.dim}>No materials defined yet. Run AI analyze to populate.</Text>
          ) : (
            job.bom.map((b: any, i: number) => (
              <View key={i} style={styles.bomRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.bomName}>{b.name}</Text>
                  <Text style={styles.bomMeta}>QTY {b.quantity || 1}</Text>
                </View>
                <StockPill stock={b.stock || 'In Stock'} />
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function StockPill({ stock }: { stock: string }) {
  const map: Record<string, { c: string; Icon: any }> = {
    'In Stock': { c: colors.success, Icon: PackageCheck },
    'Low Stock': { c: colors.primary, Icon: PackageCheck },
    'Out of Stock': { c: colors.danger, Icon: PackageX },
  };
  const meta = map[stock] || map['In Stock'];
  const Icon = meta.Icon;
  return (
    <View style={[styles.stockPill, { borderColor: meta.c }]}>
      <Icon size={12} color={meta.c} />
      <Text style={[styles.stockText, { color: meta.c }]}>{stock.toUpperCase()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: space.lg, paddingBottom: space.xxl, gap: space.md },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  iconBtn: {
    width: 44, height: 44, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.borderStrong,
    backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center',
  },
  title: { ...(text.h2 as any), textTransform: 'none', letterSpacing: 0.3 },
  location: { color: colors.primary, fontSize: 12, fontWeight: '800', letterSpacing: 0.5 },
  desc: { color: colors.textSecondary, fontSize: 14, lineHeight: 20 },

  statusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.xs },
  statusChip: {
    paddingHorizontal: space.md, paddingVertical: 6, borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface,
  },
  statusChipText: { color: colors.textSecondary, fontSize: 10, fontWeight: '900', letterSpacing: 0.8 },

  section: { gap: space.sm, marginTop: space.sm },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm, justifyContent: 'space-between' },
  sectionTitle: { color: colors.textPrimary, fontSize: 13, fontWeight: '900', letterSpacing: 1.5 },
  swapBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: space.sm, paddingVertical: 6, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.primary, backgroundColor: 'rgba(234,179,8,0.08)',
  },
  swapBtnText: { color: colors.primary, fontSize: 10, fontWeight: '900', letterSpacing: 1 },

  canvasWrap: {
    aspectRatio: 4 / 3, borderRadius: radius.md, overflow: 'hidden',
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderStrong,
  },
  canvasImg: { width: '100%', height: '100%', resizeMode: 'cover' },
  canvasEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.sm },
  canvasEmptyText: { color: colors.textTertiary, fontSize: 12, fontWeight: '700', letterSpacing: 1 },

  toolbar: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, alignItems: 'center', marginTop: space.xs },
  toolBtn: {
    flexDirection: 'row', gap: 6, alignItems: 'center',
    paddingHorizontal: space.md, paddingVertical: 8,
    borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  toolBtnText: { color: colors.textPrimary, fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  colorRow: { flexDirection: 'row', gap: 6, marginLeft: 'auto' },
  colorDot: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: 'transparent' },
  colorDotActive: { borderColor: '#fff' },

  photoBtnRow: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },

  aiBlock: {
    backgroundColor: 'rgba(234,179,8,0.08)', borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.primary, padding: space.md, gap: space.xs,
  },
  aiText: { color: colors.textPrimary, fontSize: 14, lineHeight: 20 },

  notesInput: {
    backgroundColor: colors.surface, borderRadius: radius.sm,
    borderWidth: 2, borderColor: colors.borderStrong,
    padding: space.md, color: colors.textPrimary, fontSize: 13, minHeight: 80, textAlignVertical: 'top',
  },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  toolChip: {
    paddingHorizontal: space.md, paddingVertical: 6, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface,
  },
  toolChipText: { color: colors.textPrimary, fontSize: 12, fontWeight: '700' },

  bomRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    padding: space.md, borderRadius: radius.md,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  bomName: { color: colors.textPrimary, fontWeight: '700', fontSize: 14 },
  bomMeta: { color: colors.textTertiary, fontSize: 11, marginTop: 2, fontWeight: '700', letterSpacing: 1 },
  stockPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: space.sm, paddingVertical: 4, borderRadius: radius.pill, borderWidth: 1.5,
  },
  stockText: { fontSize: 10, fontWeight: '900', letterSpacing: 0.6 },
  dim: { color: colors.textTertiary, fontSize: 13 },
});
