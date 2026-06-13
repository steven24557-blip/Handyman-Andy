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
  Percent,
  MapPin,
  Store,
  ShoppingCart,
  Plus as PlusIcon,
  X as XIcon,
  Banknote,
  PenTool,
} from 'lucide-react-native';
import FadeInView from '@/src/components/FadeInView';
import { runOnJS } from 'react-native-reanimated';
import { Modal } from 'react-native';

import Button from '@/src/components/Button';
import StatusBadge from '@/src/components/StatusBadge';
import { api } from '@/src/lib/api';
import { useSubscription } from '@/src/lib/subscription';
import { useAuth } from '@/src/lib/auth';
import { colors, radius, space, text } from '@/src/lib/theme';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';

const STATUSES = ['open', 'in_progress', 'emergent', 'closed'] as const;
const STROKES = ['#EAB308', '#ef4444', '#22c55e', '#3b82f6', '#ffffff'];
const MARKUP_PRESETS = [15, 25, 35];

type Stroke = { color: string; d: string };

export default function JobDetails() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { sub, showPaywall } = useSubscription();
  const [job, setJob] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  // markup engine state
  const [markupFlash, setMarkupFlash] = useState(false);
  const [savingMarkup, setSavingMarkup] = useState(false);
  // checkout state
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  // inventory state
  const [showInventory, setShowInventory] = useState(false);
  const [inventory, setInventory] = useState<any>(null);
  const [invBusy, setInvBusy] = useState(false);
  // change-order state
  const [showCO, setShowCO] = useState(false);
  const [coDesc, setCoDesc] = useState('');
  const [coCost, setCoCost] = useState('');
  const [coHours, setCoHours] = useState('');
  const [coPhoto, setCoPhoto] = useState<string | null>(null);
  const [coBusy, setCoBusy] = useState(false);
  const [coSigStrokes, setCoSigStrokes] = useState<string[]>([]);
  const [coSigCurrent, setCoSigCurrent] = useState('');
  const [signingCo, setSigningCo] = useState<any>(null);
  // accounting push state
  const [pushBusy, setPushBusy] = useState(false);
  const [pushResult, setPushResult] = useState<string | null>(null);
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
      if (e?.status === 402) showPaywall(e.message || 'AI quota exhausted.');
      else Alert.alert('AI failed', e?.message || 'Try again');
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

  // ------- Markup engine -------
  const markupPct = (job?.markup_percent ?? user?.global_markup_percent ?? 20) as number;
  const applyMarkup = async (pct: number) => {
    if (!sub?.is_pro) { showPaywall('Custom markups are a Pro feature.'); return; }
    setSavingMarkup(true);
    try {
      const res = await api.updateJob(id!, { markup_percent: pct });
      setJob(res.job);
      setMarkupFlash(true); setTimeout(() => setMarkupFlash(false), 700);
    } catch (e: any) {
      if (e?.status === 402) showPaywall(e.message); else Alert.alert('Failed', e?.message || '');
    } finally { setSavingMarkup(false); }
  };

  // ------- Local inventory -------
  const openInventory = async () => {
    setShowInventory(true); setInvBusy(true); setInventory(null);
    try {
      const res = await api.inventory(id!);
      setInventory(res);
    } catch (e: any) {
      Alert.alert('Inventory failed', e?.message || '');
    } finally { setInvBusy(false); }
  };

  // ------- Parts checkout (Stripe) -------
  const orderParts = async () => {
    setCheckoutBusy(true);
    try {
      const origin = process.env.EXPO_PUBLIC_BACKEND_URL || '';
      const res = await api.partsCheckout(origin, id!);
      await WebBrowser.openAuthSessionAsync(
        res.checkout_url,
        `${origin}/billing/parts-success`,
        { preferEphemeralSession: true, showInRecents: false },
      );
    } catch (e: any) {
      Alert.alert('Checkout failed', e?.message || '');
    } finally { setCheckoutBusy(false); }
  };

  // ------- Change orders -------
  const submitChangeOrder = async () => {
    if (!coDesc.trim()) { Alert.alert('Description required'); return; }
    setCoBusy(true);
    try {
      const r = await api.addChangeOrder(id!, {
        description: coDesc,
        extra_cost: parseFloat(coCost) || 0,
        labor_hours: parseFloat(coHours) || 0,
        photo_base64: coPhoto || undefined,
      });
      await load();
      setShowCO(false); setCoDesc(''); setCoCost(''); setCoHours(''); setCoPhoto(null);
      Alert.alert('Change order saved', `+$${(r.change_order.extra_cost || 0).toFixed(2)} · ${(r.change_order.labor_hours || 0)}h`);
    } catch (e: any) {
      Alert.alert('Failed', e?.message || '');
    } finally { setCoBusy(false); }
  };

  const pickCoPhoto = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.5, base64: true });
    if (!res.canceled && res.assets?.length) {
      const a = res.assets[0];
      setCoPhoto(a.base64 || null);
    }
  };

  const submitCoSignature = async () => {
    if (!signingCo) return;
    const svg = coSigStrokes.join(' ') + (coSigCurrent ? ' ' + coSigCurrent : '');
    try {
      await api.signChangeOrder(id!, signingCo.id, svg);
      await load();
      setSigningCo(null); setCoSigStrokes([]); setCoSigCurrent('');
    } catch (e: any) { Alert.alert('Sign failed', e?.message || ''); }
  };

  // ------- Push to accounting -------
  const pushAccounting = async () => {
    setPushBusy(true); setPushResult(null);
    try {
      const r = await api.accountingPush(id!);
      const targets = [r.quickbooks && 'QuickBooks', r.square && 'Square'].filter(Boolean).join(' + ');
      setPushResult(`Pushed $${r.subtotal.toFixed(2)} to ${targets || 'mock ledger'}`);
      setTimeout(() => setPushResult(null), 4000);
    } catch (e: any) {
      Alert.alert('Push failed', e?.message || '');
    } finally { setPushBusy(false); }
  };

  // change-order signature gestures
  const coSigStart = (x: number, y: number) => setCoSigCurrent(`M ${x.toFixed(1)} ${y.toFixed(1)}`);
  const coSigExt = (x: number, y: number) => setCoSigCurrent((s) => `${s} L ${x.toFixed(1)} ${y.toFixed(1)}`);
  const coSigEnd = () => setCoSigCurrent((s) => { if (s) setCoSigStrokes((p) => [...p, s]); return ''; });
  const coSigGesture = useMemo(() =>
    Gesture.Pan().minDistance(0)
      .onBegin((e) => runOnJS(coSigStart)(e.x, e.y))
      .onUpdate((e) => runOnJS(coSigExt)(e.x, e.y))
      .onEnd(() => runOnJS(coSigEnd)()),
    [],
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

        {/* Markup engine */}
        <View style={[styles.section, markupFlash && { transform: [{ scale: 1.01 }] }]}>
          <View style={styles.sectionHead}>
            <Percent size={14} color={colors.primary} />
            <Text style={styles.sectionTitle}>MATERIAL MARKUP</Text>
            <View style={[styles.mkBig, markupFlash && { borderColor: colors.primary, backgroundColor: 'rgba(234,179,8,0.16)' }]}>
              <Text style={styles.mkBigText}>+{markupPct}%</Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: space.xs }}>
            {MARKUP_PRESETS.map((p) => {
              const active = markupPct === p;
              return (
                <Pressable
                  key={p}
                  testID={`job-markup-${p}`}
                  onPress={() => applyMarkup(p)}
                  disabled={savingMarkup}
                  style={[styles.mkPreset, active && { backgroundColor: colors.primary, borderColor: colors.primary }]}
                >
                  <Text style={[styles.mkPresetText, active && { color: '#0a0a0a' }]}>+{p}%</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* BOM with client pricing */}
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <PackageCheck size={14} color={colors.primary} />
            <Text style={styles.sectionTitle}>BILL OF MATERIALS</Text>
            <Pressable testID="check-local-stock-btn" onPress={openInventory} style={styles.smallChip}>
              <Store size={12} color={colors.primary} />
              <Text style={styles.smallChipText}>CHECK STOCK</Text>
            </Pressable>
          </View>
          {(job.bom || []).length === 0 ? (
            <Text style={styles.dim}>No materials yet. Run AI analyze to populate.</Text>
          ) : (
            <>
              {job.bom.map((b: any, i: number) => {
                const unit = parseFloat(b.unit_price ?? 0) || 0;
                const qty = parseFloat(String(b.quantity || '1').replace(/[^0-9.]/g, '')) || 1;
                const client = unit * (1 + markupPct / 100);
                const line = client * qty;
                return (
                  <View key={i} style={styles.bomRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.bomName}>{b.name}</Text>
                      <Text style={styles.bomMeta}>
                        QTY {qty}{unit > 0 ? `  ·  COST $${unit.toFixed(2)} → CLIENT $${client.toFixed(2)}` : ''}
                      </Text>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 4 }}>
                      {unit > 0 && <Text style={styles.lineTotal}>${line.toFixed(2)}</Text>}
                      <StockPill stock={b.stock || 'In Stock'} />
                    </View>
                  </View>
                );
              })}
              <Button
                testID="parts-checkout-btn"
                label={checkoutBusy ? 'OPENING CHECKOUT…' : 'ORDER PARTS · STRIPE CHECKOUT'}
                icon={<ShoppingCart size={14} color="#0a0a0a" />}
                onPress={orderParts}
                loading={checkoutBusy}
                fullWidth
              />
            </>
          )}
        </View>

        {/* Scope Modification / Add-on Work */}
        <View style={[styles.section, styles.scopeCard]}>
          <View style={styles.sectionHead}>
            <PenTool size={14} color={colors.primary} />
            <Text style={styles.sectionTitle}>SCOPE MODIFICATION / ADD-ON WORK</Text>
          </View>
          {(job.change_orders || []).length > 0 && (job.change_orders || []).map((co: any) => (
            <View key={co.id} style={styles.coRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.coDesc} numberOfLines={2}>{co.description}</Text>
                <Text style={styles.coMeta}>
                  +${(co.extra_cost || 0).toFixed(2)} · {co.labor_hours || 0}h ·
                  {co.approved ? <Text style={{ color: colors.success }}> SIGNED</Text> : <Text style={{ color: colors.danger }}> AWAITING SIGN</Text>}
                </Text>
              </View>
              {!co.approved && (
                <Pressable testID={`co-sign-${co.id}`} onPress={() => setSigningCo(co)} style={styles.smallChip}>
                  <Text style={styles.smallChipText}>CLIENT SIGN</Text>
                </Pressable>
              )}
            </View>
          ))}
          <Button
            testID="add-change-order-btn"
            label="ADD SCOPE CREEP / CHANGE ORDER"
            variant="outline"
            icon={<PlusIcon size={14} color={colors.textPrimary} />}
            onPress={() => setShowCO(true)}
            fullWidth
          />
        </View>

        {/* Push to Accounting (closed jobs only) */}
        {job.status === 'closed' && (
          <View style={styles.section}>
            <Button
              testID="push-accounting-btn"
              label={pushBusy ? 'PUSHING…' : 'PUSH TO ACCOUNTING (QB + SQUARE)'}
              variant="primary"
              icon={<Banknote size={14} color="#0a0a0a" />}
              onPress={pushAccounting}
              loading={pushBusy}
              fullWidth
            />
            {pushResult && (
              <View style={styles.toast}><Text style={styles.toastText}>{pushResult}</Text></View>
            )}
          </View>
        )}

      </ScrollView>

      {/* Inventory bottom-sheet modal */}
      <Modal animationType="slide" transparent visible={showInventory} onRequestClose={() => setShowInventory(false)}>
        <View style={styles.sheetBackdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetTop}>
              <Text style={styles.sheetTitle}>NEARBY HARDWARE SUPPLIERS</Text>
              <Pressable onPress={() => setShowInventory(false)} style={{ padding: 6 }}><XIcon size={20} color={colors.textSecondary} /></Pressable>
            </View>
            <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }}>
              {invBusy && <ActivityIndicator color={colors.primary} />}
              {!invBusy && inventory?.stores?.map((s: any) => (
                <View key={s.store_id} style={styles.storeCard}>
                  <View style={styles.storeHead}>
                    <Store size={16} color={colors.primary} />
                    <Text style={styles.storeName}>{s.name}</Text>
                    <Text style={styles.storeDist}>{s.distance_miles} mi</Text>
                  </View>
                  {s.items.map((it: any, i: number) => (
                    <View key={i} style={styles.storeRow}>
                      <Text style={styles.storeItem} numberOfLines={1}>{it.name}</Text>
                      <Text style={[styles.storeStock,
                        it.stock_state === 'Out of Stock' && { color: colors.danger },
                        it.stock_state === 'Low Stock' && { color: colors.primary },
                        it.stock_state === 'In Stock' && { color: colors.success },
                      ]}>{it.availability_label}</Text>
                      {it.aisle ? (
                        <View style={styles.aisleChip}><MapPin size={10} color={colors.primary} /><Text style={styles.aisleText}>{it.aisle}</Text></View>
                      ) : (
                        <Text style={styles.dimSmall}>—</Text>
                      )}
                    </View>
                  ))}
                </View>
              ))}
              {!invBusy && !inventory?.stores?.length && <Text style={styles.dim}>No suppliers near this location.</Text>}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Change-Order create modal */}
      <Modal animationType="slide" transparent visible={showCO} onRequestClose={() => setShowCO(false)}>
        <View style={styles.sheetBackdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetTop}>
              <Text style={styles.sheetTitle}>NEW CHANGE ORDER</Text>
              <Pressable onPress={() => setShowCO(false)} style={{ padding: 6 }}><XIcon size={20} color={colors.textSecondary} /></Pressable>
            </View>
            <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.sm }}>
              <Text style={styles.labelSmall}>DESCRIPTION</Text>
              <TextInput value={coDesc} onChangeText={setCoDesc} placeholder="What changed mid-job?" placeholderTextColor={colors.textTertiary} style={styles.notesInput} multiline />
              <View style={{ flexDirection: 'row', gap: space.sm }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.labelSmall}>EXTRA COST ($)</Text>
                  <TextInput value={coCost} onChangeText={setCoCost} keyboardType="numeric" placeholder="0.00" placeholderTextColor={colors.textTertiary} style={styles.smallInput} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.labelSmall}>LABOR HRS</Text>
                  <TextInput value={coHours} onChangeText={setCoHours} keyboardType="numeric" placeholder="0" placeholderTextColor={colors.textTertiary} style={styles.smallInput} />
                </View>
              </View>
              {coPhoto && <Image source={{ uri: `data:image/jpeg;base64,${coPhoto}` }} style={styles.coPhoto} />}
              <Button testID="co-photo-btn" label={coPhoto ? 'REPLACE PHOTO (AI auto-estimates)' : 'ATTACH PHOTO (AI auto-estimates)'} variant="outline" icon={<Camera size={14} color={colors.textPrimary} />} onPress={pickCoPhoto} />
              <View style={{ height: space.sm }} />
              <Button testID="co-submit-btn" label={coBusy ? 'SAVING…' : 'SAVE CHANGE ORDER'} onPress={submitChangeOrder} loading={coBusy} fullWidth />
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Client signature for change-order */}
      <Modal animationType="slide" transparent visible={!!signingCo} onRequestClose={() => setSigningCo(null)}>
        <View style={styles.sheetBackdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetTop}>
              <Text style={styles.sheetTitle}>CLIENT INITIALS</Text>
              <Pressable onPress={() => setSigningCo(null)} style={{ padding: 6 }}><XIcon size={20} color={colors.textSecondary} /></Pressable>
            </View>
            <View style={{ padding: space.lg, gap: space.sm }}>
              <Text style={styles.dim}>{signingCo?.description}</Text>
              <Text style={styles.coMeta}>+${(signingCo?.extra_cost || 0).toFixed(2)} · {signingCo?.labor_hours || 0}h</Text>
              <View style={[styles.sigPad]}>
                <GestureDetector gesture={coSigGesture}>
                  <View style={{ flex: 1 }}>
                    <Svg style={{ flex: 1 }}>
                      {coSigStrokes.map((d, i) => (<Path key={i} d={d} stroke={colors.primary} strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round" />))}
                      {!!coSigCurrent && <Path d={coSigCurrent} stroke={colors.primary} strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round" />}
                    </Svg>
                  </View>
                </GestureDetector>
              </View>
              <View style={{ flexDirection: 'row', gap: space.sm }}>
                <Button label="CLEAR" variant="outline" onPress={() => { setCoSigStrokes([]); setCoSigCurrent(''); }} />
                <View style={{ flex: 1 }}>
                  <Button testID="co-sign-submit" label="APPROVE & APPEND" onPress={submitCoSignature} disabled={coSigStrokes.length === 0} fullWidth />
                </View>
              </View>
            </View>
          </View>
        </View>
      </Modal>
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
  dimSmall: { color: colors.textTertiary, fontSize: 11 },
  labelSmall: { color: colors.primary, fontSize: 10, fontWeight: '900', letterSpacing: 1, marginTop: 6 },
  smallInput: { backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 2, borderColor: colors.borderStrong, padding: space.sm, color: colors.textPrimary, fontSize: 14 },
  lineTotal: { color: colors.primary, fontWeight: '900', fontSize: 14 },

  mkBig: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.sm, borderWidth: 1.5, borderColor: colors.borderStrong, backgroundColor: colors.surfaceElevated, marginLeft: 'auto' },
  mkBigText: { color: colors.primary, fontWeight: '900', fontSize: 13, letterSpacing: 0.6 },
  mkPreset: { flex: 1, paddingVertical: 8, borderRadius: radius.sm, borderWidth: 2, borderColor: colors.borderStrong, backgroundColor: colors.surface, alignItems: 'center' },
  mkPresetText: { color: colors.textPrimary, fontWeight: '900', letterSpacing: 0.5 },

  smallChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: space.sm, paddingVertical: 5, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.primary, backgroundColor: 'rgba(234,179,8,0.08)', marginLeft: 'auto' },
  smallChipText: { color: colors.primary, fontSize: 10, fontWeight: '900', letterSpacing: 0.8 },

  scopeCard: { padding: space.md, borderRadius: radius.md, borderWidth: 2, borderColor: colors.primary, backgroundColor: 'rgba(234,179,8,0.04)' },
  coRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.sm, borderRadius: radius.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  coDesc: { color: colors.textPrimary, fontWeight: '700', fontSize: 13 },
  coMeta: { color: colors.textSecondary, fontSize: 11, marginTop: 2, fontWeight: '700', letterSpacing: 0.4 },
  coPhoto: { width: '100%', aspectRatio: 16 / 10, borderRadius: radius.md, backgroundColor: colors.surface, marginTop: space.sm },

  toast: { marginTop: space.sm, padding: space.sm, borderRadius: radius.sm, backgroundColor: 'rgba(34,197,94,0.12)', borderWidth: 1, borderColor: colors.success },
  toastText: { color: colors.success, fontWeight: '800', textAlign: 'center', letterSpacing: 0.5 },

  sheetBackdrop: { flex: 1, backgroundColor: colors.scrim, justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, borderTopWidth: 2, borderColor: colors.primary, maxHeight: '88%' },
  sheetTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.lg, paddingVertical: space.md, borderBottomWidth: 1, borderBottomColor: colors.borderStrong },
  sheetTitle: { color: colors.textPrimary, fontWeight: '900', letterSpacing: 1.2, fontSize: 13 },

  storeCard: { borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: space.sm, gap: 4 },
  storeHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingBottom: space.xs, borderBottomWidth: 1, borderBottomColor: colors.border },
  storeName: { color: colors.textPrimary, fontWeight: '900', fontSize: 13, letterSpacing: 0.8 },
  storeDist: { color: colors.primary, fontWeight: '900', fontSize: 12, marginLeft: 'auto' },
  storeRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 6 },
  storeItem: { color: colors.textPrimary, fontSize: 13, flex: 1.4 },
  storeStock: { fontSize: 11, fontWeight: '900', letterSpacing: 0.5, flex: 1 },
  aisleChip: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 4, borderWidth: 1, borderColor: colors.primary, backgroundColor: 'rgba(234,179,8,0.08)' },
  aisleText: { color: colors.primary, fontSize: 10, fontWeight: '900', letterSpacing: 0.5 },

  sigPad: { height: 180, borderRadius: radius.md, borderWidth: 2, borderColor: colors.primary, backgroundColor: 'rgba(255,255,255,0.04)' },
  legalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: space.md, borderRadius: radius.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  legalLabel: { color: colors.textPrimary, fontWeight: '700', fontSize: 14 },
});
