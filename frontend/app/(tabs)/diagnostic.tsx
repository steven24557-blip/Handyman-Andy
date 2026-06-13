import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import {
  Zap,
  ZapOff,
  RefreshCw,
  Camera as CameraIcon,
  Sparkles,
  ChevronLeft,
  Image as ImageIcon,
  AlertOctagon,
} from 'lucide-react-native';
import FadeInView from '@/src/components/FadeInView';
import Button from '@/src/components/Button';
import { api } from '@/src/lib/api';
import { colors, radius, space, text } from '@/src/lib/theme';

type DiagnosticResult = {
  root_cause?: string;
  severity?: string;
  steps?: string[];
  tools?: string[];
  safety_warnings?: string[];
} | null;

export default function DiagnosticScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [torchOn, setTorchOn] = useState(false);
  const [facing, setFacing] = useState<'back' | 'front'>('back');
  const [capturedB64, setCapturedB64] = useState<string | null>(null);
  const [capturedUri, setCapturedUri] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<DiagnosticResult>(null);
  const camRef = useRef<CameraView>(null);

  if (!permission) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.permWrap}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.permWrap}>
          <CameraIcon size={48} color={colors.primary} />
          <Text style={styles.permTitle}>CAMERA REQUIRED</Text>
          <Text style={styles.permText}>
            We need camera access to capture and diagnose the broken asset in front of you.
          </Text>
          <Button
            testID="diag-grant-permission-btn"
            label="GRANT CAMERA ACCESS"
            onPress={requestPermission}
            fullWidth
          />
          {!permission.canAskAgain && (
            <Text style={[styles.permText, { color: colors.danger, marginTop: 12 }]}>
              Permission permanently denied. Open device Settings to enable.
            </Text>
          )}
        </View>
      </SafeAreaView>
    );
  }

  const capture = async () => {
    try {
      const photo = await camRef.current?.takePictureAsync({
        quality: 0.6,
        skipProcessing: true,
      });
      if (!photo?.uri) return;
      const resized = await ImageManipulator.manipulateAsync(
        photo.uri,
        [{ resize: { width: 1024 } }],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true },
      );
      const b64 = resized.base64 || (await FileSystem.readAsStringAsync(resized.uri, {
        encoding: 'base64' as any,
      }));
      setCapturedB64(b64);
      setCapturedUri(resized.uri);
      setResult(null);
    } catch (e: any) {
      Alert.alert('Capture failed', e?.message || '');
    }
  };

  const pickFromLibrary = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission required', 'Please allow photo library access.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.6,
      base64: true,
    });
    if (res.canceled || !res.assets?.length) return;
    const a = res.assets[0];
    const b64 = a.base64 || (await FileSystem.readAsStringAsync(a.uri, { encoding: 'base64' as any }));
    setCapturedB64(b64);
    setCapturedUri(a.uri);
    setResult(null);
  };

  const analyze = async () => {
    if (!capturedB64) return;
    setAnalyzing(true);
    try {
      const res = await api.diagnostic(capturedB64);
      setResult(res);
    } catch (e: any) {
      if (e?.status === 402) {
        const { useSubscription } = await import('@/src/lib/subscription');
        // dynamic showPaywall handled by parent via Alert fallback for now
        Alert.alert('Out of free scans', e?.message || 'Upgrade to Pro for unlimited.');
      } else {
        Alert.alert('AI failed', e?.message || 'Try again');
      }
    } finally {
      setAnalyzing(false);
    }
  };

  // ----- Render -----
  if (capturedUri) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.previewTopRow}>
            <Pressable
              testID="diag-back-btn"
              onPress={() => { setCapturedUri(null); setCapturedB64(null); setResult(null); }}
              style={styles.iconChip}
            >
              <ChevronLeft size={20} color={colors.textPrimary} />
              <Text style={styles.iconChipLabel}>RETAKE</Text>
            </Pressable>
            <Text style={styles.previewTitle}>FIELD DIAGNOSTIC</Text>
          </View>

          <Image source={{ uri: capturedUri }} style={styles.preview} />

          {!result && (
            <Button
              testID="diag-analyze-btn"
              label={analyzing ? 'ANALYZING…' : 'RUN AI DIAGNOSIS'}
              icon={<Sparkles size={16} color="#0a0a0a" />}
              onPress={analyze}
              loading={analyzing}
              fullWidth
            />
          )}

          {result && (
            <FadeInView
              from={{ opacity: 0, translateY: 14 }}
              animate={{ opacity: 1, translateY: 0 }}
              transition={{ type: 'timing', duration: 360 }}
              style={styles.resultBlock}
            >
              <SeverityPill severity={result.severity} />
              <Text style={styles.resultLabel}>ROOT CAUSE</Text>
              <Text style={styles.resultBody}>{result.root_cause || '—'}</Text>

              {!!result.steps?.length && (
                <>
                  <Text style={styles.resultLabel}>REPAIR BLUEPRINT</Text>
                  {result.steps.map((s, i) => (
                    <View key={i} style={styles.stepRow}>
                      <View style={styles.stepNum}><Text style={styles.stepNumText}>{i + 1}</Text></View>
                      <Text style={styles.stepText}>{s}</Text>
                    </View>
                  ))}
                </>
              )}

              {!!result.tools?.length && (
                <>
                  <Text style={styles.resultLabel}>TOOLS</Text>
                  <View style={styles.chipWrap}>
                    {result.tools.map((t, i) => (
                      <View key={i} style={styles.toolChip}><Text style={styles.toolChipText}>{t}</Text></View>
                    ))}
                  </View>
                </>
              )}

              {!!result.safety_warnings?.length && (
                <>
                  <Text style={[styles.resultLabel, { color: colors.danger }]}>SAFETY</Text>
                  {result.safety_warnings.map((s, i) => (
                    <View key={i} style={styles.warnRow}>
                      <AlertOctagon size={14} color={colors.danger} />
                      <Text style={styles.warnText}>{s}</Text>
                    </View>
                  ))}
                </>
              )}
            </FadeInView>
          )}
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <CameraView
        ref={camRef}
        style={StyleSheet.absoluteFill}
        facing={facing}
        enableTorch={torchOn}
      />
      <SafeAreaView style={styles.cameraOverlay} edges={['top']}>
        <View style={styles.cameraTopRow}>
          <View style={styles.scanPill}>
            <View style={styles.scanDot} />
            <Text style={styles.scanPillText}>LIVE · DIAGNOSTIC MODE</Text>
          </View>
          <Pressable
            testID="diag-torch-btn"
            onPress={() => setTorchOn((t) => !t)}
            style={[styles.iconChip, torchOn && { backgroundColor: colors.primary }]}
            accessible
            accessibilityRole="switch"
            accessibilityLabel="Camera flashlight"
            accessibilityState={{ checked: torchOn }}
            accessibilityHint="Toggles the camera torch for dark job sites"
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            {torchOn ? <Zap size={18} color="#0a0a0a" /> : <ZapOff size={18} color={colors.textPrimary} />}
          </Pressable>
        </View>

        <View style={styles.reticle} pointerEvents="none">
          <View style={[styles.corner, styles.tl]} />
          <View style={[styles.corner, styles.tr]} />
          <View style={[styles.corner, styles.bl]} />
          <View style={[styles.corner, styles.br]} />
        </View>

        <View style={styles.cameraBottomRow}>
          <Pressable
            testID="diag-pick-btn"
            onPress={pickFromLibrary}
            style={styles.smallShutter}
            accessible
            accessibilityRole="button"
            accessibilityLabel="Pick photo from library"
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <ImageIcon size={18} color={colors.textPrimary} />
          </Pressable>
          <Pressable
            testID="diag-shutter-btn"
            onPress={capture}
            style={styles.shutter}
            accessible
            accessibilityRole="button"
            accessibilityLabel="Trigger camera scanner"
            accessibilityHint="Captures the current frame for AI diagnostic analysis"
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <View style={styles.shutterInner} />
          </Pressable>
          <Pressable
            testID="diag-flip-btn"
            onPress={() => setFacing((f) => (f === 'back' ? 'front' : 'back'))}
            style={styles.smallShutter}
            accessible
            accessibilityRole="button"
            accessibilityLabel="Flip camera"
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <RefreshCw size={18} color={colors.textPrimary} />
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}

