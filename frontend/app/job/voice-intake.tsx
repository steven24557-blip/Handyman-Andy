import React, { useEffect, useRef, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as FileSystem from 'expo-file-system/legacy';
import { AudioModule, useAudioRecorder, RecordingPresets } from 'expo-audio';
import { Mic, Square, ChevronLeft, Wand2 } from 'lucide-react-native';
import { api } from '@/src/lib/api';
import { useSubscription } from '@/src/lib/subscription';
import FadeInView from '@/src/components/FadeInView';
import { colors, radius, space } from '@/src/lib/theme';

export default function VoiceIntake() {
  const router = useRouter();
  const { showPaywall } = useSubscription();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [processing, setProcessing] = useState(false);
  const timerRef = useRef<any>(null);

  useEffect(() => {
    (async () => {
      try {
        const perm = await AudioModule.requestRecordingPermissionsAsync();
        if (!perm.granted) Alert.alert('Microphone access required', 'Enable microphone access in Settings.');
      } catch {}
    })();
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  const start = async () => {
    try {
      await recorder.prepareToRecordAsync();
      recorder.record();
      setElapsed(0); setRecording(true);
      timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    } catch (e: any) {
      Alert.alert('Recording failed', e?.message || '');
    }
  };

  const stop = async () => {
    if (timerRef.current) clearInterval(timerRef.current);
    setRecording(false);
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) throw new Error('No recording URI');
      setProcessing(true);
      const b64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' as any });
      const mime = Platform.OS === 'ios' ? 'audio/m4a' : 'audio/m4a';
      const res = await api.voiceIntake(b64, mime);
      if (res?.job?.job_id) {
        router.replace(`/job/${res.job.job_id}`);
      } else {
        Alert.alert('Intake failed', 'No job was created.');
      }
    } catch (e: any) {
      if (e?.status === 402) showPaywall(e.message);
      else Alert.alert('Voice intake failed', e?.message || '');
    } finally {
      setProcessing(false);
    }
  };

  const mins = Math.floor(elapsed / 60).toString().padStart(2, '0');
  const secs = (elapsed % 60).toString().padStart(2, '0');

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.top}>
        <Pressable onPress={() => router.back()} style={styles.icon}><ChevronLeft size={22} color={colors.textPrimary} /></Pressable>
        <Text style={styles.h1}>VOICE WALKTHROUGH</Text>
        <View style={{ width: 44 }} />
      </View>

      <View style={styles.body}>
        {processing ? (
          <FadeInView from={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <View
              style={styles.processing}
              accessible
              accessibilityLiveRegion="assertive"
              accessibilityRole="alert"
              accessibilityLabel="Andy is processing your voice walkthrough. Transcribing audio and generating job structure."
            >
              <Wand2 size={36} color={colors.primary} />
              <Text style={styles.processingTitle}>ANDY IS LISTENING…</Text>
              <Text style={styles.processingSub}>Transcribing audio · Generating job structure</Text>
              <View style={styles.skeletonGrid}>
                <View style={styles.skLine} />
                <View style={[styles.skLine, { width: '70%' }]} />
                <View style={[styles.skLine, { width: '90%' }]} />
              </View>
            </View>
          </FadeInView>
        ) : (
          <>
            <Text style={styles.helper}>Hold and speak the job walkthrough. Tap stop when done — Andy will turn it into a job, tasks, and BOM.</Text>
            <View style={styles.timer}><Text style={styles.timerText}>{mins}:{secs}</Text></View>

            <Pressable
              testID={recording ? 'voice-stop-btn' : 'voice-start-btn'}
              onPress={recording ? stop : start}
              style={[styles.mic, recording && styles.micActive]}
              accessible
              accessibilityRole="button"
              accessibilityLabel={recording ? 'Stop voice recording' : 'Trigger voice intake recorder'}
              accessibilityHint={recording ? 'Stops recording and sends audio to AI for transcription' : 'Begins capturing your job walkthrough audio'}
              accessibilityState={{ busy: recording }}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              {recording ? <Square size={42} color="#0a0a0a" /> : <Mic size={42} color="#0a0a0a" />}
            </Pressable>
            <Text
              style={styles.state}
              accessible
              accessibilityLiveRegion="polite"
              accessibilityRole="text"
            >{recording ? 'RECORDING…' : 'TAP TO START'}</Text>

            {recording && (
              <FadeInView from={{ opacity: 0.4 }} animate={{ opacity: 1 }} transition={{ loop: true, duration: 700 }}>
                <View style={styles.wavebar}><View style={styles.wave} /><View style={[styles.wave, { height: 28 }]} /><View style={[styles.wave, { height: 36 }]} /><View style={[styles.wave, { height: 24 }]} /><View style={styles.wave} /></View>
              </FadeInView>
            )}
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: space.lg, borderBottomWidth: 1, borderBottomColor: colors.border },
  icon: { width: 44, height: 44, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface },
  h1: { color: colors.primary, fontWeight: '900', letterSpacing: 2, fontSize: 14 },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.lg },
  helper: { color: colors.textSecondary, textAlign: 'center', fontSize: 14, lineHeight: 20 },
  timer: { paddingVertical: 6, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface },
  timerText: { color: colors.primary, fontFamily: 'monospace', fontSize: 32, fontWeight: '900', letterSpacing: 2 },
  mic: { width: 180, height: 180, borderRadius: 90, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', borderWidth: 8, borderColor: colors.primaryDark, shadowColor: colors.primary, shadowOpacity: 0.5, shadowRadius: 20 },
  micActive: { backgroundColor: colors.danger, borderColor: '#7f1d1d' },
  state: { color: colors.textPrimary, fontWeight: '900', letterSpacing: 2, fontSize: 14 },
  wavebar: { flexDirection: 'row', gap: 6, alignItems: 'flex-end', height: 40 },
  wave: { width: 6, height: 20, borderRadius: 2, backgroundColor: colors.primary },
  processing: { alignItems: 'center', gap: space.md },
  processingTitle: { color: colors.textPrimary, fontWeight: '900', letterSpacing: 2 },
  processingSub: { color: colors.textSecondary, textAlign: 'center' },
  skeletonGrid: { gap: space.sm, marginTop: space.lg, width: 280 },
  skLine: { height: 10, borderRadius: 4, backgroundColor: colors.surfaceElevated, opacity: 0.8 },
});
