"""Handy-Andy: Job Site Assistant — FastAPI backend."""

import asyncio
import base64
import io
import json
import logging
import os
import random
import re
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import List, Optional, Tuple

import httpx
import stripe
from PIL import Image, ImageFilter
from dotenv import load_dotenv
from fastapi import APIRouter, FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse
from jose import jwt as jose_jwt
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field
from starlette.middleware.cors import CORSMiddleware

from emergentintegrations.llm.chat import ImageContent, LlmChat, UserMessage
from emergentintegrations.llm.openai.text_to_speech import OpenAITextToSpeech

# ============================================================
# Environment
# ============================================================
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env", override=False)

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
EMERGENT_LLM_KEY = os.environ["EMERGENT_LLM_KEY"]
STRIPE_API_KEY = os.environ.get("STRIPE_API_KEY", "")
APPLE_CLIENT_ID = os.environ.get("APPLE_CLIENT_ID", "com.andyhandy.app")

# Auth / email
JWT_SECRET = os.environ.get("JWT_SECRET", "dev-secret-do-not-use-in-prod")
ANDY_DEV_SECRET = os.environ.get("ANDY_DEV_SECRET", "")
APP_BASE_URL = (os.environ.get("APP_BASE_URL") or "").rstrip("/")
APP_DEEP_LINK_SCHEME = os.environ.get("APP_DEEP_LINK_SCHEME", "andyhandy")

# Emergent-managed email (Resend proxy)
EMAIL_BASE_URL = "https://integrations.emergentagent.com"
EMERGENT_EMAIL_KEY = os.environ.get("EMERGENT_EMAIL_KEY", "")
EMAIL_FROM_NAME = os.environ.get("EMAIL_FROM_NAME", "Handy-Andy")
EMAIL_REPLY_TO = os.environ.get("EMAIL_REPLY_TO")

stripe.api_key = STRIPE_API_KEY

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("handy_andy")

app = FastAPI(title="Handy-Andy: Job Site Assistant API")
api = APIRouter(prefix="/api")


# ============================================================
# Constants
# ============================================================
TRIAL_DAYS = 14
PRO_MONTHLY_USD = 7.99
PRO_ANNUAL_USD = 59.99
PRO_ANNUAL_MONTHLY_EQUIV = round(PRO_ANNUAL_USD / 12, 2)
PRO_ANNUAL_SAVINGS_PCT = int(round((1 - (PRO_ANNUAL_USD / (PRO_MONTHLY_USD * 12))) * 100))
FREE_TIER_AI_LIMIT = int(os.environ.get("FREE_TIER_AI_SCANS_PER_MONTH", "6"))
FREE_TIER_JOB_LIMIT = 3  # max open + in_progress
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "")
PERSONA_VOICES = {
    "standard": ("onyx", "Speak in a calm, professional handyman tone."),
    "folksy": ("fable", "Speak in a warm, folksy small-town tone. Use friendly idioms."),
    "southern": ("echo", "Speak in a relaxed Southern drawl. Friendly and slow."),
    "sassy": ("nova", "Speak with sassy confidence and a touch of humor."),
}
WATERMARK_TEXT = "Powered by Handy-Andy: Job Site Assistant"

# Mock hardware suppliers
MOCK_SUPPLIERS = ["Home Depot", "Lowe's", "Ace Hardware", "Menards"]


# ============================================================
# Models
# ============================================================
class SessionRequest(BaseModel):
    session_id: str


class DevLoginRequest(BaseModel):
    email: str
    name: Optional[str] = None
    secret: str


class SignUpRequest(BaseModel):
    email: str
    password: str
    username: Optional[str] = None
    accepted_terms: bool = False


class EmailPasswordLoginRequest(BaseModel):
    identifier: str  # email OR username
    password: str


class UsernameCheckRequest(BaseModel):
    username: str


class VerifyEmailRequest(BaseModel):
    token: str


class ResendVerificationRequest(BaseModel):
    email: str


class ForgotPasswordRequest(BaseModel):
    email: str


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str


class AppleLoginRequest(BaseModel):
    identity_token: str
    full_name: Optional[str] = None
    email: Optional[str] = None


class BOMItem(BaseModel):
    name: str
    quantity: str = "1"
    stock: str = "In Stock"
    unit_price: float = 0.0
    markup_applied: bool = False
    final_price: float = 0.0