function SeverityPill({ severity }: { severity?: string }) {
  const s = (severity || 'medium').toLowerCase();
  const map: Record<string, { c: string; label: string }> = {
    low: { c: colors.success, label: 'LOW SEVERITY' },
    medium: { c: colors.primary, label: 'MEDIUM SEVERITY' },
    high: { c: colors.danger, label: 'HIGH SEVERITY' },
  };
  const meta = map[s] || map.medium;
  return (
    <View style={[styles.sevPill, { borderColor: meta.c }]}>
      <View style={[styles.sevDot, { backgroundColor: meta.c }]} />
      <Text style={[styles.sevText, { color: meta.c }]}>{meta.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  permWrap: { flex: 1, padding: space.lg, alignItems: 'center', justifyContent: 'center', gap: space.md },
  permTitle: { color: colors.textPrimary, fontSize: 18, fontWeight: '900', letterSpacing: 2 },
  permText: { color: colors.textSecondary, textAlign: 'center', fontSize: 14, lineHeight: 20 },

  cameraOverlay: { flex: 1, justifyContent: 'space-between' },
  cameraTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingTop: space.md,
  },
  scanPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: space.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  scanDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
  scanPillText: { color: colors.primary, fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  iconChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: space.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  iconChipLabel: { color: colors.textPrimary, fontSize: 11, fontWeight: '900', letterSpacing: 1 },

  reticle: { alignSelf: 'center', width: 220, height: 220, position: 'relative' },
  corner: { position: 'absolute', width: 28, height: 28, borderColor: colors.primary },
  tl: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3 },
  tr: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3 },
  bl: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3 },
  br: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3 },

  cameraBottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    paddingBottom: space.lg,
  },
  shutter: {
    width: 76, height: 76, borderRadius: 38,
    borderWidth: 4, borderColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  shutterInner: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.primary },
  smallShutter: {
    width: 50, height: 50, borderRadius: 25,
    borderWidth: 1, borderColor: colors.borderStrong,
    backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center',
  },

  scroll: { padding: space.lg, gap: space.md, paddingBottom: 80 },
  previewTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  previewTitle: { color: colors.primary, fontWeight: '900', letterSpacing: 2 },
  preview: { width: '100%', aspectRatio: 1, borderRadius: radius.md, backgroundColor: colors.surface },
  resultBlock: { gap: space.sm, marginTop: space.sm },
  resultLabel: { color: colors.primary, fontSize: 11, fontWeight: '900', letterSpacing: 1.5, marginTop: space.md },
  resultBody: { ...(text.body as any) },
  stepRow: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  stepNum: {
    width: 24, height: 24, borderRadius: 12, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  stepNumText: { color: '#0a0a0a', fontWeight: '900', fontSize: 12 },
  stepText: { ...(text.body as any), flex: 1 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  toolChip: {
    paddingHorizontal: space.md, paddingVertical: 6, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface,
  },
  toolChipText: { color: colors.textPrimary, fontWeight: '700', fontSize: 12 },
  warnRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 4 },
  warnText: { color: colors.textPrimary, flex: 1, fontSize: 13 },

  sevPill: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    alignSelf: 'flex-start', paddingHorizontal: space.md, paddingVertical: 6,
    borderRadius: radius.pill, borderWidth: 1.5,
  },
  sevDot: { width: 8, height: 8, borderRadius: 4 },
  sevText: { fontWeight: '900', letterSpacing: 1, fontSize: 11 },
});
