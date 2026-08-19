"""
Iter_10 — Verify accounting endpoints remain intact server-side even though the
UI has been hidden behind FEATURES.accountingIntegrations=false.

Spec (from review request):
  - POST /api/accounting/connect {provider:'quickbooks', enabled:true} → 200
  - GET /api/auth/me → accounting.quickbooks.enabled == true
  - POST /api/accounting/connect {provider:'quickbooks', enabled:false} → clears
  - Endpoint /api/jobs/{id}/accounting/push still responds
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://jobsite-assistant.preview.emergentagent.com").rstrip("/")
DEV_SECRET = "andy_01b0fmH1hvFa3gZFz_SDYQvVchp_t5jzBUIKz6kFH5s"


@pytest.fixture(scope="module")
def dev_token():
    email = f"acct_hidden_{int(time.time())}@andyhandy.test"
    r = requests.post(
        f"{BASE_URL}/api/auth/dev-login",
        json={"email": email, "name": "Acct Hidden", "secret": DEV_SECRET},
        timeout=30,
    )
    assert r.status_code == 200, f"dev-login failed: {r.status_code} {r.text}"
    return r.json()["session_token"]


@pytest.fixture
def auth_headers(dev_token):
    return {"Authorization": f"Bearer {dev_token}", "Content-Type": "application/json"}


# ---------------------- /api/accounting/connect ----------------------
class TestAccountingConnect:
    def test_connect_quickbooks_enabled_true(self, auth_headers):
        r = requests.post(
            f"{BASE_URL}/api/accounting/connect",
            headers=auth_headers,
            json={"provider": "quickbooks", "enabled": True},
            timeout=30,
        )
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        data = r.json()
        assert "accounting" in data
        assert data["accounting"].get("quickbooks", {}).get("enabled") is True

    def test_me_reflects_quickbooks_enabled(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=auth_headers, timeout=30)
        assert r.status_code == 200
        body = r.json()
        user = body.get("user", body)  # /auth/me wraps in {is_pro, user:{...}}
        assert user.get("accounting", {}).get("quickbooks", {}).get("enabled") is True

    def test_connect_quickbooks_enabled_false_clears(self, auth_headers):
        r = requests.post(
            f"{BASE_URL}/api/accounting/connect",
            headers=auth_headers,
            json={"provider": "quickbooks", "enabled": False},
            timeout=30,
        )
        assert r.status_code == 200
        data = r.json()
        # Either the flag is False or the provider entry is removed — both are acceptable "clears".
        qb = data.get("accounting", {}).get("quickbooks") or {}
        assert qb.get("enabled") in (False, None)

    def test_me_reflects_cleared(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=auth_headers, timeout=30)
        assert r.status_code == 200
        body = r.json()
        user = body.get("user", body)
        qb = user.get("accounting", {}).get("quickbooks") or {}
        assert qb.get("enabled") in (False, None)

    def test_connect_square_enabled_true(self, auth_headers):
        r = requests.post(
            f"{BASE_URL}/api/accounting/connect",
            headers=auth_headers,
            json={"provider": "square", "enabled": True},
            timeout=30,
        )
        assert r.status_code == 200
        assert r.json()["accounting"]["square"]["enabled"] is True


# ---------------------- /api/jobs/{id}/accounting/push ----------------------
class TestAccountingPush:
    def test_push_endpoint_responds(self, auth_headers):
        # Seeded jobs auto-provision on first GET.
        r = requests.get(f"{BASE_URL}/api/jobs", headers=auth_headers, timeout=30)
        assert r.status_code == 200
        jobs = r.json().get("jobs", [])
        assert len(jobs) > 0, "expected seeded jobs"

        # Find or create a closed job — the push endpoint only accepts closed jobs.
        closed = next((j for j in jobs if j.get("status") == "closed"), None)
        if not closed:
            # Force one closed via PATCH.
            target = jobs[0]
            r2 = requests.patch(
                f"{BASE_URL}/api/jobs/{target['job_id']}",
                headers=auth_headers,
                json={"status": "closed"},
                timeout=30,
            )
            assert r2.status_code == 200
            closed = r2.json()["job"]

        r3 = requests.post(
            f"{BASE_URL}/api/jobs/{closed['job_id']}/accounting/push",
            headers=auth_headers,
            timeout=30,
        )
        # Endpoint must still exist. 200 = pushed; 400 = validation (still routed).
        # Any 404 would indicate the route was deleted, which is what we are guarding against.
        assert r3.status_code in (200, 400), f"push endpoint gone: {r3.status_code} {r3.text}"
        if r3.status_code == 200:
            body = r3.json()
            assert "subtotal" in body

    def test_push_endpoint_rejects_non_closed(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/jobs", headers=auth_headers, timeout=30)
        jobs = r.json().get("jobs", [])
        open_job = next((j for j in jobs if j.get("status") != "closed"), None)
        if not open_job:
            pytest.skip("all seeded jobs closed")
        r2 = requests.post(
            f"{BASE_URL}/api/jobs/{open_job['job_id']}/accounting/push",
            headers=auth_headers,
            timeout=30,
        )
        assert r2.status_code == 400
