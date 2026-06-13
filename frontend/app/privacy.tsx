import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ChevronLeft, ShieldCheck } from 'lucide-react-native';
import { colors, radius, space, text } from '@/src/lib/theme';

export const PRIVACY_VERSION = '1.0.0';
export const PRIVACY_EFFECTIVE = '2026-02-01';

const POLICY = `# Privacy Policy

Handy-Andy: Job Site Assistant
Effective: 2026-02-01 · Version 1.0.0

This Privacy Policy explains how Handy-Andy ("we", "us", "the Application") collects, uses, discloses, and protects your personal information. It is written to satisfy the California Consumer Privacy Act of 2018, as amended by the California Privacy Rights Act of 2020 ("CCPA/CPRA"), the Illinois Biometric Information Privacy Act ("BIPA"), and the European Union AI Act.

If you are a California resident, this policy is your statutorily required Notice at Collection under Cal. Civ. Code § 1798.100(b).

1. CATEGORIES OF PERSONAL INFORMATION WE COLLECT
We collect only the information needed to operate the Application. We do not sell your personal information.

· Identifiers — email address, full name, profile picture, Apple ID sub claim, Google account identifier (sign-in)
· Photographic Imagery — job-site photos (before / after / annotation), broken-asset diagnostic photos, scope-creep change-order photos (device camera or photo library)
· Voice Recordings & Transcripts — audio captured during Voice Intake (m4a) and resulting textual transcript (device microphone, with consent)
· Geolocation Data — approximate latitude / longitude when you tap "Check Local Stock"
· Commercial Information — subscription tier, trial end date, Stripe customer ID, parts-checkout history, AI scan count per month
· Job & Operational Data — job titles, descriptions, safety notes, status changes, suggested tools, Bill of Materials, markup percentages, change orders, customer signatures
· Audit Information — consent records (version, accepted items, IP, user-agent, timestamp), authentication session tokens, account creation date

We do NOT collect: government identifiers, race, religion, sexual orientation, union membership, precise GPS, health data, or data from anyone under 16.

2. HOW WE USE YOUR INFORMATION
· To provide handyman field-operations features (jobs, diagnostics, estimates, voice intake, safety analysis, accounting export)
· To authenticate you and maintain your session
· To process subscription billing and one-off parts purchases via Stripe
· To run AI-assisted analysis on photos and audio you explicitly submit, via third-party enterprise APIs
· To enforce subscription tier limits and prevent abuse
· To satisfy legal record-keeping obligations (consent logs, billing, fraud prevention)

3. WE DO NOT SELL OR SHARE YOUR PERSONAL INFORMATION
For purposes of CCPA/CPRA § 1798.140 we do not sell your personal information for monetary or other valuable consideration, and we do not share it for cross-context behavioral advertising. We have no advertising business model.

4. THIRD-PARTY AI PROCESSING DISCLOSURE
To deliver AI features we transmit specific data to:

· Google Gemini 2.5 Flash — job-site photos, diagnostic photos, change-order photos — for real-time vision diagnostics, hazard detection, BOM extraction. Contractually NOT used to train public models.
· OpenAI Whisper — voice-intake audio recordings — for real-time speech-to-text transcription. Contractually NOT used to train public models.
· OpenAI TTS — persona greeting text — for real-time text-to-speech synthesis.
· Stripe, Inc. — email, name, line-item metadata — for subscription billing and parts checkout.
· Apple Inc. / Google LLC — Apple ID token claims / OAuth profile claims — for authentication only.

Per the OpenAI Business API Terms § 4 and the Google Cloud Vertex AI Service Specific Terms § 6, inputs submitted by paying API customers are NOT retained beyond 30 days and are NOT used to train public foundation models. You may revoke AI processing consent at any time in Settings → Manage Privacy Consent.

5. BIOMETRIC INFORMATION (Illinois BIPA DISCLOSURE)
Voice recordings captured by Voice Intake may, under BIPA § 14/10, constitute "biometric identifiers". We obtain your separate written informed consent before the first such recording. Voice data is used exclusively for transcription via OpenAI Whisper; we do not perform voiceprint identification. The underlying audio file is NOT retained server-side; it is deleted immediately after transcription. All voice-derived data will be permanently destroyed within three years of your last interaction or upon account deletion, whichever is sooner.

6. RETENTION SCHEDULE
· Account profile — until you delete the account
· Jobs, photos, BOM, change orders — until you delete the job or account
· Voice audio — discarded within 60 seconds of upload
· Voice transcripts — stored with the Job until you delete it
· Authentication sessions — 7 days
· Consent / audit log entries — 7 years
· Stripe customer records — per Stripe's retention; we retain only the customer ID

7. YOUR CALIFORNIA PRIVACY RIGHTS (CCPA / CPRA)
· Know — request categories and specific pieces of PI we hold (last 12 months)
· Delete — Settings → Delete Account
· Correct — request correction of inaccurate PI
· Opt-Out of Sharing — not applicable
· Limit Use of Sensitive PI — Settings → Manage Privacy Consent (revoke voice/photo consent)
· Non-Discrimination — we will not deny service or charge differently if you exercise a privacy right
· Portability — in-app data export

Email privacy@handyandy.app or use in-app controls. We verify identity via your authenticated email and respond within 45 days.

8. CHILDREN — Intended for licensed handymen, contractors, and field-service professionals. We do not knowingly collect data from anyone under 16.

9. INTERNATIONAL TRANSFERS — Servers are in the United States. By using the Application from outside the U.S. you consent to transfer and processing in the U.S.

10. SECURITY — TLS 1.2+ in transit; MongoDB authentication and at-rest encryption; ephemeral OAuth via system browser; JWT bearer tokens with 7-day expiry. We do not store payment card data — Stripe is our PCI-DSS processor.

11. CHANGES TO THIS POLICY — Material changes require fresh consent during your next login. Current version recorded in your consent audit log at acceptance.

12. CONTACT
Handy-Andy Privacy Office
privacy@handyandy.app
1 Tool Way, San Francisco, CA 94110

For California residents: you may designate an authorized agent via notarized written authorization.

— END —
`;

export default function PrivacyScreen() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.top}>
        <Pressable testID="privacy-back" onPress={() => router.back()} style={styles.icon}>
          <ChevronLeft size={22} color={colors.textPrimary} />
        </Pressable>
        <View style={styles.titleBox}>
          <ShieldCheck size={16} color={colors.primary} />
          <Text style={styles.title}>PRIVACY POLICY</Text>
        </View>
        <View style={{ width: 44 }} />
      </View>
      <View style={styles.versionBar}>
        <Text style={styles.versionText}>VERSION {PRIVACY_VERSION} · EFFECTIVE {PRIVACY_EFFECTIVE}</Text>
      </View>
      <ScrollView testID="privacy-scroll" contentContainerStyle={styles.scroll}>
        <Text style={styles.body}>{POLICY}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: space.lg, borderBottomWidth: 1, borderBottomColor: colors.border },
  icon: { width: 44, height: 44, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface },
  titleBox: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  title: { color: colors.textPrimary, fontWeight: '900', letterSpacing: 1.5 },
  versionBar: { paddingVertical: 6, paddingHorizontal: space.lg, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border, alignItems: 'center' },
  versionText: { color: colors.primary, fontSize: 10, fontWeight: '900', letterSpacing: 1.5 },
  scroll: { padding: space.lg, paddingBottom: space.xxl },
  body: { color: colors.textSecondary, fontSize: 13, lineHeight: 20, fontFamily: 'System' },
});
