import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { CheckCircle2, ShieldCheck } from 'lucide-react-native';
import Svg, { Path } from 'react-native-svg';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import Button from '@/src/components/Button';
import { api } from '@/src/lib/api';
import { colors, radius, space, text } from '@/src/lib/theme';

export default function PublicEstimate() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const [est, setEst] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [sig, setSig] = useState<string[]>([]);
  const [current, setCurrent] = useState('');
  const [approving, setApproving] = useState(false);

  useEffect(() => {
    api.publicEstimate(jobId!).then(setEst).catch(() => setEst({ error: true })).finally(() => setLoading(false));
  }, [jobId]);

  const start = (x: number, y: number) => setCurrent(`M ${x.toFixed(1)} ${y.toFixed(1)}`);
  const ext = (x: number, y: number) => setCurrent((s) => `${s} L ${x.toFixed(1)} ${y.toFixed(1)}`);
  const end = () => setCurrent((s) => { if (s) setSig((p) => [...p, s]); return ''; });
  const pan = React.useMemo(() =>
    Gesture.Pan().minDistance(0)
      .onBegin((e) => runOnJS(start)(e.x, e.y))
      .onUpdate((e) => runOnJS(ext)(e.x, e.y))
      .onEnd(() => runOnJS(end)())
  , []);

  const approve = async () => {
    if (sig.length === 0) return;
    setApproving(true);
    try {
      const svg = sig.join(' ') + (current ? ' ' + current : '');
      await api.publicApprove(jobId!, svg);
      const fresh = await api.publicEstimate(jobId!);
      setEst(fresh);
    } finally { setApproving(false); }
  };

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>;
  if (!est || est.error) return <View style={styles.center}><Text style={styles.dim}>Estimate not available.</Text></View>;

  const approved = !!est.job.customer_approved_at;
  const wm = est.watermark;
  const header = est.header_name || 'Handy Andy';
  const photos = (est.job.photos || []).filter((p: any) => p.label !== 'annotation');

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ paddingBottom: 60 }}>
      {wm && <View style={styles.wm}><Text style={styles.wmText}>{wm}</Text></View>}
      <View style={styles.header}>
        <Text style={styles.brand}>{header}</Text>
        <Text style={styles.title}>{est.job.title}</Text>
        {!!est.job.location && <Text style={styles.loc}>{est.job.location}</Text>}
        {!!est.job.description && <Text style={styles.desc}>{est.job.description}</Text>}
      </View>

      {photos.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>WORK PHOTOS</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm, paddingHorizontal: space.lg }}>
            {photos.map((p: any) => (
              <Image key={p.id} source={{ uri: `data:image/jpeg;base64,${p.base64}` }} style={styles.photo} />
            ))}
          </ScrollView>
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>BILL OF MATERIALS · MARKUP {est.markup_percent}%</Text>
        <View style={styles.table}>
          {est.items.map((it: any, i: number) => (
            <View key={i} style={styles.tableRow}>
              <Text style={styles.tName} numberOfLines={2}>{it.name}</Text>
              <Text style={styles.tQty}>×{it.quantity}</Text>
              <Text style={styles.tPrice}>${it.line_total.toFixed(2)}</Text>
            </View>
          ))}
          <View style={[styles.tableRow, { borderTopWidth: 2, borderTopColor: colors.primary, marginTop: 4 }]}>
            <Text style={[styles.tName, { fontWeight: '900' }]}>SUBTOTAL</Text>
            <Text style={styles.tQty}></Text>
            <Text style={[styles.tPrice, { color: colors.primary, fontSize: 18 }]}>${est.subtotal.toFixed(2)}</Text>
          </View>
        </View>
      </View>

      {approved ? (
        <View style={styles.approvedCard}>
          <ShieldCheck size={32} color={colors.success} />
          <Text style={styles.approvedTitle}>APPROVED & SCHEDULED</Text>
          <Text style={styles.dim}>Signed on {new Date(est.job.customer_approved_at).toLocaleString()}</Text>
        </View>
      ) : (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>SIGN TO APPROVE</Text>
          <View style={styles.esignBox}>
            <Text style={styles.esignText}>
              ELECTRONIC RECORD & SIGNATURE DISCLOSURE — By signing below, you explicitly
              consent under the federal ESIGN Act (15 U.S.C. § 7001 et seq.) and California
              UETA (Cal. Civ. Code § 1633.1 et seq.) to conduct this transaction
              electronically and acknowledge that this digital signature constitutes a
              legally binding execution of this agreement.
            </Text>
          </View>
          <View style={styles.sigBox}>
            <GestureDetector gesture={pan}>
              <View style={{ flex: 1 }}>
                <Svg style={{ flex: 1 }}>
                  {sig.map((d, i) => (<Path key={i} d={d} stroke={colors.primary} strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round" />))}
                  {!!current && <Path d={current} stroke={colors.primary} strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round" />}
                </Svg>
                {sig.length === 0 && !current && (
                  <Text style={styles.sigHint}>Sign here with your finger</Text>
                )}
              </View>
            </GestureDetector>
          </View>
          <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.sm }}>
            <Button label="CLEAR" variant="outline" onPress={() => { setSig([]); setCurrent(''); }} />
            <View style={{ flex: 1 }}>
              <Button
                testID="public-approve-btn"
                label={approving ? 'APPROVING…' : 'APPROVE & SCHEDULE'}
                icon={<CheckCircle2 size={16} color="#0a0a0a" />}
                onPress={approve}
                loading={approving}
                disabled={sig.length === 0}
                fullWidth
              />
            </View>
          </View>
        </View>
      )}

      {wm && <View style={[styles.wm, { borderBottomWidth: 0, borderTopWidth: 1, marginTop: space.lg }]}><Text style={styles.wmText}>{wm}</Text></View>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  wm: { paddingVertical: 8, alignItems: 'center', backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  wmText: { color: colors.textTertiary, fontSize: 10, fontWeight: '900', letterSpacing: 2 },
  header: { padding: space.lg },
  brand: { color: colors.primary, fontSize: 14, fontWeight: '900', letterSpacing: 2 },
  title: { color: colors.textPrimary, fontSize: 24, fontWeight: '900', marginTop: 6 },
  loc: { color: colors.textSecondary, marginTop: 4, fontWeight: '700' },
  desc: { color: colors.textSecondary, marginTop: 8, lineHeight: 20 },
  section: { paddingHorizontal: space.lg, marginTop: space.md },
  sectionTitle: { color: colors.primary, fontSize: 11, fontWeight: '900', letterSpacing: 1.5, marginBottom: space.sm },
  photo: { width: 220, height: 160, borderRadius: radius.md, backgroundColor: colors.surface },
  table: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface, padding: space.sm, gap: 6 },
  tableRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, gap: space.sm },
  tName: { color: colors.textPrimary, flex: 1, fontSize: 13, fontWeight: '600' },
  tQty: { color: colors.textTertiary, fontSize: 12, fontWeight: '700', width: 36, textAlign: 'right' },
  tPrice: { color: colors.textPrimary, fontWeight: '900', fontSize: 14, width: 80, textAlign: 'right' },
  sigBox: { height: 160, borderRadius: radius.md, borderWidth: 2, borderColor: colors.primary, backgroundColor: 'rgba(255,255,255,0.04)' },
  esignBox: { borderWidth: 1.5, borderColor: colors.primary, backgroundColor: 'rgba(234,179,8,0.06)', borderRadius: radius.sm, padding: space.sm, marginBottom: space.sm },
  esignText: { color: colors.textPrimary, fontSize: 11, lineHeight: 16, fontWeight: '600', letterSpacing: 0.2 },
  sigHint: { position: 'absolute', alignSelf: 'center', top: '40%', color: colors.textTertiary, fontStyle: 'italic' },
  approvedCard: { alignItems: 'center', padding: space.xl, marginHorizontal: space.lg, marginTop: space.lg, borderRadius: radius.md, borderWidth: 2, borderColor: colors.success, backgroundColor: 'rgba(34,197,94,0.08)', gap: space.sm },
  approvedTitle: { color: colors.textPrimary, fontWeight: '900', fontSize: 16, letterSpacing: 1.2 },
  dim: { color: colors.textSecondary },
});
