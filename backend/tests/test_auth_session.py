"""Backend tests for the Emergent Google Sign-In session flow + regression.

Covers the review request:
- POST /api/auth/session with invalid session_id → 401 ("Failed to validate session")
- POST /api/auth/session missing session_id → 422
- POST /api/auth/dev-login end-to-end (returns session_token+user, authorises /auth/me)
- GET /api/auth/me no auth header → 401
- GET /api/auth/me bogus Bearer → 401
- POST /api/auth/logout invalidates the token
- Regression: /api/jobs, /api/subscription/status, /api/consent/list reachable with dev token
"""

import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://jobsite-assistant.preview.emergentagent.com").rstrip("/")

STATE: dict = {}


@pytest.fixture(scope="session")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def dev_token(api):
    r = api.post(
        f"{BASE_URL}/api/auth/dev-login",
        json={"email": "tester@andyhandy.dev", "name": "Test Tech"},
        timeout=20,
    )
    assert r.status_code == 200, f"dev-login failed: {r.status_code} {r.text}"
    body = r.json()
    assert "session_token" in body
    assert "user" in body
    STATE["token"] = body["session_token"]
    STATE["user"] = body["user"]
    return body["session_token"]


# ---------------------------------------------------------------
# /api/auth/session (Emergent Google flow)
# ---------------------------------------------------------------

class TestAuthSession:
    def test_invalid_session_id_returns_401(self, api):
        bogus = f"invalid_{uuid.uuid4().hex}"
        r = api.post(f"{BASE_URL}/api/auth/session", json={"session_id": bogus}, timeout=20)
        assert r.status_code == 401, f"expected 401, got {r.status_code}: {r.text[:300]}"
        detail = r.json().get("detail", "")
        assert "Failed to validate session" in detail, f"unexpected detail: {detail}"

    def test_missing_session_id_returns_422(self, api):
        r = api.post(f"{BASE_URL}/api/auth/session", json={}, timeout=15)
        assert r.status_code == 422, f"expected 422, got {r.status_code}: {r.text[:300]}"


# ---------------------------------------------------------------
# /api/auth/dev-login + /api/auth/me
# ---------------------------------------------------------------

class TestAuthMe:
    def test_dev_login_returns_token_and_user(self, dev_token):
        assert dev_token, "dev-login must return session_token"
        assert STATE["user"]["email"] == "tester@andyhandy.dev"
        assert "user_id" in STATE["user"]
        assert "_id" not in STATE["user"], "Mongo _id must not leak"

    def test_me_authorises_with_dev_token(self, api, dev_token):
        headers = {"Authorization": f"Bearer {dev_token}"}
        r = api.get(f"{BASE_URL}/api/auth/me", headers=headers, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["user"]["email"] == "tester@andyhandy.dev"
        assert "is_pro" in body

    def test_me_without_auth_returns_401(self, api):
        r = api.get(f"{BASE_URL}/api/auth/me", timeout=10)
        assert r.status_code == 401

    def test_me_with_bogus_bearer_returns_401(self, api):
        r = api.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": "Bearer not_a_real_token_xyz"},
            timeout=10,
        )
        assert r.status_code == 401


# ---------------------------------------------------------------
# Regression: existing auth-gated endpoints work with the dev token
# ---------------------------------------------------------------

class TestRegression:
    def test_jobs_list(self, api, dev_token):
        headers = {"Authorization": f"Bearer {dev_token}"}
        r = api.get(f"{BASE_URL}/api/jobs", headers=headers, timeout=20)
        assert r.status_code == 200, r.text
        jobs = r.json().get("jobs")
        assert isinstance(jobs, list)
        # Seeded on first list per user, so we expect at least the 4 demo jobs.
        assert len(jobs) >= 4, f"expected >=4 seeded jobs, got {len(jobs)}"
        assert all("_id" not in j for j in jobs)

    def test_subscription_status(self, api, dev_token):
        headers = {"Authorization": f"Bearer {dev_token}"}
        r = api.get(f"{BASE_URL}/api/subscription/status", headers=headers, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        for k in ("status", "current_tier", "is_pro", "ai_scan_count_this_month"):
            assert k in body, f"missing key: {k}"

    def test_consent_list(self, api, dev_token):
        headers = {"Authorization": f"Bearer {dev_token}"}
        r = api.get(f"{BASE_URL}/api/consent/list", headers=headers, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "consents" in body
        assert isinstance(body["consents"], list)


# ---------------------------------------------------------------
# Logout — MUST run last (invalidates session token used by other tests)
# ---------------------------------------------------------------

class TestZLogout:
    def test_logout_invalidates_token(self, api, dev_token):
        headers = {"Authorization": f"Bearer {dev_token}"}
        r = api.post(f"{BASE_URL}/api/auth/logout", headers=headers, timeout=15)
        assert r.status_code == 200
        assert r.json().get("ok") is True

        r2 = api.get(f"{BASE_URL}/api/auth/me", headers=headers, timeout=10)
        assert r2.status_code == 401, "session must be invalid after logout"
