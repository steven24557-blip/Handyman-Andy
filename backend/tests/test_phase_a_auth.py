"""Phase A backend regression tests.

Covers:
- signup end-to-end (via MongoDB direct token read → verify-email → /auth/me)
- signup validation (terms, weak password, duplicate email, duplicate username, invalid username)
- username availability
- login flow (email + username identifier, wrong password, unverified)
- forgot-password privacy (never leak existence)
- password reset (with old-session invalidation and old-password rejection)
- hidden dev-login (missing secret 422, wrong secret 404, correct secret 200)
- rate limiting (login lockout on 9th attempt)
- OAuth session regression (invalid session_id → 401)
- /api/ root & /api/jobs seeded jobs regression
"""
import os
import time
import uuid

import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL")
if BASE_URL:
    BASE_URL = BASE_URL.rstrip("/")

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "jp_handyman")
ANDY_DEV_SECRET = os.environ.get("ANDY_DEV_SECRET", "andy_01b0fmH1hvFa3gZFz_SDYQvVchp_t5jzBUIKz6kFH5s")

_mongo = MongoClient(MONGO_URL)
_db = _mongo[DB_NAME]


def _fake_ip():
    """Generate a per-test synthetic client IP so each test gets its own
    rate-limit bucket in Mongo (the backend's `_client_ip` helper honours
    the left-most X-Forwarded-For entry). This avoids the entire suite
    sharing a single 10/hr signup bucket and cross-polluting tests."""
    return f"10.{uuid.uuid4().int % 254 + 1}.{uuid.uuid4().int % 254 + 1}.{uuid.uuid4().int % 254 + 1}"


@pytest.fixture
def api():
    s = requests.Session()
    s.headers.update({
        "Content-Type": "application/json",
        # Unique fake client IP → each test gets its own rate-limit bucket.
        "X-Forwarded-For": _fake_ip(),
    })
    return s


def _rand_email(prefix="test"):
    return f"TEST_{prefix}_{uuid.uuid4().hex[:10]}@andyhandy.test"


def _rand_username(prefix="tu"):
    return f"TEST_{prefix}_{uuid.uuid4().hex[:6]}".lower()


def _mongo_user(email):
    return _db.users.find_one({"email": email.lower()})


# ---------------- Root & health regression ----------------
class TestRoot:
    def test_api_root(self, api):
        r = api.get(f"{BASE_URL}/api/")
        assert r.status_code == 200, r.text
        # app name check (best-effort)
        body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
        assert body  # non-empty


# ---------------- Username availability ----------------
class TestUsernameCheck:
    def test_username_available(self, api):
        u = _rand_username("free")
        r = api.post(f"{BASE_URL}/api/auth/username-check", json={"username": u})
        assert r.status_code == 200, r.text
        assert r.json().get("available") is True

    def test_username_taken_after_signup(self, api):
        email = _rand_email("uname")
        uname = _rand_username("taken")
        r = api.post(f"{BASE_URL}/api/auth/signup", json={
            "email": email, "password": "Str0ng!Pass2", "username": uname, "accepted_terms": True
        })
        assert r.status_code == 200, r.text
        r2 = api.post(f"{BASE_URL}/api/auth/username-check", json={"username": uname})
        assert r2.status_code == 200
        assert r2.json().get("available") is False


# ---------------- Signup end-to-end ----------------
class TestSignupFlow:
    def test_signup_then_verify_then_me(self, api):
        email = _rand_email("full")
        uname = _rand_username("full")
        r = api.post(f"{BASE_URL}/api/auth/signup", json={
            "email": email, "password": "Str0ng!Pass2", "username": uname, "accepted_terms": True
        })
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        assert body.get("email_verification_sent") is True
        assert body.get("email", "").lower() == email.lower()

        # Read token from MongoDB
        user = _mongo_user(email)
        assert user, "user not stored in mongo"
        token = user.get("email_verification_token")
        assert token, "verification token missing in DB"

        # Verify email
        v = api.post(f"{BASE_URL}/api/auth/verify-email", json={"token": token})
        assert v.status_code == 200, v.text
        vbody = v.json()
        assert "session_token" in vbody
        assert "user" in vbody
        session_token = vbody["session_token"]

        # /auth/me
        me = api.get(f"{BASE_URL}/api/auth/me",
                     headers={"Authorization": f"Bearer {session_token}"})
        assert me.status_code == 200, me.text
        assert me.json()["user"]["email"].lower() == email.lower()


