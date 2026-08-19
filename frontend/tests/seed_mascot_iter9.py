"""Seed helper for iter9 mascot dismissal-race regression test.
Dev-logins a fresh user, sets `customer_approved_at` on the first seeded job,
prints TOKEN + JOB_ID for the playwright script to consume.
"""
import os
import sys
import time
import requests
from pymongo import MongoClient

BASE = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/") if "EXPO_PUBLIC_BACKEND_URL" in os.environ else "https://jobsite-assistant.preview.emergentagent.com"
SECRET = "andy_01b0fmH1hvFa3gZFz_SDYQvVchp_t5jzBUIKz6kFH5s"
EMAIL = f"mascot_iter9_{int(time.time())}@andyhandy.test"

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

def _read_env(path):
    d = {}
    with open(path) as f:
        for ln in f:
            if "=" in ln and not ln.strip().startswith("#"):
                k, v = ln.strip().split("=", 1)
                d[k] = v.strip('"').strip("'")
    return d

# fallback: read backend .env for MONGO_URL/DB_NAME
try:
    be = _read_env("/app/backend/.env")
    MONGO_URL = be.get("MONGO_URL", MONGO_URL)
    DB_NAME = be.get("DB_NAME", DB_NAME)
except Exception:
    pass


def main():
    r = requests.post(f"{BASE}/api/auth/dev-login", json={"email": EMAIL, "name": "Iter9 Mascot", "secret": SECRET}, timeout=20)
    r.raise_for_status()
    tok = r.json()["session_token"]
    print("TOKEN=", tok)

    # trigger seed
    r = requests.get(f"{BASE}/api/jobs", headers={"Authorization": f"Bearer {tok}"}, timeout=20)
    r.raise_for_status()
    jobs = r.json()["jobs"]
    print(f"seeded {len(jobs)} jobs")
    target = jobs[0]
    print("JOB_ID=", target["job_id"])
    print("TITLE=", target["title"])

    # patch to add customer_approved_at
    cli = MongoClient(MONGO_URL)
    db = cli[DB_NAME]
    res = db.jobs.update_one({"job_id": target["job_id"]}, {"$set": {"customer_approved_at": "2026-01-15T10:00:00Z"}})
    print("PATCHED=", res.modified_count)
    # verify
    doc = db.jobs.find_one({"job_id": target["job_id"]})
    print("customer_approved_at=", doc.get("customer_approved_at"))


if __name__ == "__main__":
    main()
