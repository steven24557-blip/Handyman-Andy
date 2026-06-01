# PRD — J.P. The Handyman: Pro Tools & Diagnostics

## Overview
A cross-platform mobile field-services app (Expo SDK 54) that gives handymen a single
industrial-grade workspace for managing jobs, diagnosing broken assets via AI vision,
evaluating job-site hazards, and getting a voice-greeted experience tuned to their
persona of choice. Built with FastAPI + MongoDB on the backend.

## Tech Stack
- **Frontend:** React Native + Expo SDK 54, Expo Router v3 (file-based), React Native StyleSheet
  with `zinc/yellow` industrial design tokens, react-native-svg (annotation), react-native-gesture-handler,
  react-native-reanimated (used for FadeInView wrapper that replaces moti to avoid web build issues),
  lucide-react-native icons, expo-camera (torch), expo-image-picker, expo-image-manipulator,
  expo-audio (TTS playback), @react-native-community/slider.
- **Backend:** FastAPI, motor (async Mongo), emergentintegrations (Gemini 2.5 Flash + OpenAI TTS).
- **Auth:** Emergent-managed Google Auth with `WebBrowser.openAuthSessionAsync` + a backend-only
  dev-login shortcut for testing.
- **AI:** Gemini 2.5 Flash for vision and text via `emergentintegrations.llm.chat.LlmChat`.
  OpenAI TTS (tts-1) via `emergentintegrations.llm.openai.text_to_speech.OpenAITextToSpeech`
  with persona → voice mapping (standard=onyx, folksy=fable, southern=echo, sassy=nova).

## Screens
1. **Login** — Disclaimer ScrollView; agree checkbox disabled until scrolled to bottom;
   Google OAuth + dev-login fallback. Brand stripes and industrial header.
2. **Dashboard `(tabs)/index`** — Vertical card deck of jobs, filter chips
   (`ALL · EMERGENT · IN PROGRESS · OPEN · CLOSED`), status indicators
   (open=blue dashed, in_progress=yellow clock, emergent=pulsing red, closed=green check),
   one-tap new-job, voice greeting fires on first launch.
3. **Diagnostic `(tabs)/diagnostic`** — Full-screen `CameraView` with torch toggle, flip,
   gallery-picker, scan reticle. Capture → resize → preview → AI analyze → root cause + repair
   blueprint + severity pill.
4. **Safety `(tabs)/safety`** — Location/notes inputs + optional photo. Returns hazards,
   OSHA flags, overall safe/caution/unsafe rating.
5. **Settings `(tabs)/settings`** — 4 persona cards (standard/folksy/southern/sassy),
   pitch & pace sliders, voice preview button (calls /api/voice/greet), reset greeting,
   sign-out.
6. **Job Details `/job/[id]`** — Title/location/desc, status pills (4 selectable),
   Before/After photo toggle with SVG annotation canvas (Pencil/Eraser/5 colors),
   AI analyze button (auto-fills tools + BOM + safety notes), editable safety notes,
   suggested tools chips, Bill of Materials rows with In/Low/Out-of-Stock pills.

## Backend API (all under `/api`)
- Auth: `POST /auth/session`, `POST /auth/dev-login`, `GET /auth/me`, `POST /auth/logout`
- Jobs: `GET /jobs`, `POST /jobs`, `GET /jobs/{id}`, `PATCH /jobs/{id}`, `POST /jobs/{id}/photos`, `DELETE /jobs/{id}`
- AI: `POST /ai/analyze-job`, `POST /ai/diagnostic`, `POST /ai/safety`
- Voice: `POST /voice/greet`

## Data Model
- `users { user_id, email, name, picture, created_at }`
- `user_sessions { session_token, user_id, expires_at, created_at }` (TTL index, 7-day expiry)
- `jobs { job_id, user_id, title, description, status, safety_notes, location, tools_suggested[],
  bom[{name, quantity, stock}], photos[{id, label, base64, created_at}], ai_diagnostic,
  created_at, updated_at }`

## Test Coverage
- 20/20 backend tests passing (`/app/backend/tests/test_jp_handyman_backend.py`)
- Auth, CRUD, AI vision, TTS, error paths

## Future
- Skia-based annotation canvas (currently uses react-native-svg for Expo Go compatibility)
- Apple Sign-In (requires dev build)
- Offline-first caching layer for jobs
- Real supplier integration replacing mock stock indicators
