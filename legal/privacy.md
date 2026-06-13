# Privacy Policy

**Handy-Andy: Job Site Assistant**
**Effective Date:** 2026-02-01 · **Last Updated:** 2026-02-01 · **Policy Version:** 1.0.0

This Privacy Policy explains how Handy-Andy ("we", "us", "the Application") collects, uses, discloses, and protects your personal information. It is written to satisfy the California Consumer Privacy Act of 2018, as amended by the California Privacy Rights Act of 2020 ("CCPA/CPRA"), the Illinois Biometric Information Privacy Act ("BIPA"), and the European Union Artificial Intelligence Act ("EU AI Act").

If you are a California resident, this policy is your statutorily required **Notice at Collection** under Cal. Civ. Code § 1798.100(b).

---

## 1. Categories of Personal Information We Collect

We collect only the information needed to operate the Application. We do not sell your personal information.

| Category | Specific Data Points | Source |
|---|---|---|
| **Identifiers** | Email address, full name, profile picture, Apple ID `sub` claim, Google account identifier | Provided by you at sign-in |
| **Photographic Imagery** | Job-site photos (before / after / annotation), broken-asset diagnostic photos, scope-creep change-order photos | Captured via your device camera or selected from your photo library |
| **Voice Recordings & Transcripts** | Audio captured during Voice Intake (m4a format), the textual transcript produced from that audio | Captured via your device microphone with your active consent |
| **Geolocation Data** | Approximate coordinates (latitude / longitude) when you tap "Check Local Stock" | Obtained from your device location services |
| **Commercial Information** | Subscription tier, trial end date, Stripe customer identifier, Stripe subscription identifier, parts-checkout history, AI scan count per month | Generated as you use the app |
| **Job & Operational Data** | Job titles, descriptions, safety notes, status changes, suggested tools, Bill of Materials, markup percentages, change orders, customer signatures | Provided by you and your customers |
| **Audit Information** | Consent records (version, accepted items, IP address, user-agent, timestamp), authentication session tokens, account creation date | Generated automatically for legal compliance |

We do **not** knowingly collect: government identifiers, race, religion, sexual orientation, union membership, precise GPS (we use coarse location only), health data, or data from anyone under the age of 16.

## 2. How We Use Your Information

- To provide the core handyman field-operations features you request (job logging, diagnostics, estimates, voice intake, safety analysis, accounting export).
- To authenticate you and maintain your session.
- To process subscription billing and one-off parts purchases via Stripe.
- To run AI-assisted analysis on photos and audio you explicitly submit, via third-party enterprise APIs (see § 4 below).
- To enforce subscription tier limits and prevent abuse.
- To satisfy legal record-keeping obligations (consent logs, billing records, fraud prevention).

## 3. We Do Not Sell or Share Your Personal Information

For purposes of CCPA/CPRA § 1798.140, we **do not sell** your personal information for monetary or other valuable consideration, and we **do not share** it for cross-context behavioral advertising. We have no advertising business model.

## 4. Third-Party AI Processing Disclosure

To deliver AI features, we transmit specific data to the following enterprise providers under their commercial API terms:

| Provider | Data Transmitted | Purpose | Training Use |
|---|---|---|---|
| **Google Gemini 2.5 Flash** (via Emergent Integrations) | Job-site photos, diagnostic photos, change-order photos | Real-time vision diagnostics, hazard detection, BOM extraction, scope-creep cost estimation | Contractually **not** used to train public models |
| **OpenAI Whisper** (via Emergent Integrations) | Voice-intake audio recordings | Real-time speech-to-text transcription | Contractually **not** used to train public models |
| **OpenAI TTS** (via Emergent Integrations) | Persona-specific greeting text | Real-time text-to-speech synthesis | Not applicable — synthesis only |
| **Stripe, Inc.** | Email, name, line-item metadata | Subscription billing and one-off parts checkout | Subject to Stripe's privacy policy |
| **Apple Inc.** (if you sign in with Apple) | Apple ID token claims | Authentication only | Subject to Apple's privacy policy |
| **Google LLC** (if you sign in with Google) | OAuth profile claims | Authentication only | Subject to Google's privacy policy |