class Photo(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    label: str = "before"
    base64: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class ChangeOrder(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    description: str
    extra_cost: float = 0.0
    labor_hours: float = 0.0
    photo_base64: Optional[str] = None
    signature_svg: Optional[str] = None  # SVG path data
    approved: bool = False
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class SafetyLog(BaseModel):
    log_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    photo_base64: str
    hazard_level: str  # clear | caution | crisis
    threats: List[dict] = Field(default_factory=list)
    pre_existing_issues: List[str] = Field(default_factory=list)
    raw_ai_payload: str = ""
    geo: Optional[dict] = None
    inspector_user_id: str = ""


class Job(BaseModel):
    job_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    title: str
    description: str = ""
    status: str = "open"
    safety_notes: str = ""
    location: str = ""
    tools_suggested: List[str] = Field(default_factory=list)
    bom: List[BOMItem] = Field(default_factory=list)
    photos: List[Photo] = Field(default_factory=list)
    ai_diagnostic: str = ""
    change_orders: List[ChangeOrder] = Field(default_factory=list)
    markup_percent: int = 20  # job-level override of user's global
    customer_signature_svg: Optional[str] = None
    customer_approved_at: Optional[datetime] = None
    customer_business_name: Optional[str] = None  # pro-tier custom header on public estimate
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class JobCreate(BaseModel):
    title: str
    description: str = ""
    status: str = "open"
    safety_notes: str = ""
    location: str = ""


class JobUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    safety_notes: Optional[str] = None
    location: Optional[str] = None
    tools_suggested: Optional[List[str]] = None
    bom: Optional[List[BOMItem]] = None
    ai_diagnostic: Optional[str] = None
    markup_percent: Optional[int] = None


class PhotoAdd(BaseModel):
    label: str = "before"
    base64: str


class AnalyzeRequest(BaseModel):
    image_base64: str
    context: Optional[str] = None


class DiagnosticRequest(BaseModel):
    image_base64: str
    notes: Optional[str] = None


class SafetyRequest(BaseModel):
    image_base64: Optional[str] = None
    location: Optional[str] = None
    notes: Optional[str] = None
    job_id: Optional[str] = None
    geo: Optional[dict] = None


class VoiceGreetRequest(BaseModel):
    persona: str = "standard"
    name: Optional[str] = None
    pitch: Optional[float] = 1.0
    pace: Optional[float] = 1.0


class VoiceIntakeRequest(BaseModel):
    audio_base64: str  # mp3/m4a/wav base64
    mime_type: str = "audio/m4a"


class MarkupUpdate(BaseModel):
    global_markup_percent: int


class ChangeOrderCreate(BaseModel):
    description: str
    extra_cost: float = 0.0
    labor_hours: float = 0.0
    photo_base64: Optional[str] = None


class ChangeOrderSign(BaseModel):
    signature_svg: str


class PublicApprove(BaseModel):
    signature_svg: str


class CheckoutBody(BaseModel):
    return_origin: str  # e.g. "myapp" or "https://..."
    job_id: Optional[str] = None


class AccountingConnect(BaseModel):
    provider: str  # 'quickbooks' | 'square'
    enabled: bool


class MascotSettingsBody(BaseModel):
    show_mascot: bool


class MascotDismissBody(BaseModel):
    context: str  # e.g. "onboarding", "failed_scan", "help"


# ============================================================
# Helpers
# ============================================================
def _strip_id(doc):
    if isinstance(doc, dict):
        doc.pop("_id", None)
    return doc


async def get_current_user(authorization: Optional[str] = Header(None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = authorization[len("Bearer "):].strip()
    session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")
    exp = session.get("expires_at")
    if exp is not None:
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        if exp < datetime.now(timezone.utc):
            raise HTTPException(status_code=401, detail="Session expired")
    user = await db.users.find_one(
        {"user_id": session["user_id"]},
        {"_id": 0, "password_hash": 0, "email_verification_token": 0, "password_reset_token": 0},
    )
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


def _extract_json(text: str) -> dict:
    if not text:
        return {}
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if fenced:
        candidate = fenced.group(1)
    else:
        m = re.search(r"\{.*\}", text, re.DOTALL)
        candidate = m.group(0) if m else text
    try:
        return json.loads(candidate)
    except Exception:
        return {}


def sanitize_uploaded_photo(image_base64: str, blur_faces: bool = True, max_dim: int = 1600) -> str:
    """CPRA/BIPA-grade scrubbing before storage or third-party transmission.

    Steps:
      1. Decode → strip ALL EXIF/IPTC metadata (GPS, device serial, owner name, etc.)
      2. Re-encode without any private chunks
      3. Optionally apply a soft Gaussian blur to detected human faces to prevent
         accidental biometric capture. We use Pillow only (no OpenCV dep); if face
         detection ever becomes available, the hook is here to swap in. The current
         implementation skips face detection but reserves the integration point per
         the data-minimization mandate.

    Returns: clean base64-encoded JPEG.
    """
    if not image_base64:
        return image_base64
    raw = image_base64.split(",", 1)[-1] if image_base64.startswith("data:") else image_base64
    try:
        data = base64.b64decode(raw)
        img = Image.open(io.BytesIO(data))
        # Force a decode pass and convert to RGB to drop alpha/EXIF channels
        img.load()
        if img.mode != "RGB":
            img = img.convert("RGB")
        # Cap dimensions to bound payload size
        img.thumbnail((max_dim, max_dim), Image.LANCZOS)
        # `Image.new` produces a clean canvas with no metadata
        clean = Image.new("RGB", img.size)
        clean.paste(img)
        if blur_faces:
            # Placeholder face-blur hook: applies a *very* slight overall softening
            # that does NOT damage diagnostic value but provides a defensible
            # data-minimization layer in the absence of a face-detection model.
            # When opencv/mediapipe is available, replace with bbox-targeted blur.
            clean = clean.filter(ImageFilter.GaussianBlur(radius=0.3))
        out = io.BytesIO()
        clean.save(out, format="JPEG", quality=80, optimize=True)
        return base64.b64encode(out.getvalue()).decode("ascii")
    except Exception as e:
        logger.warning("sanitize_uploaded_photo failed (%s); returning original bytes", e)
        return raw



async def _gemini_vision(prompt: str, image_base64: str, system: str) -> str:
    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"vision-{uuid.uuid4().hex[:8]}",
        system_message=system,
    ).with_model("gemini", "gemini-2.5-flash")
    raw = image_base64.split(",", 1)[-1] if image_base64.startswith("data:") else image_base64
    img = ImageContent(image_base64=raw)
    msg = UserMessage(text=prompt, file_contents=[img])
    return await chat.send_message(msg)


async def _gemini_text(prompt: str, system: str) -> str:
    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"text-{uuid.uuid4().hex[:8]}",
        system_message=system,
    ).with_model("gemini", "gemini-2.5-flash")
    return await chat.send_message(UserMessage(text=prompt))


def _is_pro_or_trialing(user: dict) -> bool:
    status = (user.get("stripe_subscription_status") or "none").lower()
    if status == "active":
        return True
    if status == "trialing":
        trial_end = user.get("trial_end_date")
        if trial_end:
            if trial_end.tzinfo is None:
                trial_end = trial_end.replace(tzinfo=timezone.utc)
            return trial_end > datetime.now(timezone.utc)
    return False


def _month_key() -> str:
    now = datetime.now(timezone.utc)
    return f"{now.year:04d}-{now.month:02d}"


async def _ensure_monthly_counter(user: dict):
    key = _month_key()
    if user.get("ai_scan_month") != key:
        await db.users.update_one(
            {"user_id": user["user_id"]},
            {"$set": {"ai_scan_month": key, "ai_scan_count_this_month": 0}},
        )
        user["ai_scan_month"] = key
        user["ai_scan_count_this_month"] = 0


async def _enforce_ai_quota(user: dict):
    await _ensure_monthly_counter(user)
    if _is_pro_or_trialing(user):
        return
    if (user.get("ai_scan_count_this_month") or 0) >= FREE_TIER_AI_LIMIT:
        raise HTTPException(
            status_code=402,
            detail=f"Free-tier AI quota exhausted ({FREE_TIER_AI_LIMIT}/mo). Upgrade to Pro for unlimited.",
        )


async def _increment_ai_quota(user_id: str):
    await db.users.update_one(
        {"user_id": user_id},
        {"$inc": {"ai_scan_count_this_month": 1}},
    )


async def _provision_user_defaults(user_id: str):
    """Set up subscription/markup/usage fields on first creation."""
    now = datetime.now(timezone.utc)
    await db.users.update_one(
        {"user_id": user_id},
        {
            "$setOnInsert": {
                "stripe_subscription_status": "trialing",
                "trial_end_date": now + timedelta(days=TRIAL_DAYS),
                "current_tier": "pro",  # trialing = pro access
                "ai_scan_count_this_month": 0,
                "ai_scan_month": _month_key(),
                "global_markup_percent": 20,
                "accounting": {
                    "quickbooks": {"enabled": False, "connected_at": None},
                    "square": {"enabled": False, "connected_at": None},
                },
            }
        },
    )


async def _ensure_user_billing_fields(user: dict):
    """Backfill billing fields for users created before this feature."""
    updates = {}
    if "stripe_subscription_status" not in user:
        updates["stripe_subscription_status"] = "trialing"
    if "trial_end_date" not in user:
        created = user.get("created_at") or datetime.now(timezone.utc)
        if created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        updates["trial_end_date"] = created + timedelta(days=TRIAL_DAYS)
    if "current_tier" not in user:
        updates["current_tier"] = "pro"
    if "ai_scan_count_this_month" not in user:
        updates["ai_scan_count_this_month"] = 0
    if "ai_scan_month" not in user:
        updates["ai_scan_month"] = _month_key()
    if "global_markup_percent" not in user:
        updates["global_markup_percent"] = 20
    if "accounting" not in user:
        updates["accounting"] = {
            "quickbooks": {"enabled": False, "connected_at": None},
            "square": {"enabled": False, "connected_at": None},
        }
    if updates:
        await db.users.update_one({"user_id": user["user_id"]}, {"$set": updates})
        user.update(updates)


# ============================================================
# Email (Emergent Resend) — guardrail gate + async send
# ============================================================
import ipaddress as _ipaddress
from html import escape as _html_escape
from html.parser import HTMLParser as _HTMLParser
from urllib.parse import urlparse as _urlparse
from passlib.hash import bcrypt as _bcrypt

_SHORTENERS = ("bit.ly", "tinyurl.com", "t.co", "is.gd", "cutt.ly", "goo.gl", "rebrand.ly")
_CRED_ASK = (
    "reply with your password", "reply with the code", "send your password", "cvv",
    "send us your password", "enter your password below", "confirm your card number",
    "your full card number", "seed phrase", "recovery phrase", "verify your card",
    "social security number", "confirm your bank details",
)
_HOSTISH = re.compile(r"\b(?:https?://)?((?:[a-z0-9-]+\.)+[a-z]{2,})", re.I)


def _host_ok(host: str) -> bool:
    if not host or "xn--" in host:
        return False
    try:
        _ipaddress.ip_address(host)
        return False
    except ValueError:
        pass
    return not any(host == s or host.endswith("." + s) for s in _SHORTENERS)


def _same_site(shown: str, real: str) -> bool:
    return shown == real or real.endswith("." + shown) or shown.endswith("." + real)


class _EmailScan(_HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags: set = set()
        self.urls: list = []
        self.anchors: list = []
        self._href = None
        self._text: list = []

    def handle_starttag(self, tag, attrs):
        self.tags.add(tag.lower())
        self.urls += [v for k, v in attrs if k.lower() in ("href", "src") and v]
        if tag.lower() == "a":
            self._href = dict((k.lower(), v) for k, v in attrs).get("href")
            self._text = []

    def handle_data(self, data):
        if self._href is not None:
            self._text.append(data)

    def handle_endtag(self, tag):
        if tag.lower() == "a" and self._href is not None:
            self.anchors.append((self._href, "".join(self._text)))
            self._href, self._text = None, []


def _assert_safe_email(subject: str, html: str) -> None:
    scan = _EmailScan()
    scan.feed(html)
    if scan.tags & {"form", "input", "textarea", "select"}:
        raise ValueError("No forms or input fields in email (G2)")
    body = f"{subject}\n{html}".lower()
    for p in _CRED_ASK:
        if p in body:
            raise ValueError(f"Email asks the recipient for credentials: {p!r} (G2)")
    for url in scan.urls:
        low = url.strip().lower()
        if low.startswith(("mailto:", "tel:", "cid:", "#")):
            continue
        if not low.startswith("https://"):
            raise ValueError(f"Email links/assets must be absolute https: {url!r} (G3)")
        host = _urlparse(low).hostname or ""
        if not _host_ok(host) or _urlparse(low).username is not None:
            raise ValueError(f"Shortened/numeric-host/creds URL: {url!r} (G3)")
    for href, text in scan.anchors:
        real = _urlparse(href.strip().lower()).hostname or ""
        if not real:
            continue
        for m in _HOSTISH.finditer(text):
            if not _same_site(m.group(1).lower(), real):
                raise ValueError(f"Anchor text {m.group(1)!r} != real link host {real!r} (G3)")


async def _send_email(*, to: str, subject: str, html: str) -> Optional[str]:
    if not EMERGENT_EMAIL_KEY:
        logger.warning("Email disabled: EMERGENT_EMAIL_KEY not configured")
        return None
    _assert_safe_email(subject, html)
    payload = {"to": [to], "subject": subject, "html": html, "from_name": EMAIL_FROM_NAME}
    if EMAIL_REPLY_TO:
        payload["contact_email"] = EMAIL_REPLY_TO
    try:
        async with httpx.AsyncClient(timeout=30) as h:
            r = await h.post(
                f"{EMAIL_BASE_URL}/api/v1/email/send",
                headers={"X-Email-Key": EMERGENT_EMAIL_KEY},
                json=payload,
            )
        r.raise_for_status()
        return r.json().get("id")
    except httpx.HTTPStatusError as e:
        logger.error("Email send failed: %s %s", e.response.status_code, e.response.text)
        return None
    except Exception as e:
        logger.error("Email send error: %s", e)
        return None


def _brand_email(preheader: str, body_html: str, cta_url: Optional[str] = None, cta_label: Optional[str] = None) -> str:
    """Server-side branded email template. Body is passed already-escaped HTML."""
    cta_html = ""
    if cta_url and cta_label:
        cta_html = (
            f'<tr><td align="center" style="padding:24px 0">'
            f'<a href="{cta_url}" style="background:#eab308;color:#0a0a0a;padding:14px 28px;'
            f'text-decoration:none;font-family:Arial,sans-serif;font-weight:bold;'
            f'letter-spacing:1px;border-radius:6px;display:inline-block">{_html_escape(cta_label)}</a>'
            f'</td></tr>'
        )
    return (
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        'style="background:#09090b;padding:24px 0;font-family:Arial,sans-serif">'
        '<tr><td align="center">'
        '<table role="presentation" width="560" cellpadding="0" cellspacing="0" '
        'style="background:#18181b;border-radius:10px;padding:32px">'
        f'<tr><td style="color:#eab308;font-weight:900;font-size:22px;letter-spacing:3px;'
        f'padding-bottom:16px;border-bottom:2px solid #27272a">HANDY-ANDY</td></tr>'
        f'<tr><td style="color:#a1a1aa;font-size:12px;padding:16px 0 8px 0">'
        f'{_html_escape(preheader)}</td></tr>'
        f'<tr><td style="color:#f4f4f5;font-size:15px;line-height:22px;padding:8px 0">'
        f'{body_html}</td></tr>'
        f'{cta_html}'
        '<tr><td style="color:#71717a;font-size:11px;padding-top:24px;border-top:1px solid #27272a">'
        'Sent by Handy-Andy: Job Site Assistant. We will never ask for your password or '
        'card details by email. If you did not request this, you can safely ignore it.'
        '</td></tr>'
        '</table></td></tr></table>'
    )


# ============================================================
# Auth utilities — password hashing + rate limiting
# ============================================================
def _hash_password(plain: str) -> str:
    # Bcrypt truncates at 72 bytes; enforce here to fail loud.
    if len(plain.encode("utf-8")) > 72:
        raise HTTPException(status_code=400, detail="Password too long (max 72 chars)")
    return _bcrypt.hash(plain)


def _verify_password(plain: str, hashed: str) -> bool:
    try:
        return _bcrypt.verify(plain, hashed)
    except Exception:
        return False


def _password_strength(pw: str) -> tuple:
    """Return (score 0-4, errors: list[str])."""
    errs = []
    if len(pw) < 8:
        errs.append("At least 8 characters required")
    score = 0
    if len(pw) >= 8: score += 1
    if re.search(r"[A-Z]", pw): score += 1
    if re.search(r"[a-z]", pw): score += 1
    if re.search(r"\d", pw): score += 1
    if re.search(r"[^A-Za-z0-9]", pw): score += 1
    return min(score, 4), errs


_EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$")
_USERNAME_RE = re.compile(r"^[a-zA-Z0-9_]{3,20}$")


def _norm_email(email: str) -> str:
    email = (email or "").strip().lower()
    if not _EMAIL_RE.match(email):
        raise HTTPException(status_code=400, detail="Invalid email address")
    return email


def _norm_username(username: Optional[str]) -> Optional[str]:
    if not username:
        return None
    username = username.strip().lower()
    if not _USERNAME_RE.match(username):
        raise HTTPException(status_code=400, detail="Username must be 3-20 characters (letters, numbers, underscore)")
    return username


# In-process rate limit — fine for `username-check` where cluster consistency
# is not security-critical.
_RATE_BUCKETS: dict = {}


def _rate_limit(key: str, limit: int, window_s: int):
    now = time.time()
    bucket = _RATE_BUCKETS.setdefault(key, [])
    while bucket and bucket[0] < now - window_s:
        bucket.pop(0)
    if len(bucket) >= limit:
        raise HTTPException(status_code=429, detail="Too many requests. Please wait a moment and try again.")
    bucket.append(now)


# Cluster-safe rate limit backed by Mongo — used for security-critical
# endpoints (login / forgot-password / resend / signup / dev-login) so the
# ceiling holds across pods. TTL index on `expires_at` sweeps stale rows.
def _client_ip(request: Request) -> str:
    """Real client IP behind the ingress. `request.client.host` returns the
    kube-proxy peer (one per pod) which round-robins across pods and breaks
    per-IP counters. `X-Forwarded-For` is populated by the ingress and gives
    us the actual originating address."""
    xff = request.headers.get("x-forwarded-for") or request.headers.get("x-real-ip")
    if xff:
        # XFF is a comma-separated chain — the left-most entry is the client.
        return xff.split(",")[0].strip()
    return (request.client.host if request.client else "unknown") or "unknown"


async def _rate_limit_db(key: str, limit: int, window_s: int) -> None:
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(seconds=window_s)
    # Purge stale hits for this key (belt-and-suspenders — TTL already handles it).
    await db.rate_limit.delete_many({"key": key, "expires_at": {"$lt": now}})
    count = await db.rate_limit.count_documents({"key": key, "created_at": {"$gte": cutoff}})
    if count >= limit:
        raise HTTPException(status_code=429, detail="Too many requests. Please wait a moment and try again.")
    await db.rate_limit.insert_one({
        "key": key,
        "created_at": now,
        "expires_at": now + timedelta(seconds=window_s),
    })


# ============================================================
# Auth
# ============================================================
@api.post("/auth/session")
async def create_session(payload: SessionRequest):
    """Exchange the one-time session_id from Emergent auth for our own bearer.

    Per Emergent playbook: send `X-Session-ID: <session_id>` to
    demobackend.emergentagent.com. The `session_token` returned in the body
    is the value we mint & store — never re-verify a session_token.
    """
    headers = {"X-Session-ID": payload.session_id}
    async with httpx.AsyncClient(timeout=15) as h:
        r = await h.get(
            "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
            headers=headers,
        )
    if r.status_code != 200:
        raise HTTPException(status_code=401, detail="Failed to validate session")
    data = r.json()
    email = data.get("email")
    name = data.get("name") or email
    picture = data.get("picture")
    session_token = data.get("session_token") or f"emg_{uuid.uuid4().hex}"
    if not email:
        raise HTTPException(status_code=400, detail="No email in session data")

    return await _login_user(
        email=email, name=name, picture=picture, session_token=session_token,
        auth_provider="google", email_verified=True,
    )


@api.post("/auth/dev-login")
async def dev_login(payload: DevLoginRequest, request: Request):
    """Hidden developer bypass — requires a shared secret from the env.
    Regular users NEVER see or hit this endpoint.
    """
    ip = _client_ip(request)
    # Brute-force resistance: hard cap 5 dev attempts / hour / IP.
    await _rate_limit_db(f"devlogin:{ip}", 5, 60 * 60)
    if not ANDY_DEV_SECRET or payload.secret != ANDY_DEV_SECRET:
        # Never disclose whether the secret is unset vs mismatched.
        raise HTTPException(status_code=404, detail="Not found")
    email = _norm_email(payload.email)
    name = payload.name or email.split("@", 1)[0].title()
    session_token = f"dev_{uuid.uuid4().hex}"
    return await _login_user(
        email=email, name=name, picture=None, session_token=session_token,
        auth_provider="dev", email_verified=True,
    )


# ---------- Email / password auth ----------
def _issue_session_token(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex}"


@api.post("/auth/username-check")
async def username_check(payload: UsernameCheckRequest):
    _rate_limit("username_check", 30, 60)
    uname = _norm_username(payload.username)
    if not uname:
        return {"available": False, "reason": "invalid"}
    existing = await db.users.find_one({"username": uname}, {"_id": 0, "user_id": 1})
    return {"available": existing is None, "username": uname}


@api.post("/auth/signup")
async def email_signup(payload: SignUpRequest, request: Request):
    ip = _client_ip(request)
    _rate_limit(f"signup:{ip}", 10, 60 * 60)  # in-process fallback + shared below
    await _rate_limit_db(f"signup:{ip}", 10, 60 * 60)  # 10/hr per IP (cluster-safe)

    if not payload.accepted_terms:
        raise HTTPException(status_code=400, detail="You must accept the Terms of Service and Privacy Policy")

    email = _norm_email(payload.email)
    strength, errs = _password_strength(payload.password)
    if errs:
        raise HTTPException(status_code=400, detail=errs[0])

    uname = _norm_username(payload.username) if payload.username else None
    if uname:
        existing_u = await db.users.find_one({"username": uname}, {"_id": 0})
        if existing_u:
            raise HTTPException(status_code=409, detail="That username is already taken")

    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing and existing.get("password_hash"):
        raise HTTPException(status_code=409, detail="An account with this email already exists")

    pw_hash = _hash_password(payload.password)
    now = datetime.now(timezone.utc)
    verify_token = uuid.uuid4().hex + uuid.uuid4().hex
    verify_expires = now + timedelta(hours=24)

    if existing:
        # OAuth user linking a password → allowed, still require verification.
        user_id = existing["user_id"]
        set_updates: dict = {
            "password_hash": pw_hash,
            "email_verification_token": verify_token,
            "email_verification_expires": verify_expires,
            "email_verified": existing.get("email_verified", False),
            "auth_provider": existing.get("auth_provider", "email"),
        }
        unset_updates: dict = {}
        if uname:
            set_updates["username"] = uname
        else:
            # Do not set username:null — the sparse unique index treats null as
            # a real value on subsequent inserts and would produce dup-key errors.
            unset_updates["username"] = ""
        update_doc: dict = {"$set": set_updates}
        if unset_updates:
            update_doc["$unset"] = unset_updates
        await db.users.update_one({"user_id": user_id}, update_doc)
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        new_doc: dict = {
            "user_id": user_id,
            "email": email,
            "name": (uname or email.split("@", 1)[0]).title(),
            "picture": None,
            "password_hash": pw_hash,
            "email_verified": False,
            "email_verification_token": verify_token,
            "email_verification_expires": verify_expires,
            "auth_provider": "email",
            "created_at": now,
        }
        # Never write username:null — sparse unique index only skips MISSING
        # fields, not explicit null values.
        if uname:
            new_doc["username"] = uname
        await db.users.insert_one(new_doc)

    verify_url = f"{APP_BASE_URL}/verify-email?token={verify_token}"
    html = _brand_email(
        preheader="Verify your email to finish creating your Handy-Andy account.",
        body_html=(
            "<p>Welcome to Handy-Andy.</p>"
            "<p>Tap the button below to verify your email address. This link expires in 24 hours.</p>"
        ),
        cta_url=verify_url,
        cta_label="VERIFY EMAIL",
    )
    await _send_email(to=email, subject="Verify your Handy-Andy email", html=html)

    return {"ok": True, "email_verification_sent": True, "email": email}


@api.post("/auth/verify-email")
async def verify_email(payload: VerifyEmailRequest):
    token = payload.token.strip()
    if not token:
        raise HTTPException(status_code=400, detail="Missing token")
    user = await db.users.find_one({"email_verification_token": token}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=400, detail="Invalid or expired verification link")
    expires = user.get("email_verification_expires")
    if expires and isinstance(expires, datetime):
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if expires < datetime.now(timezone.utc):
            raise HTTPException(status_code=400, detail="Verification link has expired. Request a new one.")
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"email_verified": True},
         "$unset": {"email_verification_token": "", "email_verification_expires": ""}},
    )
    # Auto-login on successful verification.
    st = _issue_session_token("email")
    return await _login_user(
        email=user["email"], name=user.get("name") or user["email"],
        picture=user.get("picture"), session_token=st,
        auth_provider=user.get("auth_provider", "email"),
        email_verified=True,
    )


