import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Camera, Mic, MapPin, Image as ImageIcon, X, ShieldCheck, ChevronRight } from 'lucide-react-native';
import Button from './Button';
import { colors, radius, space } from '@/src/lib/theme';

export type PermissionKind = 'camera' | 'microphone' | 'location' | 'photos';

type Props = {
  kind: PermissionKind | null;
  onContinue: () => void;
  onCancel: () => void;
};

const COPY: Record<PermissionKind, {
  Icon: any;
  title: string;
  what: string;
  where: string;
  retention: string;
  rights: string;
}> = {
  camera: {
    Icon: Camera,
    title: 'CAMERA — NOTICE AT COLLECTION',
    what: 'When you take a job-site or diagnostic photo, your camera captures an image at 1024×768 resolution and below.',
    where: 'The photo is sent securely (TLS 1.2+) to Google Gemini 2.5 Flash for real-time vision analysis (diagnostics, hazard detection, BOM extraction). It is also stored, base64-encoded, inside your private Job record in our database.',
    retention: 'Photos are retained until you delete the job or your account. Google does not retain or use these images to train its public models per its enterprise API terms.',
    rights: 'You can revoke camera access in your device Settings at any time. You can delete any photo from a Job, or delete the entire Job, from within the app.',
  },
  microphone: {
    Icon: Mic,
    title: 'MICROPHONE — NOTICE AT COLLECTION',
    what: 'When you tap Record on the Voice Intake screen, your microphone captures audio in m4a format until you tap Stop.',
    where: 'The audio file is sent securely to OpenAI Whisper for speech-to-text transcription. The resulting text is then sent to Google Gemini 2.5 Flash to structure the transcript into a new Job (title, description, tasks, materials).',
    retention: 'The raw audio file is discarded within 60 seconds of upload and never stored on our servers. Only the textual transcript is retained, attached to the resulting Job, until you delete it.',
    rights: 'You may revoke microphone access in your device Settings at any time. Under Illinois BIPA you also gave separate written consent during onboarding; you can revoke that in Settings → Manage Privacy Consent.',
  },
  location: {
    Icon: MapPin,
    title: 'LOCATION — NOTICE AT COLLECTION',
    what: 'When you tap "Check Local Stock" we request approximate (city-level, not precise GPS) latitude and longitude from your device.',
    where: 'Coordinates are sent to our backend to identify nearby hardware suppliers and their per-item stock. They are not shared with any third party and not stored beyond the duration of the request.',
    retention: 'Location coordinates are used in-memory only. Nothing is persisted to our database.',
    rights: 'You may revoke location access in your device Settings at any time. The inventory feature will degrade to a default list of suppliers without precise distance.',
  },
  photos: {
    Icon: ImageIcon,
    title: 'PHOTO LIBRARY — NOTICE AT COLLECTION',
    what: 'When you tap "Attach Photo" we access only the specific photo you select — never your full library.',
    where: 'The selected photo is processed identically to a captured photo (see Camera notice).',
    retention: 'Same as camera-captured photos: retained inside the Job until you delete it.',
    rights: 'You may revoke photo-library access in your device Settings at any time.',
  },
};

export default function NoticeAtCollection({ kind, onContinue, onCancel }: Props) {
  if (!kind) return null;
  const meta = COPY[kind];
  const Icon = meta.Icon;
  return (
    <Modal animationType="slide" transparent visible={!!kind} onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Pressable testID="notice-close" onPress={onCancel} style={styles.close}>
            <X size={20} color={colors.textSecondary} />
          </Pressable>
          <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxl }}>
            <View style={styles.badge}>
              <ShieldCheck size={14} color={colors.primary} />
              <Text style={styles.badgeText}>CPRA NOTICE AT COLLECTION</Text>
            </View>
            <View style={styles.headRow}>
              <View style={styles.iconBox}><Icon size={22} color={colors.primary} /></View>
              <Text style={styles.title}>{meta.title}</Text>
            </View>

            <Row label="WHAT WE COLLECT" body={meta.what} />
            <Row label="WHERE IT GOES" body={meta.where} />
            <Row label="HOW LONG WE KEEP IT" body={meta.retention} />
            <Row label="YOUR RIGHTS" body={meta.rights} />

            <Text style={styles.fine}>
              By tapping Continue you authorize this single data flow for this session. Full details: Settings → Privacy Policy.
            </Text>

            <View style={{ height: space.lg }} />
            <Button testID="notice-continue" label="CONTINUE & GRANT" onPress={onContinue} fullWidth />
            <View style={{ height: space.sm }} />
            <Button testID="notice-cancel" label="CANCEL" variant="outline" onPress={onCancel} fullWidth />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function Row({ label, body }: { label: string; body: string }) {
  return (
    <View style={{ marginTop: space.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <ChevronRight size={12} color={colors.primary} />
        <Text style={styles.rowLabel}>{label}</Text>
      </View>
      <Text style={styles.rowBody}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.scrim, justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, maxHeight: '92%', borderTopWidth: 2, borderColor: colors.primary },
  handle: { width: 40, height: 4, backgroundColor: colors.borderStrong, alignSelf: 'center', marginTop: 10, borderRadius: 2 },
  close: { position: 'absolute', right: 16, top: 12, padding: 6, zIndex: 2 },
  badge: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: space.md, paddingVertical: 4, borderRadius: radius.pill, borderWidth: 1.5, borderColor: colors.primary, backgroundColor: 'rgba(234,179,8,0.08)' },
  badgeText: { color: colors.primary, fontSize: 10, fontWeight: '900', letterSpacing: 1.5 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.md },
  iconBox: { width: 44, height: 44, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface },
  title: { color: colors.textPrimary, fontSize: 16, fontWeight: '900', letterSpacing: 1, flex: 1 },
  rowLabel: { color: colors.primary, fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  rowBody: { color: colors.textPrimary, fontSize: 13, lineHeight: 19, marginTop: 4 },
  fine: { color: colors.textTertiary, fontSize: 11, lineHeight: 16, marginTop: space.lg, fontStyle: 'italic' },
});
