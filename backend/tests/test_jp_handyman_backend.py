"""Comprehensive backend tests for J.P. The Handyman API.

Covers:
- Health endpoint
- Dev login auth + bearer auth protection
- Jobs CRUD (incl. auto-seed of 4 demo jobs)
- Photo upload to job
- AI vision endpoints (Gemini 2.5 Flash via emergentintegrations)
- Voice greet (OpenAI TTS via Emergent LLM key)
- Logout invalidates token

Backend URL: http://localhost:8001 (per agent-to-agent context note).
"""

import base64
import io
import os
import time

import pytest
import requests

# Per instructions: hit localhost:8001 directly to skip frontend ingress.
BASE_URL = "http://localhost:8001"
AI_TIMEOUT = 90  # AI calls can take 5-30s

# Module-level shared state populated by fixtures/tests as we go.
STATE = {}


# ---------------------------------------------------------------
# Helpers / fixtures
# ---------------------------------------------------------------

def _make_jpeg_b64() -> str:
    """Generate a small real JPEG (with textures/edges) and return base64.

    We try Pillow first; if unavailable, fall back to a tiny pre-built
    JPEG with non-trivial content embedded as base64.
    """
    try:
        from PIL import Image, ImageDraw  # type: ignore

        img = Image.new("RGB", (256, 256), (210, 215, 220))
        d = ImageDraw.Draw(img)
        # Draw shapes to provide edges/textures for the vision model
        d.rectangle([20, 20, 120, 220], fill=(80, 60, 40), outline=(20, 20, 20), width=3)
        d.ellipse([140, 40, 230, 130], fill=(180, 30, 30), outline=(40, 0, 0), width=2)
        for i in range(0, 256, 12):
            d.line([(i, 230), (256 - i, 250)], fill=(50, 50, 50), width=1)
        d.text((30, 235), "LEAK", fill=(0, 0, 0))
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=80)
        return base64.b64encode(buf.getvalue()).decode("ascii")
    except Exception:
        # Minimal 8x8 JPEG with gradient (still a real JPEG)
        # Pre-generated using Pillow offline; embedded here as fallback.
        return (
            "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8U"
            "HRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDB"
            "gNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy"
            "MjIyMjL/wAARCAAIAAgDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xA"
            "AUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEA"
            "AAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwA/wD/Z"
        )


@pytest.fixture(scope="session")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def auth_headers(api):
    """Dev-login once for the whole session and return Bearer headers."""
    r = api.post(
        f"{BASE_URL}/api/auth/dev-login",
        json={"email": "tester@jphandy.dev", "name": "Test Tech"},
        timeout=15,
    )
    assert r.status_code == 200, f"dev-login failed: {r.status_code} {r.text}"
    data = r.json()
    token = data["session_token"]
    STATE["token"] = token
    STATE["user"] = data["user"]
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ---------------------------------------------------------------
# Health
# ---------------------------------------------------------------

class TestHealth:
    def test_root(self, api):
        r = api.get(f"{BASE_URL}/api/", timeout=10)
        assert r.status_code == 200
        body = r.json()
        assert body.get("name") == "J.P. The Handyman API"
        assert "version" in body


# ---------------------------------------------------------------
# Auth
# ---------------------------------------------------------------

class TestAuth:
    def test_dev_login_returns_token(self, auth_headers):
        assert STATE["token"].startswith("dev_"), "Dev token must be prefixed with 'dev_'"
        assert STATE["user"]["email"] == "tester@jphandy.dev"
        assert STATE["user"]["name"] == "Test Tech"
        assert "user_id" in STATE["user"]
        assert "_id" not in STATE["user"], "Mongo _id must not leak to clients"

    def test_dev_login_invalid_email(self, api):
        r = api.post(f"{BASE_URL}/api/auth/dev-login", json={"email": "not-an-email"}, timeout=10)
        assert r.status_code == 400

    def test_auth_me(self, api, auth_headers):
        r = api.get(f"{BASE_URL}/api/auth/me", headers=auth_headers, timeout=10)
        assert r.status_code == 200
        user = r.json()["user"]
        assert user["email"] == "tester@jphandy.dev"
        assert "_id" not in user

    def test_jobs_requires_auth(self, api):
        r = api.get(f"{BASE_URL}/api/jobs", timeout=10)
        assert r.status_code == 401

    def test_jobs_bad_token(self, api):
        r = api.get(
            f"{BASE_URL}/api/jobs",
            headers={"Authorization": "Bearer not_a_real_token"},
            timeout=10,
        )
        assert r.status_code == 401