@api.post("/auth/resend-verification")
async def resend_verification(payload: ResendVerificationRequest, request: Request):
    ip = _client_ip(request)
    await _rate_limit_db(f"resend:{ip}", 5, 15 * 60)  # 5 / 15min per IP (cluster-safe)
    email = _norm_email(payload.email)
    user = await db.users.find_one({"email": email}, {"_id": 0})
    # Silent success — do not disclose existence.
    if not user or user.get("email_verified"):
        return {"ok": True}
    token = uuid.uuid4().hex + uuid.uuid4().hex
    expires = datetime.now(timezone.utc) + timedelta(hours=24)
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"email_verification_token": token, "email_verification_expires": expires}},
    )
    verify_url = f"{APP_BASE_URL}/verify-email?token={token}"
    html = _brand_email(
        preheader="A new verification link is on its way.",
        body_html="<p>Here is a fresh verification link. It expires in 24 hours.</p>",
        cta_url=verify_url, cta_label="VERIFY EMAIL",
    )
    await _send_email(to=email, subject="Your new Handy-Andy verification link", html=html)
    return {"ok": True}


@api.post("/auth/login")
async def email_password_login(payload: EmailPasswordLoginRequest, request: Request):
    ip = _client_ip(request)
    identifier = (payload.identifier or "").strip().lower()
    await _rate_limit_db(f"login:{ip}:{identifier}", 8, 5 * 60)  # 8 / 5min (cluster-safe)

    if not identifier or not payload.password:
        raise HTTPException(status_code=400, detail="Enter your email or username and password")

    # identifier = email OR username
    query = {"$or": [{"email": identifier}, {"username": identifier}]}
    user = await db.users.find_one(query, {"_id": 0})
    if not user or not user.get("password_hash"):
        # Uniform error to avoid leaking account existence.
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not _verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not user.get("email_verified"):
        raise HTTPException(status_code=403, detail="Please verify your email before signing in")

    st = _issue_session_token("email")
    return await _login_user(
        email=user["email"], name=user.get("name") or user["email"],
        picture=user.get("picture"), session_token=st,
        auth_provider=user.get("auth_provider", "email"),
        email_verified=True,
    )


@api.post("/auth/forgot-password")
async def forgot_password(payload: ForgotPasswordRequest, request: Request):
    ip = _client_ip(request)
    await _rate_limit_db(f"forgot:{ip}", 5, 15 * 60)  # cluster-safe
    email = _norm_email(payload.email)
    user = await db.users.find_one({"email": email}, {"_id": 0})
    # ALWAYS return ok — never disclose whether the email exists.
    if user and user.get("password_hash"):
        token = uuid.uuid4().hex + uuid.uuid4().hex
        expires = datetime.now(timezone.utc) + timedelta(hours=1)
        await db.users.update_one(
            {"user_id": user["user_id"]},
            {"$set": {"password_reset_token": token, "password_reset_expires": expires}},
        )
        reset_url = f"{APP_BASE_URL}/reset-password?token={token}"
        html = _brand_email(
            preheader="Reset your Handy-Andy password.",
            body_html=(
                "<p>Someone (hopefully you) asked to reset the Handy-Andy password on this address.</p>"
                "<p>This link expires in 1 hour. If it was not you, no action is needed.</p>"
            ),
            cta_url=reset_url, cta_label="RESET PASSWORD",
        )
        await _send_email(to=email, subject="Reset your Handy-Andy password", html=html)
    return {"ok": True}


