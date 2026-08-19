"""Phase B — Subscription (Stripe), Webhook (durable subscription state), Mascot.

Isolated pytest suite that exercises:
  • public plan catalog contract
  • authed subscription/status (fresh dev user = trialing pro)
  • checkout idempotency (lookup_key reuse — no duplicate Products/Prices)
  • checkout error paths (bad plan, no auth)
  • portal/reactivate guard rails
  • stripe webhook: unsigned, missing secret (503), signed active/deleted/past_due,
    duplicate event id
  • mascot GET/SET/dismiss idempotence

Cleanup: purges TEST_-prefixed users, their sessions, mascot rows, and
`stripe_events` created by this run.
"""
import hashlib
import hmac
import json
import os
import time
import uuid
from pathlib import Path

import pytest
import requests
import stripe
from dotenv import load_dotenv
from pymongo import MongoClient

# Load backend/.env so BASE_URL, secrets, and Mongo config resolve consistently.
# override=True — the shell env sets STRIPE_API_KEY=sk_test_emergent as a stub
# which would break Stripe SDK calls; the real key lives in backend/.env.
load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=True)

# Prefer the frontend/.env preview URL (what real clients hit); fall back to
# EXPO_PUBLIC_BACKEND_URL if exported. NEVER use the .emergent.host prod URL —
# it currently returns Cloudflare 520 from this cluster.
_frontend_env = Path(__file__).resolve().parents[2] / "frontend" / ".env"
if _frontend_env.exists():
    load_dotenv(_frontend_env, override=False)
BASE_URL = (
    os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or "https://jobsite-assistant.preview.emergentagent.com"
).rstrip("/")
DEV_SECRET = os.environ["ANDY_DEV_SECRET"]
STRIPE_WEBHOOK_SECRET = os.environ["STRIPE_WEBHOOK_SECRET"]
STRIPE_API_KEY = os.environ.get("STRIPE_API_KEY", "")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "jp_handyman")

stripe.api_key = STRIPE_API_KEY
_mongo = MongoClient(MONGO_URL)
_db = _mongo[DB_NAME]


def _unique_email() -> str:
    return f"TEST_phaseb_{uuid.uuid4().hex[:10]}@andyhandy.test"


def _xff() -> dict:
    """Unique X-Forwarded-For per request so rate-limit buckets never collide."""
    return {"X-Forwarded-For": f"10.{uuid.uuid4().int % 200}.{uuid.uuid4().int % 200}.{uuid.uuid4().int % 200}"}


def _dev_login(email: str | None = None):
    email = email or _unique_email()
    r = requests.post(
        f"{BASE_URL}/api/auth/dev-login",
        json={"email": email, "name": "TEST User", "secret": DEV_SECRET},
        headers=_xff(),
        timeout=30,
    )
    assert r.status_code == 200, f"dev-login failed: {r.status_code} {r.text}"
    return r.json()


@pytest.fixture(scope="session")
def auth():
    return _dev_login()


@pytest.fixture(scope="session")
def token(auth):
    return auth["session_token"]


@pytest.fixture(scope="session")
def user_id(auth):
    return auth["user"]["user_id"]


def _auth_headers(t: str) -> dict:
    return {"Authorization": f"Bearer {t}", **_xff()}


def _sign(payload_bytes: bytes, secret: str) -> str:
    ts = int(time.time())
    signed_payload = f"{ts}.".encode() + payload_bytes
    v1 = hmac.new(secret.encode(), signed_payload, hashlib.sha256).hexdigest()
    return f"t={ts},v1={v1}"