# ---------------- Signup validation ----------------
class TestSignupValidation:
    def test_missing_accepted_terms(self, api):
        r = api.post(f"{BASE_URL}/api/auth/signup", json={
            "email": _rand_email("noterms"), "password": "Str0ng!Pass2",
            "accepted_terms": False
        })
        assert r.status_code == 400, r.text

    def test_weak_password(self, api):
        r = api.post(f"{BASE_URL}/api/auth/signup", json={
            "email": _rand_email("weak"), "password": "abc", "accepted_terms": True
        })
        assert r.status_code == 400, r.text
        assert "8 characters" in r.text.lower() or "at least 8" in r.text.lower()

    def test_duplicate_email(self, api):
        email = _rand_email("dup")
        p = {"email": email, "password": "Str0ng!Pass2", "accepted_terms": True}
        r1 = api.post(f"{BASE_URL}/api/auth/signup", json=p)
        assert r1.status_code == 200
        r2 = api.post(f"{BASE_URL}/api/auth/signup", json=p)
        assert r2.status_code == 409, r2.text
        assert "already exists" in r2.text.lower()

    def test_duplicate_username(self, api):
        uname = _rand_username("dupu")
        r1 = api.post(f"{BASE_URL}/api/auth/signup", json={
            "email": _rand_email("dupu1"), "password": "Str0ng!Pass2",
            "username": uname, "accepted_terms": True
        })
        assert r1.status_code == 200, r1.text
        r2 = api.post(f"{BASE_URL}/api/auth/signup", json={
            "email": _rand_email("dupu2"), "password": "Str0ng!Pass2",
            "username": uname, "accepted_terms": True
        })
        assert r2.status_code == 409, r2.text
        assert "taken" in r2.text.lower()

    def test_invalid_username_format(self, api):
        r = api.post(f"{BASE_URL}/api/auth/signup", json={
            "email": _rand_email("badu"), "password": "Str0ng!Pass2",
            "username": "no!spaces or spec", "accepted_terms": True
        })
        assert r.status_code == 400, r.text


# ---------------- Login ----------------
class TestLogin:
    @pytest.fixture(scope="class")
    def verified_user(self):
        api = requests.Session()
        api.headers.update({
            "Content-Type": "application/json",
            "X-Forwarded-For": _fake_ip(),
        })
        email = _rand_email("login")
        uname = _rand_username("login")
        pw = "Str0ng!Pass2"
        r = api.post(f"{BASE_URL}/api/auth/signup", json={
            "email": email, "password": pw, "username": uname, "accepted_terms": True
        })
        assert r.status_code == 200, r.text
        user = _mongo_user(email)
        token = user["email_verification_token"]
        v = api.post(f"{BASE_URL}/api/auth/verify-email", json={"token": token})
        assert v.status_code == 200
        return {"email": email, "username": uname, "password": pw}

    def test_login_with_email(self, api, verified_user):
        r = api.post(f"{BASE_URL}/api/auth/login", json={
            "identifier": verified_user["email"], "password": verified_user["password"]
        })
        assert r.status_code == 200, r.text
        assert "session_token" in r.json()

    def test_login_with_username(self, api, verified_user):
        r = api.post(f"{BASE_URL}/api/auth/login", json={
            "identifier": verified_user["username"], "password": verified_user["password"]
        })
        assert r.status_code == 200, r.text

    def test_wrong_password(self, api, verified_user):
        r = api.post(f"{BASE_URL}/api/auth/login", json={
            "identifier": verified_user["email"], "password": "WrongPassword!1"
        })
        assert r.status_code == 401, r.text
        assert "invalid" in r.text.lower()

    def test_unverified_email_blocked(self, api):
        email = _rand_email("unv")
        api.post(f"{BASE_URL}/api/auth/signup", json={
            "email": email, "password": "Str0ng!Pass2", "accepted_terms": True
        })
        r = api.post(f"{BASE_URL}/api/auth/login", json={
            "identifier": email, "password": "Str0ng!Pass2"
        })
        assert r.status_code == 403, r.text
        assert "verify" in r.text.lower()