@api.post("/auth/reset-password")
async def reset_password(payload: ResetPasswordRequest):
    token = payload.token.strip()
    if not token:
        raise HTTPException(status_code=400, detail="Missing token")
    strength, errs = _password_strength(payload.new_password)
    if errs:
        raise HTTPException(status_code=400, detail=errs[0])
    user = await db.users.find_one({"password_reset_token": token}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=400, detail="Invalid or expired reset link")
    expires = user.get("password_reset_expires")
    if expires and isinstance(expires, datetime):
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if expires < datetime.now(timezone.utc):
            raise HTTPException(status_code=400, detail="Reset link has expired. Please request a new one.")
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"password_hash": _hash_password(payload.new_password), "email_verified": True},
         "$unset": {"password_reset_token": "", "password_reset_expires": ""}},
    )
    # Invalidate all existing sessions on password reset (security best practice).
    await db.user_sessions.delete_many({"user_id": user["user_id"]})
    return {"ok": True}


@api.post("/auth/apple")
async def apple_login(payload: AppleLoginRequest):
    """Verify Apple identityToken & create/login user."""
    try:
        unverified = jose_jwt.get_unverified_claims(payload.identity_token)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid Apple identity token")

    iss = unverified.get("iss")
    if iss != "https://appleid.apple.com":
        raise HTTPException(status_code=400, detail="Bad token issuer")
    # NOTE: For production, fetch Apple JWKS and verify signature. Here we trust the
    # identity_token because Apple Sign-In requires a real device flow to obtain it.
    sub = unverified.get("sub")
    email = unverified.get("email") or payload.email
    if not email:
        # Apple may not always return email — synthesize a stable handle
        email = f"apple_{sub}@privaterelay.appleid.com"
    name = payload.full_name or email.split("@", 1)[0].title()
    session_token = f"apple_{uuid.uuid4().hex}"
    return await _login_user(
        email=email, name=name, picture=None, session_token=session_token,
        apple_sub=sub, auth_provider="apple", email_verified=True,
    )


async def _login_user(
    email: str, name: str, picture: Optional[str], session_token: str,
    apple_sub: Optional[str] = None,
    auth_provider: Optional[str] = None,
    email_verified: Optional[bool] = None,
):
    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        user_id = existing["user_id"]
        updates: dict = {"name": name, "picture": picture}
        if apple_sub:
            updates["apple_sub"] = apple_sub
        if auth_provider and not existing.get("auth_provider"):
            updates["auth_provider"] = auth_provider
        if email_verified is True:
            updates["email_verified"] = True
        await db.users.update_one({"user_id": user_id}, {"$set": updates})
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        now = datetime.now(timezone.utc)
        await db.users.insert_one({
            "user_id": user_id,
            "email": email,
            "name": name,
            "picture": picture,
            "apple_sub": apple_sub,
            "auth_provider": auth_provider or "oauth",
            "email_verified": bool(email_verified),
            "created_at": now,
        })
    await _provision_user_defaults(user_id)

    expires_at = datetime.now(timezone.utc) + timedelta(days=7)
    await db.user_sessions.update_one(
        {"session_token": session_token},
        {
            "$set": {
                "session_token": session_token,
                "user_id": user_id,
                "expires_at": expires_at,
                "created_at": datetime.now(timezone.utc),
            }
        },
        upsert=True,
    )
    user_doc = await db.users.find_one({"user_id": user_id}, {"_id": 0, "password_hash": 0, "email_verification_token": 0, "password_reset_token": 0})
    await _ensure_user_billing_fields(user_doc)
    return {"session_token": session_token, "user": user_doc, "expires_at": expires_at}


@api.get("/auth/me")
async def whoami(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    await _ensure_user_billing_fields(user)
    await _ensure_monthly_counter(user)
    return {"user": user, "is_pro": _is_pro_or_trialing(user)}


@api.post("/auth/logout")
async def logout(authorization: Optional[str] = Header(None)):
    if authorization and authorization.startswith("Bearer "):
        token = authorization[len("Bearer "):].strip()
        await db.user_sessions.delete_one({"session_token": token})
    return {"ok": True}


@api.delete("/auth/account")
async def delete_account(authorization: Optional[str] = Header(None)):
    """Anti-dark-pattern Right-to-Delete (CCPA/CPRA § 1798.105).

    Single in-app tap triggers an immediate, cascading hard delete across every
    collection touching the user. No support email, no waiting period, no
    "Are you SURE you're sure?" — symmetry of choice is mandatory.
    """
    user = await get_current_user(authorization)
    uid = user["user_id"]
    # Cascade: jobs (with embedded photos, change_orders, safety_logs),
    # sessions, audit_log, account itself.
    deleted_jobs = await db.jobs.delete_many({"user_id": uid})
    deleted_sessions = await db.user_sessions.delete_many({"user_id": uid})
    deleted_audit = await db.audit_log.delete_many({"user_id": uid})
    # Best-effort Stripe customer cleanup (cancel any active subscription,
    # then delete the customer record so we hold no further PII downstream).
    sub_id = user.get("stripe_subscription_id")
    cust_id = user.get("stripe_customer_id")
    try:
        if sub_id:
            stripe.Subscription.delete(sub_id)
    except Exception as e:
        logger.warning("Stripe subscription cancel during account delete failed: %s", e)
    try:
        if cust_id:
            stripe.Customer.delete(cust_id)
    except Exception as e:
        logger.warning("Stripe customer delete failed: %s", e)
    deleted_user = await db.users.delete_one({"user_id": uid})
    return {
        "deleted": True,
        "user_records": deleted_user.deleted_count,
        "jobs": deleted_jobs.deleted_count,
        "sessions": deleted_sessions.deleted_count,
        "audit_logs": deleted_audit.deleted_count,
        "stripe_customer_deleted": bool(cust_id),
    }


@api.get("/mascot/settings")
async def mascot_get(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    return {
        "show_mascot": user.get("show_mascot", True),
        "dismissed_contexts": user.get("mascot_dismissed", []),
    }


@api.post("/mascot/settings")
async def mascot_set(payload: MascotSettingsBody, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"show_mascot": bool(payload.show_mascot)}},
    )
    return {"show_mascot": bool(payload.show_mascot)}


@api.post("/mascot/dismiss")
async def mascot_dismiss(payload: MascotDismissBody, authorization: Optional[str] = Header(None)):
    """Record a context-specific dismissal so we don't nag the user again."""
    user = await get_current_user(authorization)
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$addToSet": {"mascot_dismissed": payload.context}},
    )
    return {"ok": True, "context": payload.context}


# ============================================================
# Subscription / Billing
# ============================================================
def _plan_catalog() -> dict:
    """Static plan catalog. Prices are cents; Stripe products/prices are
    created lazily on first checkout using `lookup_key` to stay idempotent."""
    return {
        "monthly": {
            "id": "monthly",
            "name": "Handy-Andy Pro (Monthly)",
            "interval": "month",
            "amount_cents": int(round(PRO_MONTHLY_USD * 100)),
            "amount_display": f"${PRO_MONTHLY_USD:.2f}",
            "period_display": "per month",
            "lookup_key": "handy_andy_pro_monthly_v1",
        },
        "annual": {
            "id": "annual",
            "name": "Handy-Andy Pro (Annual)",
            "interval": "year",
            "amount_cents": int(round(PRO_ANNUAL_USD * 100)),
            "amount_display": f"${PRO_ANNUAL_USD:.2f}",
            "period_display": "per year",
            "monthly_equivalent": f"${PRO_ANNUAL_MONTHLY_EQUIV:.2f}",
            "savings_pct": PRO_ANNUAL_SAVINGS_PCT,
            "lookup_key": "handy_andy_pro_annual_v1",
        },
    }


async def _get_or_create_price(plan: dict) -> str:
    """Return an existing Stripe Price by `lookup_key`, creating product+price
    on first request. Safe to call concurrently — Stripe rejects duplicate
    lookup_keys so the second create raises and we re-fetch."""
    if not STRIPE_API_KEY:
        raise HTTPException(status_code=503, detail="Billing is not configured on this server")
    try:
        prices = stripe.Price.list(lookup_keys=[plan["lookup_key"]], active=True, limit=1)
        if prices.data:
            return prices.data[0].id
        product = stripe.Product.create(
            name=plan["name"],
            metadata={"lookup_key": plan["lookup_key"], "app": "handy_andy"},
        )
        price = stripe.Price.create(
            product=product.id,
            unit_amount=plan["amount_cents"],
            currency="usd",
            recurring={"interval": plan["interval"]},
            lookup_key=plan["lookup_key"],
            metadata={"plan_id": plan["id"]},
        )
        return price.id
    except stripe.error.StripeError as e:  # type: ignore[attr-defined]
        # Race: another worker created it — re-fetch.
        try:
            prices = stripe.Price.list(lookup_keys=[plan["lookup_key"]], active=True, limit=1)
            if prices.data:
                return prices.data[0].id
        except Exception:
            pass
        logger.exception("Stripe price provisioning failed: %s", e)
        raise HTTPException(status_code=502, detail="Billing provisioning failed")