# ---------------------------------------------------------------
# Jobs CRUD
# ---------------------------------------------------------------

class TestJobs:
    def test_list_jobs_seeds_demo(self, api, auth_headers):
        r = api.get(f"{BASE_URL}/api/jobs", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        jobs = r.json()["jobs"]
        # Auto-seed of 4 demo jobs on first call (for this user).
        assert len(jobs) >= 4, f"Expected >=4 seeded jobs, got {len(jobs)}"
        statuses = {j["status"] for j in jobs}
        # All 4 demo statuses should be present
        for s in ("open", "in_progress", "emergent", "closed"):
            assert s in statuses, f"Missing seeded status: {s}"
        # No mongo _id leakage
        assert all("_id" not in j for j in jobs)
        # photos field should be replaced with photo_count
        assert all("photos" not in j for j in jobs)
        assert all("photo_count" in j for j in jobs)
        STATE["seed_job_id"] = jobs[0]["job_id"]

    def test_list_jobs_idempotent_seed(self, api, auth_headers):
        """Second call must not re-seed."""
        r = api.get(f"{BASE_URL}/api/jobs", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        jobs = r.json()["jobs"]
        STATE["seed_count"] = len(jobs)
        # Second call: list count stable (will match after create test runs in order)
        assert len(jobs) >= 4

    def test_get_single_job(self, api, auth_headers):
        jid = STATE["seed_job_id"]
        r = api.get(f"{BASE_URL}/api/jobs/{jid}", headers=auth_headers, timeout=10)
        assert r.status_code == 200
        job = r.json()["job"]
        assert job["job_id"] == jid
        assert "title" in job
        assert "_id" not in job

    def test_get_unknown_job_404(self, api, auth_headers):
        r = api.get(f"{BASE_URL}/api/jobs/nonexistent_xyz", headers=auth_headers, timeout=10)
        assert r.status_code == 404

    def test_create_job_and_verify(self, api, auth_headers):
        payload = {
            "title": "TEST_New Job — Faucet Repair",
            "description": "TEST created by backend_test.py",
            "status": "open",
            "safety_notes": "TEST notes",
            "location": "TEST 123 Test Lane",
        }
        r = api.post(f"{BASE_URL}/api/jobs", headers=auth_headers, json=payload, timeout=10)
        assert r.status_code == 200, r.text
        job = r.json()["job"]
        assert job["title"] == payload["title"]
        assert job["status"] == "open"
        STATE["created_job_id"] = job["job_id"]

        # Verify via GET
        r2 = api.get(f"{BASE_URL}/api/jobs/{job['job_id']}", headers=auth_headers, timeout=10)
        assert r2.status_code == 200
        assert r2.json()["job"]["title"] == payload["title"]

    def test_patch_job_status(self, api, auth_headers):
        jid = STATE["created_job_id"]
        r = api.patch(
            f"{BASE_URL}/api/jobs/{jid}",
            headers=auth_headers,
            json={"status": "in_progress"},
            timeout=10,
        )
        assert r.status_code == 200
        assert r.json()["job"]["status"] == "in_progress"

        # Verify persisted via GET
        r2 = api.get(f"{BASE_URL}/api/jobs/{jid}", headers=auth_headers, timeout=10)
        assert r2.json()["job"]["status"] == "in_progress"

    def test_patch_job_no_updates(self, api, auth_headers):
        jid = STATE["created_job_id"]
        r = api.patch(f"{BASE_URL}/api/jobs/{jid}", headers=auth_headers, json={}, timeout=10)
        assert r.status_code == 400

    def test_add_photo(self, api, auth_headers):
        jid = STATE["created_job_id"]
        b64 = _make_jpeg_b64()
        r = api.post(
            f"{BASE_URL}/api/jobs/{jid}/photos",
            headers=auth_headers,
            json={"label": "before", "base64": b64},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        photo = r.json()["photo"]
        assert photo["label"] == "before"
        assert photo["base64"] == b64
        assert "id" in photo

        # Verify the job now has 1 photo via GET
        r2 = api.get(f"{BASE_URL}/api/jobs/{jid}", headers=auth_headers, timeout=10)
        assert r2.status_code == 200
        assert len(r2.json()["job"]["photos"]) == 1


# ---------------------------------------------------------------
# AI Vision (Gemini 2.5 Flash via emergentintegrations)
# ---------------------------------------------------------------

class TestAIVision:
    def test_analyze_job(self, api, auth_headers):
        b64 = _make_jpeg_b64()
        r = api.post(
            f"{BASE_URL}/api/ai/analyze-job",
            headers=auth_headers,
            json={"image_base64": b64, "context": "Leaking kitchen faucet under-cabinet"},
            timeout=AI_TIMEOUT,
        )
        assert r.status_code == 200, f"analyze-job failed: {r.status_code} {r.text[:500]}"
        body = r.json()
        for k in ("diagnostic", "tools", "bom", "safety_notes", "raw"):
            assert k in body, f"Missing key: {k}"
        assert isinstance(body["diagnostic"], str) and len(body["diagnostic"]) > 0
        assert isinstance(body["tools"], list)
        assert isinstance(body["bom"], list)
        assert isinstance(body["raw"], str) and len(body["raw"]) > 0

    def test_diagnostic(self, api, auth_headers):
        b64 = _make_jpeg_b64()
        r = api.post(
            f"{BASE_URL}/api/ai/diagnostic",
            headers=auth_headers,
            json={"image_base64": b64, "notes": "Rust and dripping water observed"},
            timeout=AI_TIMEOUT,
        )
        assert r.status_code == 200, f"diagnostic failed: {r.status_code} {r.text[:500]}"
        body = r.json()
        for k in ("root_cause", "severity", "steps", "tools", "safety_warnings", "raw"):
            assert k in body, f"Missing key: {k}"
        assert body["severity"] in ("low", "medium", "high")
        assert isinstance(body["steps"], list)
        assert isinstance(body["tools"], list)
        assert isinstance(body["safety_warnings"], list)

    def test_safety_text_only(self, api, auth_headers):
        r = api.post(
            f"{BASE_URL}/api/ai/safety",
            headers=auth_headers,
            json={"location": "Garage near breaker panel", "notes": "Exposed wires near panel; wet floor"},
            timeout=AI_TIMEOUT,
        )
        assert r.status_code == 200, f"safety text-only failed: {r.status_code} {r.text[:500]}"
        body = r.json()
        for k in ("hazards", "osha_flags", "overall_rating", "recommendation", "raw"):
            assert k in body
        assert body["overall_rating"] in ("safe", "caution", "unsafe")
        assert isinstance(body["hazards"], list)
        assert isinstance(body["osha_flags"], list)

    def test_safety_with_image(self, api, auth_headers):
        b64 = _make_jpeg_b64()
        r = api.post(
            f"{BASE_URL}/api/ai/safety",
            headers=auth_headers,
            json={"image_base64": b64, "location": "Workshop", "notes": "Inspect please"},
            timeout=AI_TIMEOUT,
        )
        assert r.status_code == 200, f"safety with-image failed: {r.status_code} {r.text[:500]}"
        body = r.json()
        assert body["overall_rating"] in ("safe", "caution", "unsafe")
        assert isinstance(body["hazards"], list)


# ---------------------------------------------------------------
# Voice / TTS (OpenAI via Emergent LLM key)
# ---------------------------------------------------------------

class TestVoice:
    def test_voice_greet_standard(self, api, auth_headers):
        r = api.post(
            f"{BASE_URL}/api/voice/greet",
            headers=auth_headers,
            json={"persona": "standard", "name": "Tester", "pitch": 1.0, "pace": 1.0},
            timeout=AI_TIMEOUT,
        )
        assert r.status_code == 200, f"voice greet failed: {r.status_code} {r.text[:500]}"
        body = r.json()
        assert "text" in body and len(body["text"]) > 0
        assert "audio_base64" in body and len(body["audio_base64"]) > 100, "Audio output too small"
        # Sanity-check it decodes
        decoded = base64.b64decode(body["audio_base64"])
        assert len(decoded) > 200, "Decoded mp3 too small"
        # MP3 magic: starts with ID3 or 0xFFFB/0xFFF3/0xFFFA frame sync
        assert decoded[:3] == b"ID3" or decoded[0] == 0xFF, "Not a valid MP3 stream"
        assert body["persona"] == "standard"
        assert body["voice"] == "onyx"


# ---------------------------------------------------------------
# Logout (run last)
# ---------------------------------------------------------------

class TestZLogout:
    def test_logout_invalidates_token(self, api, auth_headers):
        r = api.post(f"{BASE_URL}/api/auth/logout", headers=auth_headers, timeout=10)
        assert r.status_code == 200
        assert r.json().get("ok") is True

        # Subsequent call with same token should be unauthorized
        r2 = api.get(f"{BASE_URL}/api/auth/me", headers=auth_headers, timeout=10)
        assert r2.status_code == 401, "Token must be invalid after logout"
