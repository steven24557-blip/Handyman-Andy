import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { Camera, MapPin, AlertOctagon, ShieldCheck, ShieldAlert, Shield } from 'lucide-react-native';
import FadeInView from '@/src/components/FadeInView';
import Button from '@/src/components/Button';
import { api } from '@/src/lib/api';
import { useMascot } from '@/src/lib/mascot';
import { colors, radius, space, text } from '@/src/lib/theme';

type Eval = {
  hazards?: { name: string; severity: string; mitigation: string }[];
  osha_flags?: string[];
  overall_rating?: string;
  recommendation?: string;
} | null;

const RATING_META: Record<string, { color: string; Icon: any; label: string }> = {
  safe: { color: colors.success, Icon: ShieldCheck, label: 'SITE SAFE' },
  caution: { color: colors.primary, Icon: ShieldAlert, label: 'PROCEED WITH CAUTION' },
  unsafe: { color: colors.danger, Icon: AlertOctagon, label: 'STOP — UNSAFE' },
};

export default function SafetyScreen() {
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [imgUri, setImgUri] = useState<string | null>(null);
  const [imgB64, setImgB64] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Eval>(null);
  const { showTip } = useMascot();

  const pickImage = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission required', 'Allow photo library access.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.6,
      base64: true,
    });
    if (res.canceled || !res.assets?.length) return;
    const a = res.assets[0];
    setImgUri(a.uri);
    setImgB64(a.base64 || (await FileSystem.readAsStringAsync(a.uri, { encoding: 'base64' as any })));
    setResult(null);
  };

  const runEval = async () => {
    setLoading(true);
    try {
      const res = await api.safety({
        image_base64: imgB64 || undefined,
        location: location || undefined,
        notes: notes || undefined,
      });
      setResult(res);
      // Andy tip: no photo attached OR result is thin → suggest a re-shoot.
      // The safety endpoint returns a text-only recommendation when there is
      // no image; if hazards list is empty AND no recommendation, we treat
      // that as low-confidence.
      const thinResult =
        !imgB64 ||
        (!res?.hazards?.length && !res?.osha_flags?.length && (res?.recommendation || '').length < 20);
      if (thinResult) {
        showTip({
          context: 'safety_low_confidence',
          title: 'HARD TO CALL',
          body: !imgB64
            ? 'For a real evaluation, attach a photo of the site. A quick pic goes a long way.'
            : 'That shot was too tight or too dark for me to spot hazards. Try a wider frame with better light.',
        });
      }
    } catch (e: any) {
      Alert.alert('Evaluation failed', e?.message || 'Try again');
      showTip({
        context: 'safety_failed',
        title: 'HICCUP',
        body: "The safety eval didn't go through. Check your signal and try again — I'll be right here.",
      });
    } finally {
      setLoading(false);
    }
  };

  const meta = RATING_META[(result?.overall_rating || 'caution').toLowerCase()] || RATING_META.caution;
  const RatingIcon = meta.Icon;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.header}>
            <Shield size={24} color={colors.primary} />
            <View>
              <Text style={styles.h1}>SAFETY & COMPLIANCE</Text>
              <Text style={styles.tag}>Automated hazard evaluation</Text>
            </View>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>SITE LOCATION</Text>
            <View style={styles.inputRow}>
              <MapPin size={14} color={colors.textTertiary} />
              <TextInput
                testID="safety-location-input"
                value={location}
                onChangeText={setLocation}
                placeholder="e.g. 412 Oakwood Ave, Unit 3B"
                placeholderTextColor={colors.textTertiary}
                style={styles.input}
              />
            </View>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>TECH NOTES</Text>
            <TextInput
              testID="safety-notes-input"
              value={notes}
              onChangeText={setNotes}
              placeholder="What conditions are you seeing on-site?"
              placeholderTextColor={colors.textTertiary}
              multiline
              style={[styles.input, styles.inputMultiline]}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>VISUAL FEED (OPTIONAL)</Text>
            {imgUri ? (
              <Image source={{ uri: imgUri }} style={styles.preview} />
            ) : null}
            <Button
              testID="safety-pick-img-btn"
              label={imgUri ? 'REPLACE PHOTO' : 'ATTACH SITE PHOTO'}
              variant="outline"
              icon={<Camera size={16} color={colors.textPrimary} />}
              onPress={pickImage}
              fullWidth
            />
          </View>

          <Button
            testID="safety-evaluate-btn"
            label={loading ? 'EVALUATING…' : 'EVALUATE HAZARDS'}
            onPress={runEval}
            loading={loading}
            fullWidth
          />

          {result && (
            <FadeInView
              from={{ opacity: 0, translateY: 12 }}
              animate={{ opacity: 1, translateY: 0 }}
              transition={{ type: 'timing', duration: 320 }}
              style={styles.resultCard}
            >
              <View style={[styles.ratingPill, { borderColor: meta.color }]}>
                <RatingIcon size={16} color={meta.color} />
                <Text style={[styles.ratingText, { color: meta.color }]}>{meta.label}</Text>
              </View>

              <Text style={styles.sectionLabel}>RECOMMENDATION</Text>
              <Text style={styles.body}>{result.recommendation || '—'}</Text>

              {!!result.hazards?.length && (
                <>
                  <Text style={styles.sectionLabel}>HAZARDS DETECTED</Text>
                  {result.hazards.map((h, i) => (
                    <View key={i} style={styles.hazardRow}>
                      <View style={styles.hazardBullet} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.hazardName}>
                          {h.name}
                          {h.severity ? <Text style={styles.hazardSev}> · {h.severity.toUpperCase()}</Text> : null}
                        </Text>
                        {!!h.mitigation && <Text style={styles.hazardMit}>{h.mitigation}</Text>}
                      </View>
                    </View>
                  ))}
                </>
              )}

              {!!result.osha_flags?.length && (
                <>
                  <Text style={styles.sectionLabel}>OSHA FLAGS</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
                    {result.osha_flags.map((f, i) => (
                      <View key={i} style={styles.flagChip}>
                        <Text style={styles.flagChipText}>{f}</Text>
                      </View>
                    ))}
                  </View>
                </>
              )}
            </FadeInView>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.sm },
  h1: { color: colors.textPrimary, fontSize: 18, fontWeight: '900', letterSpacing: 1.5 },
  tag: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  field: { gap: space.xs },
  label: { color: colors.primary, fontSize: 11, fontWeight: '900', letterSpacing: 1.2 },
  inputRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 2,
    borderColor: colors.borderStrong, paddingHorizontal: space.md,
  },
  input: {
    flex: 1, paddingVertical: space.md, color: colors.textPrimary, fontSize: 14,
  },
  inputMultiline: {
    backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 2,
    borderColor: colors.borderStrong, paddingHorizontal: space.md, paddingVertical: space.md,
    minHeight: 90, textAlignVertical: 'top',
  },
  preview: { width: '100%', aspectRatio: 16 / 10, borderRadius: radius.md, backgroundColor: colors.surface, marginBottom: 6 },
  resultCard: {
    marginTop: space.md, padding: space.md, borderRadius: radius.md,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderStrong, gap: space.sm,
  },
  ratingPill: {
    alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: space.sm,
    paddingHorizontal: space.md, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1.5,
  },
  ratingText: { fontWeight: '900', letterSpacing: 1, fontSize: 12 },
  sectionLabel: { color: colors.primary, fontSize: 11, fontWeight: '900', letterSpacing: 1.2, marginTop: space.sm },
  body: { ...(text.body as any) },
  hazardRow: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start', paddingVertical: 4 },
  hazardBullet: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.danger, marginTop: 8 },
  hazardName: { color: colors.textPrimary, fontWeight: '800', fontSize: 13 },
  hazardSev: { color: colors.danger, fontWeight: '900' },
  hazardMit: { color: colors.textSecondary, fontSize: 13, marginTop: 2, lineHeight: 18 },
  flagChip: {
    paddingHorizontal: space.md, paddingVertical: 4, borderRadius: radius.sm,
    backgroundColor: 'rgba(239,68,68,0.12)', borderWidth: 1, borderColor: colors.danger,
  },
  flagChipText: { color: colors.danger, fontSize: 11, fontWeight: '900', letterSpacing: 0.6 },
});