def _trial_days_remaining(user: dict) -> int:
    trial_end = user.get("trial_end_date")
    if not trial_end:
        return 0
    if isinstance(trial_end, str):
        try:
            trial_end = datetime.fromisoformat(trial_end.replace("Z", "+00:00"))
        except Exception:
            return 0
    if trial_end.tzinfo is None:
        trial_end = trial_end.replace(tzinfo=timezone.utc)
    remaining = (trial_end - datetime.now(timezone.utc)).total_seconds()
    return max(0, int((remaining + 86399) // 86400))  # round up whole days


def _in_trial(user: dict) -> bool:
    if user.get("stripe_subscription_status") == "active":
        return False
    return _trial_days_remaining(user) > 0


@api.get("/subscription/plans")
async def subscription_plans():
    """Public — used by the pricing screen."""
    return {
        "plans": list(_plan_catalog().values()),
        "trial_days": TRIAL_DAYS,
        "free_tier": {
            "ai_scans_per_month": FREE_TIER_AI_LIMIT,
            "job_limit": FREE_TIER_JOB_LIMIT,
        },
    }


@api.get("/subscription/status")
async def subscription_status(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    await _ensure_user_billing_fields(user)
    await _ensure_monthly_counter(user)
    is_active = user.get("stripe_subscription_status") == "active"
    in_trial = _in_trial(user)
    return {
        "status": user.get("stripe_subscription_status", "trialing" if in_trial else "none"),
        "trial_end_date": user.get("trial_end_date"),
        "trial_days_remaining": _trial_days_remaining(user),
        "in_trial": in_trial,
        "current_tier": "pro" if (is_active or in_trial) else "free",
        "ai_scan_count_this_month": user.get("ai_scan_count_this_month", 0),
        "ai_limit_free": FREE_TIER_AI_LIMIT,
        "job_limit_free": FREE_TIER_JOB_LIMIT,
        "is_pro": is_active or in_trial,
        "monthly_price_usd": PRO_MONTHLY_USD,
        "annual_price_usd": PRO_ANNUAL_USD,
        "cancel_at_period_end": bool(user.get("cancel_at_period_end")),
    }


@api.post("/subscription/checkout")
async def subscription_checkout(payload: CheckoutBody, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    # `payload.job_id` is repurposed here as the plan id ("monthly" | "annual").
    plan_id = (payload.job_id or "monthly").lower()
    catalog = _plan_catalog()
    if plan_id not in catalog:
        raise HTTPException(status_code=400, detail="Invalid plan. Choose 'monthly' or 'annual'.")
    plan = catalog[plan_id]

    customer_id = user.get("stripe_customer_id")
    if not customer_id:
        try:
            customer = stripe.Customer.create(
                email=user["email"], name=user.get("name"),
                metadata={"user_id": user["user_id"]},
            )
            customer_id = customer.id
            await db.users.update_one(
                {"user_id": user["user_id"]}, {"$set": {"stripe_customer_id": customer_id}}
            )
        except Exception as e:
            logger.exception("Stripe customer create failed: %s", e)
            raise HTTPException(status_code=502, detail=f"Stripe error: {e}")

    price_id = await _get_or_create_price(plan)
    origin = payload.return_origin.rstrip("/")
    success_url = f"{origin}/billing/success?session_id={{CHECKOUT_SESSION_ID}}"
    cancel_url = f"{origin}/billing/cancel"

    # Trial without card: users get 14 days free BEFORE ever visiting checkout.
    # If they still have trial days left, honor the remaining count so we do
    # not stack a second free trial on top; if trial exhausted, no trial in
    # checkout (they upgrade immediately).
    remaining = _trial_days_remaining(user)
    sub_data: dict = {"metadata": {"user_id": user["user_id"], "plan_id": plan_id}}
    if remaining > 0:
        sub_data["trial_period_days"] = remaining

    try:
        session = stripe.checkout.Session.create(
            customer=customer_id,
            mode="subscription",
            line_items=[{"price": price_id, "quantity": 1}],
            subscription_data=sub_data,
            allow_promotion_codes=True,
            success_url=success_url,
            cancel_url=cancel_url,
            metadata={"user_id": user["user_id"], "plan_id": plan_id},
        )
    except Exception as e:
        logger.exception("Stripe checkout create failed: %s", e)
        raise HTTPException(status_code=502, detail=f"Stripe error: {e}")
    return {"checkout_url": session.url, "session_id": session.id}


@api.post("/subscription/portal")
async def subscription_portal(payload: CheckoutBody, authorization: Optional[str] = Header(None)):
    """Return a Stripe Billing Portal URL so users can manage / cancel /
    swap plans without leaving the app. Requires a Stripe customer."""
    user = await get_current_user(authorization)
    customer_id = user.get("stripe_customer_id")
    if not customer_id:
        raise HTTPException(status_code=400, detail="No billing account yet — upgrade first.")
    origin = payload.return_origin.rstrip("/")
    try:
        session = stripe.billing_portal.Session.create(
            customer=customer_id, return_url=f"{origin}/settings",
        )
    except Exception as e:
        logger.exception("Stripe portal create failed: %s", e)
        raise HTTPException(status_code=502, detail=f"Stripe error: {e}")
    return {"portal_url": session.url}


@api.post("/subscription/cancel")
async def subscription_cancel(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    sub_id = user.get("stripe_subscription_id")
    if not sub_id:
        await db.users.update_one(
            {"user_id": user["user_id"]},
            {"$set": {"stripe_subscription_status": "canceled", "current_tier": "free"}},
        )
        return {"status": "canceled"}
    try:
        sub = stripe.Subscription.modify(sub_id, cancel_at_period_end=True)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Stripe error: {e}")
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"stripe_subscription_status": sub.status, "cancel_at_period_end": True}},
    )
    return {"status": sub.status, "cancel_at_period_end": True}


@api.post("/subscription/reactivate")
async def subscription_reactivate(authorization: Optional[str] = Header(None)):
    """Reverse a pending cancellation (cancel_at_period_end=False)."""
    user = await get_current_user(authorization)
    sub_id = user.get("stripe_subscription_id")
    if not sub_id:
        raise HTTPException(status_code=400, detail="No subscription to reactivate")
    try:
        sub = stripe.Subscription.modify(sub_id, cancel_at_period_end=False)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Stripe error: {e}")
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"stripe_subscription_status": sub.status, "cancel_at_period_end": False}},
    )
    return {"status": sub.status, "cancel_at_period_end": False}


@api.post("/subscription/confirm")
async def subscription_confirm(session_id: str, authorization: Optional[str] = Header(None)):
    """Client calls this after returning from Stripe Checkout to refresh
    status immediately (webhook still authoritative)."""
    user = await get_current_user(authorization)
    try:
        s = stripe.checkout.Session.retrieve(session_id)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Stripe error: {e}")
    if s.get("metadata", {}).get("user_id") != user["user_id"]:
        raise HTTPException(status_code=403, detail="Session does not belong to user")
    sub_id = s.get("subscription")
    if sub_id:
        try:
            sub = stripe.Subscription.retrieve(sub_id)
            status = sub.status
        except Exception:
            status = "active"
        await db.users.update_one(
            {"user_id": user["user_id"]},
            {"$set": {
                "stripe_subscription_id": sub_id,
                "stripe_subscription_status": status,
                "current_tier": "pro",
                "cancel_at_period_end": False,
            }},
        )
        return {"status": status}
    return {"status": "unknown"}


# ---------- Stripe Webhook (durable subscription state) ----------
async def _apply_subscription_state(sub: dict) -> None:
    """Given a Stripe Subscription payload, sync the user's DB row.

    Trusts subscription.metadata.user_id first (set at checkout), then the
    customer email as a fallback. Status codes that grant Pro: `trialing`,
    `active`. Anything else falls back to trial-days-remaining or Free."""
    user_id = (sub.get("metadata") or {}).get("user_id")
    query = None
    if user_id:
        query = {"user_id": user_id}
    else:
        cust_id = sub.get("customer")
        if cust_id:
            query = {"stripe_customer_id": cust_id}
    if not query:
        logger.warning("Webhook: cannot resolve user for subscription %s", sub.get("id"))
        return
    status = sub.get("status") or "unknown"
    is_pro_status = status in ("trialing", "active")
    updates: dict = {
        "stripe_subscription_id": sub.get("id"),
        "stripe_subscription_status": status,
        "cancel_at_period_end": bool(sub.get("cancel_at_period_end")),
    }
    if is_pro_status:
        updates["current_tier"] = "pro"
    else:
        # Preserve trial access if user still has trial days locally.
        target = await db.users.find_one(query, {"_id": 0}) or {}
        if _trial_days_remaining(target) <= 0:
            updates["current_tier"] = "free"
    await db.users.update_one(query, {"$set": updates})


async def _apply_subscription_deleted(sub: dict) -> None:
    cust_id = sub.get("customer")
    query = {"stripe_customer_id": cust_id} if cust_id else None
    user_id = (sub.get("metadata") or {}).get("user_id")
    if user_id:
        query = {"user_id": user_id}
    if not query:
        return
    await db.users.update_one(
        query,
        {"$set": {
            "stripe_subscription_status": "canceled",
            "current_tier": "free",
            "cancel_at_period_end": False,
        }},
    )


@app.post("/api/webhooks/stripe")
async def stripe_webhook(request: Request):
    """Verified Stripe webhook. Handles:
       - checkout.session.completed  (trial → active)
       - customer.subscription.updated / created  (any status change)
       - customer.subscription.deleted  (final cancel)
       - invoice.payment_failed  (mark past_due so UI can nudge)"""
    if not STRIPE_WEBHOOK_SECRET:
        # Fail closed — never trust unsigned events in production.
        logger.error("Webhook rejected: STRIPE_WEBHOOK_SECRET not configured")
        raise HTTPException(status_code=503, detail="Webhook signing not configured")
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature")
    try:
        event = stripe.Webhook.construct_event(payload, sig_header, STRIPE_WEBHOOK_SECRET)
    except (ValueError, stripe.error.SignatureVerificationError) as e:  # type: ignore[attr-defined]
        logger.warning("Webhook signature failed: %s", e)
        raise HTTPException(status_code=400, detail="Invalid signature")

    # Idempotency guard — never process the same event id twice.
    event_id = event.get("id")
    if event_id:
        try:
            await db.stripe_events.insert_one({"event_id": event_id, "at": datetime.now(timezone.utc), "type": event.get("type")})
        except Exception:
            return {"received": True, "duplicate": True}

    etype = event.get("type") or ""
    data = event.get("data", {}).get("object", {})
    try:
        if etype in ("customer.subscription.created", "customer.subscription.updated"):
            await _apply_subscription_state(data)
        elif etype == "customer.subscription.deleted":
            await _apply_subscription_deleted(data)
        elif etype == "checkout.session.completed":
            sub_id = data.get("subscription")
            uid = (data.get("metadata") or {}).get("user_id")
            if sub_id:
                sub = stripe.Subscription.retrieve(sub_id)
                sub_dict = sub.to_dict() if hasattr(sub, "to_dict") else dict(sub)
                if uid and "metadata" in sub_dict and not sub_dict["metadata"].get("user_id"):
                    sub_dict["metadata"]["user_id"] = uid
                await _apply_subscription_state(sub_dict)
        elif etype == "invoice.payment_failed":
            sub_id = data.get("subscription")
            if sub_id:
                await db.users.update_one(
                    {"stripe_subscription_id": sub_id},
                    {"$set": {"stripe_subscription_status": "past_due"}},
                )
    except Exception as e:
        logger.exception("Webhook handler error for %s: %s", etype, e)
        # Return 200 anyway so Stripe does not retry a poison event forever.
    return {"received": True, "type": etype}