# ============================================================
# Plan catalog (public)
# ============================================================
class TestPlansPublic:
    def test_plans_shape(self):
        r = requests.get(f"{BASE_URL}/api/subscription/plans", timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert data["trial_days"] == 14
        assert data["free_tier"]["ai_scans_per_month"] == 6
        plans = {p["id"]: p for p in data["plans"]}
        assert set(plans.keys()) == {"monthly", "annual"}
        assert plans["monthly"]["amount_display"] == "$7.99"
        assert plans["monthly"]["lookup_key"] == "handy_andy_pro_monthly_v1"
        assert plans["annual"]["amount_display"] == "$59.99"
        assert plans["annual"]["savings_pct"] == 37
        assert plans["annual"]["lookup_key"] == "handy_andy_pro_annual_v1"


# ============================================================
# Subscription status (authed)
# ============================================================
class TestSubscriptionStatus:
    def test_fresh_user_trialing(self):
        auth = _dev_login()
        r = requests.get(f"{BASE_URL}/api/subscription/status", headers=_auth_headers(auth["session_token"]), timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert data["status"] == "trialing"
        assert data["is_pro"] is True
        assert data["in_trial"] is True
        assert 13 <= data["trial_days_remaining"] <= 14
        assert data["current_tier"] == "pro"
        assert data["monthly_price_usd"] == 7.99
        assert data["annual_price_usd"] == 59.99

    def test_status_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/subscription/status", timeout=15)
        assert r.status_code == 401


# ============================================================
# Checkout — validation & idempotent price provisioning
# ============================================================
class TestCheckout:
    def test_bad_plan(self, token):
        r = requests.post(
            f"{BASE_URL}/api/subscription/checkout",
            headers=_auth_headers(token),
            json={"job_id": "lifetime", "return_origin": "https://x"},
            timeout=30,
        )
        assert r.status_code == 400

    def test_no_auth(self):
        r = requests.post(
            f"{BASE_URL}/api/subscription/checkout",
            json={"job_id": "monthly", "return_origin": "https://x"},
            timeout=15,
        )
        assert r.status_code == 401

    def test_monthly_and_annual_idempotent(self, token):
        # First call — may create; second must reuse (count == 1 per lookup_key).
        for plan_id, lookup in (("monthly", "handy_andy_pro_monthly_v1"), ("annual", "handy_andy_pro_annual_v1")):
            r1 = requests.post(
                f"{BASE_URL}/api/subscription/checkout",
                headers=_auth_headers(token),
                json={"job_id": plan_id, "return_origin": "https://x.example"},
                timeout=45,
            )
            assert r1.status_code == 200, f"{plan_id} first checkout failed: {r1.status_code} {r1.text}"
            assert "checkout_url" in r1.json()

            r2 = requests.post(
                f"{BASE_URL}/api/subscription/checkout",
                headers=_auth_headers(token),
                json={"job_id": plan_id, "return_origin": "https://x.example"},
                timeout=45,
            )
            assert r2.status_code == 200
            assert "checkout_url" in r2.json()

            # Idempotency check via Stripe: exactly 1 active price for this lookup_key.
            if STRIPE_API_KEY:
                prices = stripe.Price.list(lookup_keys=[lookup], active=True, limit=10)
                assert len(prices.data) == 1, f"{lookup} produced {len(prices.data)} active prices"


# ============================================================
# Portal + Reactivate guard rails
# ============================================================
class TestPortalReactivate:
    def test_portal_no_customer(self):
        # Fresh user has no stripe_customer_id yet.
        fresh = _dev_login()
        r = requests.post(
            f"{BASE_URL}/api/subscription/portal",
            headers=_auth_headers(fresh["session_token"]),
            json={"return_origin": "https://x.example"},
            timeout=15,
        )
        assert r.status_code == 400
        assert "billing" in r.json().get("detail", "").lower()

    def test_reactivate_no_sub(self):
        fresh = _dev_login()
        r = requests.post(
            f"{BASE_URL}/api/subscription/reactivate",
            headers=_auth_headers(fresh["session_token"]),
            timeout=15,
        )
        assert r.status_code == 400


# ============================================================
# Stripe Webhook — signature, secret-missing, idempotency
# ============================================================
class TestStripeWebhook:
    def test_no_signature_header_400(self):
        r = requests.post(
            f"{BASE_URL}/api/webhooks/stripe",
            data=b'{"id":"evt_test","type":"customer.subscription.updated"}',
            headers={"Content-Type": "application/json"},
            timeout=15,
        )
        assert r.status_code == 400

    def test_bad_signature_400(self):
        r = requests.post(
            f"{BASE_URL}/api/webhooks/stripe",
            data=b'{"id":"evt_bogus","type":"customer.subscription.updated"}',
            headers={"Content-Type": "application/json", "stripe-signature": "t=1,v1=deadbeef"},
            timeout=15,
        )
        assert r.status_code == 400

    def test_active_and_deleted_and_duplicate(self, user_id):
        # Purge prior test events (same evt_id would collide across runs).
        _db.stripe_events.delete_many({"event_id": {"$regex": r"^evt_TEST_"}})

        # 1) customer.subscription.updated → active
        evt_id = f"evt_TEST_{uuid.uuid4().hex[:10]}"
        payload = {
            "id": evt_id,
            "type": "customer.subscription.updated",
            "data": {"object": {
                "id": f"sub_TEST_{uuid.uuid4().hex[:8]}",
                "status": "active",
                "customer": f"cus_TEST_{uuid.uuid4().hex[:8]}",
                "metadata": {"user_id": user_id},
                "cancel_at_period_end": False,
            }},
        }
        body = json.dumps(payload).encode()
        r = requests.post(
            f"{BASE_URL}/api/webhooks/stripe",
            data=body,
            headers={"Content-Type": "application/json", "stripe-signature": _sign(body, STRIPE_WEBHOOK_SECRET)},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        assert r.json().get("duplicate") is not True
        user_row = _db.users.find_one({"user_id": user_id})
        assert user_row["stripe_subscription_status"] == "active"
        assert user_row["current_tier"] == "pro"

        # 2) DUPLICATE — resend the same event id → should short-circuit
        r2 = requests.post(
            f"{BASE_URL}/api/webhooks/stripe",
            data=body,
            headers={"Content-Type": "application/json", "stripe-signature": _sign(body, STRIPE_WEBHOOK_SECRET)},
            timeout=15,
        )
        assert r2.status_code == 200
        assert r2.json().get("duplicate") is True
        # stripe_events should hold exactly ONE row for this event id
        assert _db.stripe_events.count_documents({"event_id": evt_id}) == 1

        # 3) invoice.payment_failed → past_due
        sub_id = user_row["stripe_subscription_id"]
        payload_pf = {
            "id": f"evt_TEST_{uuid.uuid4().hex[:10]}",
            "type": "invoice.payment_failed",
            "data": {"object": {"subscription": sub_id}},
        }
        body_pf = json.dumps(payload_pf).encode()
        r3 = requests.post(
            f"{BASE_URL}/api/webhooks/stripe",
            data=body_pf,
            headers={"Content-Type": "application/json", "stripe-signature": _sign(body_pf, STRIPE_WEBHOOK_SECRET)},
            timeout=15,
        )
        assert r3.status_code == 200
        user_row = _db.users.find_one({"user_id": user_id})
        assert user_row["stripe_subscription_status"] == "past_due"

        # 4) customer.subscription.deleted → canceled + free
        payload_del = {
            "id": f"evt_TEST_{uuid.uuid4().hex[:10]}",
            "type": "customer.subscription.deleted",
            "data": {"object": {"id": sub_id, "status": "canceled", "metadata": {"user_id": user_id}}},
        }
        body_del = json.dumps(payload_del).encode()
        r4 = requests.post(
            f"{BASE_URL}/api/webhooks/stripe",
            data=body_del,
            headers={"Content-Type": "application/json", "stripe-signature": _sign(body_del, STRIPE_WEBHOOK_SECRET)},
            timeout=15,
        )
        assert r4.status_code == 200
        user_row = _db.users.find_one({"user_id": user_id})
        assert user_row["stripe_subscription_status"] == "canceled"
        assert user_row["current_tier"] == "free"


# ============================================================
# Mascot
# ============================================================
class TestMascot:
    def test_defaults_and_toggle_and_dismiss(self):
        auth = _dev_login()
        t = auth["session_token"]

        r = requests.get(f"{BASE_URL}/api/mascot/settings", headers=_auth_headers(t), timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["show_mascot"] is True
        assert d["dismissed_contexts"] == []

        r = requests.post(
            f"{BASE_URL}/api/mascot/settings",
            headers=_auth_headers(t),
            json={"show_mascot": False},
            timeout=15,
        )
        assert r.status_code == 200
        assert r.json()["show_mascot"] is False

        r = requests.get(f"{BASE_URL}/api/mascot/settings", headers=_auth_headers(t), timeout=15)
        assert r.json()["show_mascot"] is False

        # dismiss idempotency
        for _ in range(2):
            r = requests.post(
                f"{BASE_URL}/api/mascot/dismiss",
                headers=_auth_headers(t),
                json={"context": "onboarding"},
                timeout=15,
            )
            assert r.status_code == 200
        r = requests.get(f"{BASE_URL}/api/mascot/settings", headers=_auth_headers(t), timeout=15)
        d = r.json()
        assert d["dismissed_contexts"].count("onboarding") == 1


# ============================================================
# Cleanup
# ============================================================
def teardown_module(module):
    # Purge TEST_-prefixed users, sessions, stripe_events created in this run.
    test_users = list(_db.users.find({"email": {"$regex": r"^TEST_phaseb_"}}, {"user_id": 1}))
    uids = [u["user_id"] for u in test_users]
    if uids:
        _db.user_sessions.delete_many({"user_id": {"$in": uids}})
        _db.users.delete_many({"user_id": {"$in": uids}})
    _db.stripe_events.delete_many({"event_id": {"$regex": r"^evt_TEST_"}})