Per the OpenAI Business API Terms (§ 4) and the Google Cloud Vertex AI Service Specific Terms (§ 6), inputs submitted by paying API customers are **not retained beyond 30 days and are not used to train public foundation models**. You may revoke AI processing consent at any time in Settings → Manage Privacy Consent — doing so will disable photo and voice features until consent is restored.

## 5. Biometric Information (Illinois BIPA Disclosure)

Voice recordings captured by the Voice Intake feature may, under BIPA § 14/10, constitute "biometric identifiers." We:
- Obtain your separate, written informed consent before the first such recording (the AI Disclosure screen during onboarding).
- Use voice data exclusively for transcription via OpenAI Whisper. We do not perform voiceprint identification.
- Retain transcripts as part of the resulting Job document. The underlying audio file is **not retained** server-side; it is deleted immediately after transcription.
- Will permanently destroy all voice-derived data within three (3) years of your last interaction or upon your account-deletion request, whichever is sooner.

## 6. Retention Schedule

| Data | Retention |
|---|---|
| Account profile | Until you delete the account |
| Jobs, photos, BOM, change orders | Until you delete the job or account |
| Voice audio | Discarded within 60 seconds of upload, after transcription |
| Voice transcripts | Stored with the Job until you delete it |
| Authentication sessions | 7 days, then automatically expired |
| Consent / audit log entries | 7 years (legal record-keeping) |
| Stripe customer records | Per Stripe's retention; we retain only the customer ID and subscription ID |

## 7. Your California Privacy Rights (CCPA / CPRA)

You have the right to:

- **Know** — request the categories and specific pieces of personal information we have collected about you in the prior 12 months.
- **Delete** — request that we delete your account and the personal information we hold about you. Implemented in Settings → Delete Account.
- **Correct** — request correction of inaccurate personal information.
- **Opt-Out of "Sharing"** — not applicable; we do not share for cross-context behavioral advertising.
- **Limit Use of Sensitive Personal Information** — voice recordings are the only sensitive PI we process; you may revoke that consent in Settings → Manage Privacy Consent.
- **Non-Discrimination** — we will not deny you service, charge different prices, or provide a different level of quality solely because you exercised a privacy right.
- **Portability** — request a machine-readable copy of your data via the in-app data export (see Settings → Manage Privacy Consent → Export My Data).

To exercise any right, email **privacy@handyandy.app** or use the in-app controls. We will verify your identity using your authenticated email and respond within 45 days.

## 8. Children

The Application is intended for licensed handymen, contractors, and field-service professionals. We do not knowingly collect data from anyone under 16.

## 9. International Transfers

Our servers are located in the United States. By using the Application from outside the U.S., you consent to the transfer and processing of your data in the U.S. under the Standard Contractual Clauses where applicable.

## 10. Security

We use TLS 1.2+ for data in transit, MongoDB authentication and at-rest encryption for storage, ephemeral OAuth sessions via the system browser, and JWT-style bearer tokens with 7-day expiry. We do not store payment card data — Stripe is our PCI-DSS processor.

## 11. Changes to This Policy

We will revise this policy as our practices evolve. Material changes will require fresh consent during your next login; minor edits are recorded by version number above. The current version is recorded in your consent audit log at the time you accept.

## 12. Contact

**Handy-Andy Privacy Office**
privacy@handyandy.app
Postal: 1 Tool Way, San Francisco, CA 94110

For California residents only: you may designate an authorized agent to make a request on your behalf by sending us a notarized written authorization.

---

*This policy is provided in plain English in accordance with CPRA § 1798.130(a)(5). A reading-level audit was conducted in accordance with the OAG Final Regulations § 7003.*