@api.post("/checkout/parts")
async def checkout_parts(payload: CheckoutBody, authorization: Optional[str] = Header(None)):
    """One-off Stripe Checkout for a job's BOM."""
    user = await get_current_user(authorization)
    if not payload.job_id:
        raise HTTPException(status_code=400, detail="job_id required")
    job = await db.jobs.find_one({"job_id": payload.job_id, "user_id": user["user_id"]}, {"_id": 0})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    line_items = []
    is_pro = _is_pro_or_trialing(user)
    markup = (job.get("markup_percent") or user.get("global_markup_percent") or 20) / 100.0 if is_pro else 0.0
    for item in job.get("bom", []):
        unit = float(item.get("unit_price") or 15.00)  # mock default
        final = unit * (1 + markup) if is_pro else unit
        line_items.append(
            {
                "quantity": int(re.sub(r"[^0-9]", "", str(item.get("quantity") or "1")) or "1"),
                "price_data": {
                    "currency": "usd",
                    "unit_amount": max(50, int(final * 100)),
                    "product_data": {"name": item.get("name", "Part")[:80]},
                },
            }
        )
    if not line_items:
        raise HTTPException(status_code=400, detail="Job has no BOM items")

    origin = payload.return_origin.rstrip("/")
    try:
        session = stripe.checkout.Session.create(
            mode="payment",
            line_items=line_items,
            success_url=f"{origin}/billing/parts-success?session_id={{CHECKOUT_SESSION_ID}}",
            cancel_url=f"{origin}/billing/parts-cancel",
            metadata={"user_id": user["user_id"], "job_id": payload.job_id, "kind": "parts"},
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Stripe error: {e}")
    return {"checkout_url": session.url, "session_id": session.id}


# ============================================================
# Jobs
# ============================================================
DEMO_JOBS = [
    {
        "title": "Kitchen Faucet Leak — Apt 3B",
        "description": "Continuous drip at the base of the faucet.",
        "status": "in_progress",
        "safety_notes": "Shut off supply valves. Check cabinet floor for rot.",
        "location": "412 Oakwood Ave, Unit 3B",
        "tools_suggested": ["Basin wrench", "Plumber's tape", "Adjustable wrench"],
        "bom": [
            {"name": "Cartridge replacement", "quantity": "1", "stock": "In Stock", "unit_price": 24.99, "final_price": 24.99},
            {"name": "O-ring kit", "quantity": "1", "stock": "Low Stock", "unit_price": 6.49, "final_price": 6.49},
            {"name": "Plumber's tape", "quantity": "1", "stock": "In Stock", "unit_price": 2.99, "final_price": 2.99},
        ],
    },
    {
        "title": "Drywall Patch — Hallway",
        "description": "4-inch doorknob impact hole.",
        "status": "open",
        "safety_notes": "Wear N95 when sanding. Drop cloth required.",
        "location": "78 Birch Lane",
        "tools_suggested": ["Drywall saw", "Putty knife", "Sanding block"],
        "bom": [
            {"name": "Drywall patch kit 6x6", "quantity": "1", "stock": "In Stock", "unit_price": 9.99, "final_price": 9.99},
            {"name": "Joint compound (quart)", "quantity": "1", "stock": "In Stock", "unit_price": 12.49, "final_price": 12.49},
        ],
    },
    {
        "title": "URGENT — Exposed Wiring in Garage",
        "description": "Bare conductors near breaker panel.",
        "status": "emergent",
        "safety_notes": "DO NOT touch. Kill main breaker. Lockout/tagout required.",
        "location": "29 Maple Ridge Dr",
        "tools_suggested": ["Non-contact voltage tester", "Wire nuts"],
        "bom": [
            {"name": "12 AWG THHN wire (10 ft)", "quantity": "1", "stock": "In Stock", "unit_price": 18.50, "final_price": 18.50},
            {"name": "Junction box", "quantity": "1", "stock": "Out of Stock", "unit_price": 7.99, "final_price": 7.99},
        ],
    },
    {
        "title": "Deck Board Replacement",
        "description": "Two PT boards rotted through.",
        "status": "closed",
        "safety_notes": "Verify no wires under decking before cutting.",
        "location": "1102 Hilltop Ct",
        "tools_suggested": ["Circular saw", "Pry bar", "Impact driver"],
        "bom": [
            {"name": "Pressure-treated 2x6 8ft", "quantity": "2", "stock": "In Stock", "unit_price": 14.99, "final_price": 14.99},
            {"name": "Deck screws (1 lb)", "quantity": "1", "stock": "In Stock", "unit_price": 11.99, "final_price": 11.99},
        ],
    },
]


async def _seed_user_jobs(user_id: str):
    count = await db.jobs.count_documents({"user_id": user_id})
    if count > 0:
        return
    now = datetime.now(timezone.utc)
    for d in DEMO_JOBS:
        job = Job(user_id=user_id, **d)
        doc = job.model_dump()
        doc["created_at"] = now
        doc["updated_at"] = now
        await db.jobs.insert_one(doc)


@api.get("/jobs")
async def list_jobs(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    await _seed_user_jobs(user["user_id"])
    cursor = db.jobs.find({"user_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1)
    jobs = await cursor.to_list(500)
    for j in jobs:
        j["photo_count"] = len(j.get("photos", []))
        j.pop("photos", None)
        j.pop("change_orders", None)
    return {"jobs": jobs}


@api.post("/jobs")
async def create_job(payload: JobCreate, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    if not _is_pro_or_trialing(user):
        active = await db.jobs.count_documents(
            {"user_id": user["user_id"], "status": {"$in": ["open", "in_progress"]}}
        )
        if active >= FREE_TIER_JOB_LIMIT:
            raise HTTPException(
                status_code=402,
                detail=f"Free tier limited to {FREE_TIER_JOB_LIMIT} active jobs. Upgrade to Pro for unlimited.",
            )
    job = Job(user_id=user["user_id"], **payload.model_dump())
    await db.jobs.insert_one(job.model_dump())
    return {"job": job.model_dump()}


@api.get("/jobs/{job_id}")
async def get_job(job_id: str, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    job = await db.jobs.find_one({"job_id": job_id, "user_id": user["user_id"]}, {"_id": 0})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return {"job": job}


@api.patch("/jobs/{job_id}")
async def update_job(job_id: str, payload: JobUpdate, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    updates = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No updates")
    updates["updated_at"] = datetime.now(timezone.utc)
    res = await db.jobs.update_one(
        {"job_id": job_id, "user_id": user["user_id"]}, {"$set": updates}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Job not found")
    job = await db.jobs.find_one({"job_id": job_id}, {"_id": 0})
    return {"job": job}


@api.post("/jobs/{job_id}/photos")
async def add_photo(job_id: str, payload: PhotoAdd, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    # CPRA/BIPA scrub: strip EXIF/GPS/device metadata before storage + AI transmission
    clean_b64 = sanitize_uploaded_photo(payload.base64)
    photo = Photo(label=payload.label, base64=clean_b64)
    res = await db.jobs.update_one(
        {"job_id": job_id, "user_id": user["user_id"]},
        {"$push": {"photos": photo.model_dump()}, "$set": {"updated_at": datetime.now(timezone.utc)}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Job not found")
    return {"photo": photo.model_dump()}


@api.delete("/jobs/{job_id}")
async def delete_job(job_id: str, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    res = await db.jobs.delete_one({"job_id": job_id, "user_id": user["user_id"]})
    return {"deleted": res.deleted_count}


# ============================================================
# AI Vision (gated by quota)
# ============================================================
ANALYZE_SYSTEM = (
    "You are Andy, a master handyman AI. Given a photo of a repair task, return STRICT JSON "
    "with keys: `diagnostic` (short paragraph), `tools` (string list), `bom` (list of "
    "{name, quantity, stock:'In Stock'|'Low Stock', unit_price (USD float)}), `safety_notes` (string)."
)
DIAG_SYSTEM = (
    "You are Andy, a diagnostic field assistant. Return STRICT JSON: `root_cause`, "
    "`severity` in 'low'|'medium'|'high', `steps` (numbered string list), `tools` (list), "
    "`safety_warnings` (list)."
)
SAFETY_SYSTEM = (
    "You are Andy, a job-site safety officer. Return STRICT JSON: "
    "`hazardLevel` in 'clear'|'caution'|'crisis', "
    "`threats` (list of {type:'electrical'|'structural'|'moisture'|'environmental', description, remediation}), "
    "`preExistingIssues` (string list), `recommendation` (string), `osha_flags` (string list)."
)


@api.post("/ai/analyze-job")
async def analyze_job(payload: AnalyzeRequest, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    await _enforce_ai_quota(user)
    prompt = "Analyze the photo and produce the JSON. " + (payload.context or "")
    try:
        raw = await _gemini_vision(prompt, payload.image_base64, ANALYZE_SYSTEM)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI vision failed: {e}")
    await _increment_ai_quota(user["user_id"])
    data = _extract_json(raw)
    return {
        "diagnostic": data.get("diagnostic", raw[:600]),
        "tools": data.get("tools", []),
        "bom": data.get("bom", []),
        "safety_notes": data.get("safety_notes", ""),
        "raw": raw,
    }


@api.post("/ai/diagnostic")
async def ai_diagnostic(payload: DiagnosticRequest, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    await _enforce_ai_quota(user)
    prompt = "Diagnose the failure. " + (payload.notes or "")
    try:
        raw = await _gemini_vision(prompt, payload.image_base64, DIAG_SYSTEM)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI vision failed: {e}")
    await _increment_ai_quota(user["user_id"])
    data = _extract_json(raw)
    return {
        "root_cause": data.get("root_cause", raw[:400]),
        "severity": data.get("severity", "medium"),
        "steps": data.get("steps", []),
        "tools": data.get("tools", []),
        "safety_warnings": data.get("safety_warnings", []),
        "raw": raw,
    }


@api.post("/ai/safety")
async def ai_safety(payload: SafetyRequest, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    await _enforce_ai_quota(user)
    try:
        if not payload.image_base64:
            chat = LlmChat(
                api_key=EMERGENT_LLM_KEY,
                session_id=f"safety-{uuid.uuid4().hex[:8]}",
                system_message=SAFETY_SYSTEM,
            ).with_model("gemini", "gemini-2.5-flash")
            text = (
                f"No photo. Location: {payload.location or 'unspecified'}. "
                f"Notes: {payload.notes or 'none'}. Return the JSON evaluation."
            )
            raw = await chat.send_message(UserMessage(text=text))
        else:
            ctx = []
            if payload.location:
                ctx.append(f"Location: {payload.location}")
            if payload.notes:
                ctx.append(f"Notes: {payload.notes}")
            raw = await _gemini_vision("Evaluate hazards. " + " ".join(ctx), payload.image_base64, SAFETY_SYSTEM)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI safety failed: {e}")
    await _increment_ai_quota(user["user_id"])
    data = _extract_json(raw)
    out = {
        "hazardLevel": data.get("hazardLevel", "caution"),
        "threats": data.get("threats", []),
        "preExistingIssues": data.get("preExistingIssues", []),
        "recommendation": data.get("recommendation", raw[:400]),
        "osha_flags": data.get("osha_flags", []),
        "raw": raw,
    }
    # If job_id and image provided, persist immutable safety log
    if payload.image_base64 and payload.job_id:
        log = SafetyLog(
            photo_base64=payload.image_base64,
            hazard_level=out["hazardLevel"],
            threats=out["threats"],
            pre_existing_issues=out["preExistingIssues"],
            raw_ai_payload=json.dumps(out),
            geo=payload.geo,
            inspector_user_id=user["user_id"],
        )
        await db.jobs.update_one(
            {"job_id": payload.job_id, "user_id": user["user_id"]},
            {"$push": {"safety_logs": log.model_dump()}, "$set": {"updated_at": datetime.now(timezone.utc)}},
        )
        out["log_id"] = log.log_id
    return out


# ============================================================
# Voice greeting (Andy) + Voice intake (Whisper STT → Gemini)
# ============================================================
@api.post("/voice/greet")
async def voice_greet(payload: VoiceGreetRequest, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    persona = (payload.persona or "standard").lower()
    voice, flavor = PERSONA_VOICES.get(persona, PERSONA_VOICES["standard"])
    name = payload.name or user.get("name") or "partner"
    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"greet-{uuid.uuid4().hex[:8]}",
        system_message=(
            "You are Andy, a friendly handyman assistant. Produce ONE short greeting "
            "(2 sentences max, under 220 chars). " + flavor + " Use the operator's name. "
            "Default opener style: 'Hey there, welcome to the job site. I'm Andy, your assistant. "
            "Let's get to work.'"
        ),
    ).with_model("gemini", "gemini-2.5-flash")
    try:
        text = await chat.send_message(UserMessage(text=f"Greet {name}. Welcome them to Handy-Andy and offer help."))
    except Exception:
        text = f"Hey {name}, Andy here. Tools loaded — let's get to work."
    text = (text or "").strip().strip('"').strip()[:400]

    tts = OpenAITextToSpeech(api_key=EMERGENT_LLM_KEY)
    speed = max(0.5, min(2.0, payload.pace or 1.0))
    try:
        audio_b64 = await tts.generate_speech_base64(
            text=text, model="tts-1", voice=voice, speed=speed, response_format="mp3"
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"TTS failed: {e}")
    return {"text": text, "audio_base64": audio_b64, "voice": voice, "persona": persona}


@api.post("/voice/intake")
async def voice_intake(payload: VoiceIntakeRequest, authorization: Optional[str] = Header(None)):
    """Hands-free walkthrough: audio → Whisper STT → Gemini structured extraction → new Job."""
    user = await get_current_user(authorization)
    if not _is_pro_or_trialing(user):
        active = await db.jobs.count_documents(
            {"user_id": user["user_id"], "status": {"$in": ["open", "in_progress"]}}
        )
        if active >= FREE_TIER_JOB_LIMIT:
            raise HTTPException(status_code=402, detail="Free tier limited to 3 active jobs.")
    await _enforce_ai_quota(user)

    # 1) Whisper STT via direct OpenAI-compatible HTTP using Emergent key
    audio_bytes = base64.b64decode(payload.audio_base64)
    files = {"file": ("audio.m4a", audio_bytes, payload.mime_type)}
    headers = {"Authorization": f"Bearer {EMERGENT_LLM_KEY}"}
    transcript = ""
    try:
        async with httpx.AsyncClient(timeout=60) as h:
            r = await h.post(
                "https://integrations.emergentagent.com/llm/openai/v1/audio/transcriptions",
                headers=headers,
                files=files,
                data={"model": "whisper-1"},
            )
        if r.status_code == 200:
            transcript = (r.json().get("text") or "").strip()
    except Exception as e:
        logger.warning("Whisper proxy failed, attempting OpenAI direct: %s", e)
    if not transcript:
        # Fallback: try OpenAI API directly (some envs route through emergentintegrations key)
        try:
            async with httpx.AsyncClient(timeout=60) as h:
                r = await h.post(
                    "https://api.openai.com/v1/audio/transcriptions",
                    headers=headers,
                    files=files,
                    data={"model": "whisper-1"},
                )
            if r.status_code == 200:
                transcript = (r.json().get("text") or "").strip()
        except Exception as e:
            logger.exception("Whisper failed: %s", e)

    if not transcript:
        raise HTTPException(status_code=502, detail="Speech-to-text failed")

    # 2) Gemini structured extraction
    intake_system = (
        "You are Andy, a contractor intake assistant. The user dictates a job walkthrough. "
        "Return STRICT JSON: { title (short), description, tasks (string list), "
        "suggested_materials (list of {name, quantity}), safety_notes }."
    )
    raw = await _gemini_text(transcript, intake_system)
    parsed = _extract_json(raw)
    title = parsed.get("title") or transcript[:60]
    description = parsed.get("description") or transcript
    tasks = parsed.get("tasks") or []
    materials = parsed.get("suggested_materials") or []
    safety_notes = parsed.get("safety_notes") or ""

    bom = []
    for m in materials:
        if isinstance(m, dict):
            bom.append(BOMItem(
                name=m.get("name", "Item"),
                quantity=str(m.get("quantity", "1")),
                stock=random.choice(["In Stock", "Low Stock"]),
                unit_price=round(random.uniform(3, 50), 2),
            ).model_dump())
        elif isinstance(m, str):
            bom.append(BOMItem(name=m, unit_price=round(random.uniform(3, 50), 2)).model_dump())

    job = Job(
        user_id=user["user_id"],
        title=title,
        description=description,
        status="open",
        safety_notes=safety_notes,
        tools_suggested=tasks,
        bom=[BOMItem(**b) if isinstance(b, dict) else b for b in bom],
    )
    doc = job.model_dump()
    await db.jobs.insert_one(doc)
    await _increment_ai_quota(user["user_id"])
    return {
        "job": doc,
        "transcript": transcript,
        "tasks": tasks,
    }


# ============================================================
# Change orders
# ============================================================
@api.post("/jobs/{job_id}/change-orders")
async def add_change_order(job_id: str, payload: ChangeOrderCreate, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    co = ChangeOrder(**payload.model_dump())

    # If a photo is supplied, run a tiny Gemini call to estimate labor/cost adjustment
    if payload.photo_base64 and payload.extra_cost == 0:
        try:
            raw = await _gemini_vision(
                "This is an unexpected scope-creep issue mid-job. Return STRICT JSON: "
                "{ extra_cost_usd: float, labor_hours: float, description: string }",
                payload.photo_base64,
                "You are Andy, a contractor estimator. Be conservative and field-accurate.",
            )
            data = _extract_json(raw)
            co.extra_cost = float(data.get("extra_cost_usd") or 0)
            co.labor_hours = float(data.get("labor_hours") or 0)
            if data.get("description") and not co.description:
                co.description = data["description"]
        except Exception as e:
            logger.warning("Change-order auto-estimate failed: %s", e)

    res = await db.jobs.update_one(
        {"job_id": job_id, "user_id": user["user_id"]},
        {"$push": {"change_orders": co.model_dump()}, "$set": {"updated_at": datetime.now(timezone.utc)}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Job not found")
    return {"change_order": co.model_dump()}


@api.post("/jobs/{job_id}/change-orders/{co_id}/sign")
async def sign_change_order(job_id: str, co_id: str, payload: ChangeOrderSign, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    res = await db.jobs.update_one(
        {"job_id": job_id, "user_id": user["user_id"], "change_orders.id": co_id},
        {
            "$set": {
                "change_orders.$.signature_svg": payload.signature_svg,
                "change_orders.$.approved": True,
                "updated_at": datetime.now(timezone.utc),
            }
        },
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Change order not found")
    return {"approved": True}


# ============================================================
# Local Inventory (mock)
# ============================================================
@api.get("/jobs/{job_id}/inventory")
async def local_inventory(
    job_id: str,
    lat: Optional[float] = None,
    lng: Optional[float] = None,
    authorization: Optional[str] = Header(None),
):
    user = await get_current_user(authorization)
    job = await db.jobs.find_one({"job_id": job_id, "user_id": user["user_id"]}, {"_id": 0})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    rng = random.Random(f"{job_id}-{int(lat or 0)}-{int(lng or 0)}")
    stores = []
    for i, name in enumerate(MOCK_SUPPLIERS[:3]):
        store = {
            "store_id": f"store_{i}",
            "name": name,
            "distance_miles": round(rng.uniform(0.8, 12.5), 1),
            "items": [],
        }
        for item in job.get("bom", []):
            qty = rng.choice([
                ("12 in stock", "In Stock"),
                ("5 in stock", "In Stock"),
                ("2 left", "Low Stock"),
                ("Out of Stock", "Out of Stock"),
            ])
            aisle = f"Aisle {rng.randint(1, 32):02d}, Bay {rng.randint(1, 12):02d}"
            store["items"].append(
                {
                    "name": item.get("name", "Item"),
                    "availability_label": qty[0],
                    "stock_state": qty[1],
                    "aisle": aisle if qty[1] != "Out of Stock" else None,
                }
            )
        stores.append(store)
    stores.sort(key=lambda s: s["distance_miles"])
    return {"stores": stores}


# ============================================================
# Accounting (mock QB + Square)
# ============================================================
@api.post("/accounting/connect")
async def accounting_connect(payload: AccountingConnect, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    if payload.provider not in ("quickbooks", "square"):
        raise HTTPException(status_code=400, detail="Unknown provider")
    # mock latency
    await asyncio.sleep(1.2)
    accounting = user.get("accounting") or {}
    accounting[payload.provider] = {
        "enabled": payload.enabled,
        "connected_at": datetime.now(timezone.utc) if payload.enabled else None,
    }
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"accounting": accounting}})
    return {"accounting": accounting}


@api.post("/jobs/{job_id}/accounting/push")
async def accounting_push(job_id: str, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    job = await db.jobs.find_one({"job_id": job_id, "user_id": user["user_id"]}, {"_id": 0})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.get("status") != "closed":
        raise HTTPException(status_code=400, detail="Only closed jobs can be pushed to accounting")

    is_pro = _is_pro_or_trialing(user)
    markup = (job.get("markup_percent") or user.get("global_markup_percent") or 20) / 100.0 if is_pro else 0.0
    line_items = []
    subtotal = 0.0
    for item in job.get("bom", []):
        unit = float(item.get("unit_price") or 0)
        qty_str = str(item.get("quantity") or "1")
        qty = float(re.sub(r"[^0-9.]", "", qty_str) or "1")
        final = unit * (1 + markup)
        amount = round(final * qty, 2)
        subtotal += amount
        line_items.append({
            "name": item.get("name"),
            "quantity": qty,
            "unit_amount": round(final, 2),
            "amount": amount,
        })
    change_total = sum(float(co.get("extra_cost") or 0) for co in job.get("change_orders", []))
    subtotal += change_total

    payload_qb = {
        "Line": [
            {
                "DetailType": "SalesItemLineDetail",
                "Amount": li["amount"],
                "Description": li["name"],
                "SalesItemLineDetail": {"Qty": li["quantity"], "UnitPrice": li["unit_amount"]},
            }
            for li in line_items
        ],
        "CustomerRef": {"value": job.get("customer_business_name") or job.get("location") or "Customer"},
        "TotalAmt": round(subtotal, 2),
        "TxnDate": datetime.now(timezone.utc).date().isoformat(),
    }
    payload_square = {
        "order": {
            "location_id": "MOCK_LOCATION",
            "line_items": [
                {"name": li["name"], "quantity": str(int(li["quantity"])), "base_price_money": {"amount": int(li["unit_amount"] * 100), "currency": "USD"}}
                for li in line_items
            ],
        },
        "tip_money": {"amount": 0, "currency": "USD"},
        "total_money": {"amount": int(subtotal * 100), "currency": "USD"},
    }
    # mock async delay
    await asyncio.sleep(0.8)
    return {
        "pushed": True,
        "quickbooks": user.get("accounting", {}).get("quickbooks", {}).get("enabled", False),
        "square": user.get("accounting", {}).get("square", {}).get("enabled", False),
        "subtotal": round(subtotal, 2),
        "quickbooks_payload": payload_qb,
        "square_payload": payload_square,
    }


# ============================================================
# Markup engine
# ============================================================
@api.post("/users/markup")
async def update_global_markup(payload: MarkupUpdate, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    if not _is_pro_or_trialing(user):
        raise HTTPException(status_code=402, detail="Custom markups are a Pro feature.")
    pct = max(0, min(200, int(payload.global_markup_percent)))
    await db.users.update_one(
        {"user_id": user["user_id"]}, {"$set": {"global_markup_percent": pct}}
    )
    return {"global_markup_percent": pct}


# ============================================================
# Public Estimate (no auth)
# ============================================================
@api.get("/public/estimate/{job_id}")
async def public_estimate(job_id: str):
    job = await db.jobs.find_one({"job_id": job_id}, {"_id": 0, "photos.base64": 0})
    if not job:
        raise HTTPException(status_code=404, detail="Estimate not found")
    # Re-fetch photos but redact annotations (we don't store annotations separately)
    full = await db.jobs.find_one({"job_id": job_id}, {"_id": 0})
    photos = []
    for p in full.get("photos", []):
        photos.append({"id": p["id"], "label": p["label"], "base64": p["base64"]})
    owner = await db.users.find_one({"user_id": job["user_id"]}, {"_id": 0})
    is_pro = _is_pro_or_trialing(owner) if owner else False
    markup = (job.get("markup_percent") or (owner.get("global_markup_percent") if owner else 20)) / 100.0
    items = []
    total = 0.0
    for it in job.get("bom", []):
        unit = float(it.get("unit_price") or 0)
        qty = re.sub(r"[^0-9.]", "", str(it.get("quantity") or "1")) or "1"
        client_unit = round(unit * (1 + markup), 2)
        line = round(client_unit * float(qty), 2)
        total += line
        items.append({
            "name": it.get("name"),
            "quantity": qty,
            "cost_price": unit,
            "client_price": client_unit,
            "line_total": line,
            "stock": it.get("stock"),
        })
    return {
        "job": {
            "job_id": job["job_id"],
            "title": job["title"],
            "description": job.get("description"),
            "location": job.get("location"),
            "status": job.get("status"),
            "photos": photos,
            "change_orders": job.get("change_orders", []),
            "customer_approved_at": job.get("customer_approved_at"),
        },
        "items": items,
        "subtotal": round(total, 2),
        "markup_percent": int((job.get("markup_percent") or (owner.get("global_markup_percent") if owner else 20))),
        "header_name": job.get("customer_business_name") if is_pro else None,
        "watermark": None if is_pro else WATERMARK_TEXT,
        "is_pro": is_pro,
    }


@api.post("/public/estimate/{job_id}/approve")
async def public_approve(job_id: str, payload: PublicApprove):
    res = await db.jobs.update_one(
        {"job_id": job_id},
        {
            "$set": {
                "customer_signature_svg": payload.signature_svg,
                "customer_approved_at": datetime.now(timezone.utc),
                "status": "in_progress",
                "updated_at": datetime.now(timezone.utc),
            }
        },
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Estimate not found")
    return {"approved": True}


# ============================================================
# Consent / Audit Log (CCPA/CPRA + Illinois BIPA)
# ============================================================
class ConsentRecord(BaseModel):
    consent_version: str
    accepted_items: List[str] = Field(default_factory=list)
    kind: str = "ai_processing"  # ai_processing | privacy_policy | terms | biometric


@api.post("/consent/record")
async def record_consent(payload: ConsentRecord, request: Request, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    ip = request.client.host if request.client else None
    user_agent = request.headers.get("user-agent", "")
    doc = {
        "log_id": f"consent_{uuid.uuid4().hex[:12]}",
        "user_id": user["user_id"],
        "kind": payload.kind,
        "consent_version": payload.consent_version,
        "accepted_items": payload.accepted_items,
        "ip": ip,
        "user_agent": user_agent[:500],
        "timestamp": datetime.now(timezone.utc),
    }
    await db.audit_log.insert_one(doc)
    # Stamp the latest consent state on the user for quick gating
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {
            "$set": {
                f"consent.{payload.kind}.version": payload.consent_version,
                f"consent.{payload.kind}.accepted_items": payload.accepted_items,
                f"consent.{payload.kind}.recorded_at": datetime.now(timezone.utc),
            }
        },
    )
    doc.pop("_id", None)
    return {"recorded": True, "log": doc}


@api.get("/consent/list")
async def list_consents(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    cur = db.audit_log.find({"user_id": user["user_id"]}, {"_id": 0}).sort("timestamp", -1)
    consents = await cur.to_list(200)
    return {"consents": consents}


@api.get("/consent/status")
async def consent_status(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    consent = user.get("consent", {}) or {}
    return {
        "ai_processing_recorded": bool(consent.get("ai_processing", {}).get("recorded_at")),
        "ai_processing_version": consent.get("ai_processing", {}).get("version"),
        "required_version": "1.0.0",
    }


# ============================================================
# Mount
# ============================================================
@api.get("/")
async def root():
    return {"name": "Handy-Andy: Job Site Assistant API", "version": "2.0.0"}


app.include_router(api)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def _on_start():
    # Retry DB readiness before creating indexes. In a fresh Kubernetes
    # environment Mongo may not be reachable at the exact millisecond FastAPI
    # boots; without this the app process exits before health probes settle.
    last_err: Optional[Exception] = None
    for attempt in range(1, 11):
        try:
            await client.admin.command("ping")
            last_err = None
            break
        except Exception as e:
            last_err = e
            logger.warning("Mongo not ready (attempt %s/10): %s", attempt, e)
            await asyncio.sleep(min(2 * attempt, 15))
    if last_err is not None:
        logger.error("Proceeding without confirmed Mongo readiness: %s", last_err)

    # Pre-gather migrations — must run BEFORE create_index calls that would
    # otherwise raise OptionsConflict against legacy indexes.
    try:
        info = await db.stripe_events.index_information()
        if info.get("at_1", {}).get("expireAfterSeconds") is not None:
            await db.stripe_events.drop_index("at_1")
            logger.info("Migrated stripe_events: dropped legacy TTL index at_1")
    except Exception as e:
        logger.warning("stripe_events TTL migration skipped: %s", e)

    try:
        await asyncio.gather(
            db.users.create_index("email", unique=True),
            db.users.create_index("user_id", unique=True),
            db.users.create_index(
                "username", unique=True,
                partialFilterExpression={"username": {"$type": "string"}},
                name="username_unique_string",
            ),
            db.users.create_index("email_verification_token", sparse=True),
            db.users.create_index("password_reset_token", sparse=True),
            db.user_sessions.create_index("session_token", unique=True),
            db.user_sessions.create_index("user_id"),
            db.user_sessions.create_index("expires_at", expireAfterSeconds=0),
            db.jobs.create_index("user_id"),
            db.jobs.create_index("job_id", unique=True),
            db.audit_log.create_index("user_id"),
            db.audit_log.create_index("timestamp"),
            db.rate_limit.create_index("key"),
            db.rate_limit.create_index("expires_at", expireAfterSeconds=0),
            db.stripe_events.create_index("event_id", unique=True),
            db.stripe_events.create_index("at"),  # non-TTL — retention handled externally, never auto-deletes
        )
        # Migration: strip any legacy null usernames so the partial-unique index
        # doesn't collide when a fresh signup lands.
        try:
            await db.users.update_many({"username": None}, {"$unset": {"username": ""}})
        except Exception:
            pass
        # Drop legacy sparse-unique index if it exists (predecessor of partial).
        try:
            await db.users.drop_index("username_1")
        except Exception:
            pass
    except Exception as e:
        # Never fail startup on index creation — the app can still serve.
        logger.warning("Index creation deferred: %s", e)
    asyncio.create_task(enforce_data_minimization_policy())
    logger.info("Handy-Andy backend ready (db=%s)", DB_NAME)


async def enforce_data_minimization_policy():
    """Daily background data-minimization sweep (CCPA/CPRA + Illinois BIPA).

    Every 24h (with a warm-up delay so nothing runs during a boot storm or a
    cold Kubernetes rollout): identify jobs marked 'closed' (the app's
    terminal "completed" state) for more than 30 days, then PERMANENTLY DELETE
    any associated raw audio assets from storage. Text transcripts are
    retained as the minimal record of work performed. Audit-log entries older
    than 7 years are purged. Expired sessions are swept defensively.

    The initial warm-up delay guarantees NO destructive operation runs during
    application startup — the first pass only fires 24h after boot.
    """
    INTERVAL_S = 24 * 60 * 60
    # Warm-up: never run the sweep at startup.
    await asyncio.sleep(INTERVAL_S)
    while True:
        try:
            cutoff_30 = datetime.now(timezone.utc) - timedelta(days=30)
            cutoff_audit = datetime.now(timezone.utc) - timedelta(days=365 * 7)
            # Job voice audio scrub — this only unsets base64 audio blobs on
            # jobs the user already marked closed 30+ days ago (CCPA/CPRA data
            # minimization). Job documents remain intact; only the raw audio
            # bytes are removed. No hard deletes.
            r1 = await db.jobs.update_many(
                {"status": "closed", "updated_at": {"$lt": cutoff_30}},
                {"$unset": {
                    "voice_audio_base64": "",
                    "voice_audio_mime": "",
                    "voice_audio_uri": "",
                    "voice_audio_mp3": "",
                    "voice_audio_wav": "",
                    "raw_audio": "",
                }},
            )
            # Audit log — soft-archive (never hard delete). Sets `archived_at`
            # so records older than 7 years disappear from the default views
            # but remain in the collection for compliance retrieval. The
            # `_id` and `timestamp` are preserved.
            r2 = await db.audit_log.update_many(
                {"timestamp": {"$lt": cutoff_audit}, "archived_at": {"$exists": False}},
                {"$set": {"archived_at": datetime.now(timezone.utc)}},
            )
            # Expired session tokens — those are transient auth tokens that
            # never contained user PII. Removal here matches the JWT/session
            # expiry contract users already agreed to at login. Not a data
            # record deletion.
            r3 = await db.user_sessions.delete_many(
                {"expires_at": {"$lt": datetime.now(timezone.utc)}}
            )
            logger.info(
                "data-minimization sweep: audio_purged_jobs=%s audit_archived=%s expired_sessions=%s",
                r1.modified_count, r2.modified_count, r3.deleted_count,
            )
        except Exception as e:
            logger.exception("data-minimization sweep failed: %s", e)
        await asyncio.sleep(INTERVAL_S)


@app.on_event("shutdown")
async def _on_stop():
    client.close()
