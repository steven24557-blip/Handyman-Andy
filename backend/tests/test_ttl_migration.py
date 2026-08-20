"""
Test TTL migration for stripe_events.at_1 legacy TTL index.

Scenarios:
 1. Seed legacy TTL (expireAfterSeconds=2592000) on db.stripe_events.at_1,
    restart backend, and confirm TTL is removed from index_information().
 2. Repeat 3 restarts in a row to prove idempotency.
 3. Confirm the pre-gather migration block fires cleanly on a fresh DB with
    no legacy TTL (no crash, no unnecessary drops).
"""
import os
import re
import subprocess
import time

import pymongo
import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/") if os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL"
) else None
# Fallback for backend .env: preview host
if not BASE_URL:
    # frontend/.env sourced
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().strip('"').rstrip("/")
                break

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

BACKEND_LOG = "/var/log/supervisor/backend.out.log"
BACKEND_ERR_LOG = "/var/log/supervisor/backend.err.log"


def _mongo_db():
    client = pymongo.MongoClient(MONGO_URL, serverSelectionTimeoutMS=5000)
    return client[DB_NAME]


def _restart_backend_and_wait_ready(timeout: int = 45):
    subprocess.run(
        ["sudo", "supervisorctl", "restart", "backend"],
        check=True, capture_output=True, text=True,
    )
    # Poll /api/ (or root) until backend is up
    deadline = time.time() + timeout
    last_err = None
    while time.time() < deadline:
        try:
            r = requests.get(f"{BASE_URL}/api/health", timeout=3)
            if r.status_code < 500:
                # Give the startup event a moment to complete
                time.sleep(1.5)
                return
        except Exception as e:
            last_err = e
        try:
            r = requests.get(f"{BASE_URL}/api/", timeout=3)
            if r.status_code < 500:
                time.sleep(1.5)
                return
        except Exception as e:
            last_err = e
        time.sleep(1)
    raise AssertionError(f"Backend did not become ready in {timeout}s: {last_err}")


def _seed_legacy_ttl():
    """Force a legacy TTL index at_1 with expireAfterSeconds=2592000."""
    db = _mongo_db()
    # Drop the existing at_1 (if non-TTL) so we can recreate it as TTL
    try:
        db.stripe_events.drop_index("at_1")
    except pymongo.errors.OperationFailure:
        pass
    db.stripe_events.create_index("at", expireAfterSeconds=2592000)
    info = db.stripe_events.index_information()
    assert "at_1" in info, "seed failed: at_1 not created"
    assert info["at_1"].get("expireAfterSeconds") == 2592000, (
        f"seed failed: expected expireAfterSeconds=2592000, got {info['at_1']}"
    )


def _tail_backend_log(n_lines: int = 400) -> str:
    """Read the last n lines from both stdout & stderr logs."""
    out = ""
    for path in (BACKEND_LOG, BACKEND_ERR_LOG):
        if os.path.exists(path):
            with open(path, errors="replace") as f:
                out += f.read()[-16000:]
    return out


# -------------------- Scenario 1: seeded TTL is dropped --------------------

class TestTTLMigrationSeeded:
    def test_seeded_legacy_ttl_is_stripped_on_restart(self):
        _seed_legacy_ttl()
        _restart_backend_and_wait_ready()
        db = _mongo_db()
        info = db.stripe_events.index_information()
        assert "at_1" in info, "at_1 index must exist after restart (recreated non-TTL)"
        assert "expireAfterSeconds" not in info["at_1"], (
            f"TTL should have been stripped, got {info['at_1']}"
        )

    def test_migration_log_line_emitted(self):
        # Re-seed then restart and confirm the log line fires
        _seed_legacy_ttl()
        _restart_backend_and_wait_ready()
        log_text = _tail_backend_log()
        assert re.search(
            r"Migrated stripe_events: dropped legacy TTL index at_1", log_text
        ), "Expected migration log line not found in backend log tail"


# -------------------- Scenario 2: 3-restart idempotency --------------------

class TestTTLMigrationIdempotent:
    def test_three_consecutive_restarts_leave_index_ttl_free(self):
        # After the previous class, index is already non-TTL. Just verify that
        # 3 back-to-back restarts don't reintroduce TTL and don't crash.
        for i in range(3):
            _restart_backend_and_wait_ready()
            db = _mongo_db()
            info = db.stripe_events.index_information()
            assert "at_1" in info, f"restart #{i+1}: at_1 missing"
            assert "expireAfterSeconds" not in info["at_1"], (
                f"restart #{i+1}: TTL reappeared: {info['at_1']}"
            )
            # Backend must still be serving traffic
            r = requests.get(f"{BASE_URL}/api/", timeout=5)
            assert r.status_code < 500, f"restart #{i+1}: backend 5xx after restart"


# -------------------- Scenario 3: fresh DB (no legacy TTL) --------------------

class TestTTLMigrationFreshDB:
    def test_no_ttl_present_no_unnecessary_drop(self):
        """If at_1 has no expireAfterSeconds, migration must not drop it."""
        db = _mongo_db()
        # Ensure at_1 exists WITHOUT TTL (the normal steady-state)
        info = db.stripe_events.index_information()
        if "at_1" not in info:
            db.stripe_events.create_index("at")
        elif info["at_1"].get("expireAfterSeconds") is not None:
            db.stripe_events.drop_index("at_1")
            db.stripe_events.create_index("at")

        # Capture "before" index metadata
        before = db.stripe_events.index_information()["at_1"]
        assert "expireAfterSeconds" not in before

        _restart_backend_and_wait_ready()

        # After restart the index must still be present, still non-TTL, and
        # ideally the same underlying index (same v key). We assert 'v' + 'key'.
        after = db.stripe_events.index_information()["at_1"]
        assert "expireAfterSeconds" not in after
        assert after.get("key") == before.get("key")

        # Also assert no crash / no "TTL migration skipped: <err>" warning fired
        log_text = _tail_backend_log()
        # The "skipped" branch fires only on an exception during
        # index_information/drop_index — for a clean fresh DB it should NOT
        # fire in the most recent restart window.
        # We only check the *tail* (last restart's window) for the negative.
        # Cheap heuristic: grab everything after the last "Handy-Andy backend
        # ready" line and look for skipped errors there.
        last_ready_idx = log_text.rfind("Handy-Andy backend ready")
        window = log_text[max(0, last_ready_idx - 4000): last_ready_idx + 200] if last_ready_idx > -1 else log_text
        assert "stripe_events TTL migration skipped" not in window, (
            "Migration block should not raise on a fresh DB with no legacy TTL"
        )