# ---------------- Forgot / Reset ----------------
class TestForgotReset:
    def test_forgot_nonexistent_returns_200(self, api):
        r = api.post(f"{BASE_URL}/api/auth/forgot-password", json={
            "email": _rand_email("ghost")
        })
        assert r.status_code == 200, r.text

    def test_forgot_reset_full_flow(self, api):
        email = _rand_email("reset")
        old_pw = "Str0ng!Pass2"
        new_pw = "NewStr0ng!Pw"
        r = api.post(f"{BASE_URL}/api/auth/signup", json={
            "email": email, "password": old_pw, "accepted_terms": True
        })
        assert r.status_code == 200
        user = _mongo_user(email)
        vtok = user["email_verification_token"]
        v = api.post(f"{BASE_URL}/api/auth/verify-email", json={"token": vtok})
        assert v.status_code == 200
        old_session = v.json()["session_token"]

        # Ensure old session works
        me = api.get(f"{BASE_URL}/api/auth/me",
                     headers={"Authorization": f"Bearer {old_session}"})
        assert me.status_code == 200

        f = api.post(f"{BASE_URL}/api/auth/forgot-password", json={"email": email})
        assert f.status_code == 200
        user2 = _mongo_user(email)
        reset_token = user2.get("password_reset_token")
        assert reset_token, "reset token not stored"

        rr = api.post(f"{BASE_URL}/api/auth/reset-password", json={
            "token": reset_token, "new_password": new_pw
        })
        assert rr.status_code == 200, rr.text

        # Old session should be invalidated
        me2 = api.get(f"{BASE_URL}/api/auth/me",
                      headers={"Authorization": f"Bearer {old_session}"})
        assert me2.status_code == 401, "old session should have been invalidated"

        # Login with new password
        lr = api.post(f"{BASE_URL}/api/auth/login", json={
            "identifier": email, "password": new_pw
        })
        assert lr.status_code == 200, lr.text

        # Login with old password fails
        lo = api.post(f"{BASE_URL}/api/auth/login", json={
            "identifier": email, "password": old_pw
        })
        assert lo.status_code == 401, lo.text


# ---------------- Dev login (hidden) ----------------
class TestDevLogin:
    def test_missing_secret_422(self, api):
        r = api.post(f"{BASE_URL}/api/auth/dev-login", json={
            "email": "dev@andyhandy.test", "name": "Dev"
        })
        assert r.status_code == 422, r.text

    def test_wrong_secret_404(self, api):
        r = api.post(f"{BASE_URL}/api/auth/dev-login", json={
            "email": "dev@andyhandy.test", "name": "Dev", "secret": "wrong"
        })
        assert r.status_code == 404, r.text

    def test_correct_secret_200(self, api):
        r = api.post(f"{BASE_URL}/api/auth/dev-login", json={
            "email": "TEST_devcorrect@andyhandy.test", "name": "Dev",
            "secret": ANDY_DEV_SECRET
        })
        assert r.status_code == 200, r.text
        body = r.json()
        assert "session_token" in body


# ---------------- Rate limiting ----------------
class TestRateLimit:
    def test_login_rate_limit(self):
        # Use a dedicated session with a STABLE X-Forwarded-For so all 9
        # attempts land in the same per-IP rate-limit bucket regardless of
        # which pod/ingress instance handles the request.
        s = requests.Session()
        stable_xff = _fake_ip()
        s.headers.update({
            "Content-Type": "application/json",
            "X-Forwarded-For": stable_xff,
        })
        ident = _rand_email("rl")
        # 8 attempts should be allowed (return 401), 9th returns 429
        codes = []
        for _ in range(9):
            r = s.post(f"{BASE_URL}/api/auth/login", json={
                "identifier": ident, "password": "WrongPass!1"
            })
            codes.append(r.status_code)
        # 9th attempt should be 429
        assert codes[-1] == 429, f"expected 429 on 9th attempt, got {codes} (xff={stable_xff})"


# ---------------- OAuth session regression ----------------
class TestOAuthRegression:
    def test_invalid_session_id(self, api):
        r = api.post(f"{BASE_URL}/api/auth/session", json={
            "session_id": "invalid_session_xyz_" + uuid.uuid4().hex
        })
        assert r.status_code == 401, r.text


# ---------------- Dev token + jobs regression ----------------
class TestDevJobsRegression:
    def test_dev_token_lists_seeded_jobs(self, api):
        r = api.post(f"{BASE_URL}/api/auth/dev-login", json={
            "email": "TEST_devjobs@andyhandy.test", "name": "Dev Jobs",
            "secret": ANDY_DEV_SECRET
        })
        assert r.status_code == 200
        token = r.json()["session_token"]

        me = api.get(f"{BASE_URL}/api/auth/me",
                     headers={"Authorization": f"Bearer {token}"})
        assert me.status_code == 200

        jobs = api.get(f"{BASE_URL}/api/jobs",
                       headers={"Authorization": f"Bearer {token}"})
        assert jobs.status_code == 200, jobs.text
        assert len(jobs.json().get("jobs", [])) >= 4
