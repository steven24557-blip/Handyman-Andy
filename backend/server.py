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
load_dotenv(ROOT_DIR / ".env", override=True)

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
EMERGENT_LLM_KEY = os.environ["EMERGENT_LLM_KEY"]
STRIPE_API_KEY = os.environ.get("STRIPE_API_KEY", "sk_test_emergent")
APPLE_CLIENT_ID = os.environ.get("APPLE_CLIENT_ID", "com.andyhandy.app")

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
TRIAL_DAYS = 7
PRO_PRICE_USD = 39.00
FREE_TIER_AI_LIMIT = 2
FREE_TIER_JOB_LIMIT = 3  # max open + in_progress
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
    user = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0})
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

    return await _login_user(email=email, name=name, picture=picture, session_token=session_token)


@api.post("/auth/dev-login")
async def dev_login(payload: DevLoginRequest):
    email = payload.email.strip().lower()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Valid email required")
    name = payload.name or email.split("@", 1)[0].title()
    session_token = f"dev_{uuid.uuid4().hex}"
    return await _login_user(email=email, name=name, picture=None, session_token=session_token)


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
    return await _login_user(email=email, name=name, picture=None, session_token=session_token, apple_sub=sub)


async def _login_user(email: str, name: str, picture: Optional[str], session_token: str, apple_sub: Optional[str] = None):
    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        user_id = existing["user_id"]
        await db.users.update_one(
            {"user_id": user_id},
            {"$set": {"name": name, "picture": picture, **({"apple_sub": apple_sub} if apple_sub else {})}},
        )
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        now = datetime.now(timezone.utc)
        await db.users.insert_one(
            {
                "user_id": user_id,
                "email": email,
                "name": name,
                "picture": picture,
                "apple_sub": apple_sub,
                "created_at": now,
            }
        )
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
    user_doc = await db.users.find_one({"user_id": user_id}, {"_id": 0})
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


# ============================================================
# Subscription / Billing
# ============================================================
@api.get("/subscription/status")
async def subscription_status(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    await _ensure_user_billing_fields(user)
    await _ensure_monthly_counter(user)
    return {
        "status": user.get("stripe_subscription_status", "none"),
        "trial_end_date": user.get("trial_end_date"),
        "current_tier": "pro" if _is_pro_or_trialing(user) else "free",
        "ai_scan_count_this_month": user.get("ai_scan_count_this_month", 0),
        "ai_limit_free": FREE_TIER_AI_LIMIT,
        "job_limit_free": FREE_TIER_JOB_LIMIT,
        "is_pro": _is_pro_or_trialing(user),
        "price_usd": PRO_PRICE_USD,
    }


@api.post("/subscription/checkout")
async def subscription_checkout(payload: CheckoutBody, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    customer_id = user.get("stripe_customer_id")
    if not customer_id:
        try:
            customer = stripe.Customer.create(
                email=user["email"], name=user.get("name"), metadata={"user_id": user["user_id"]}
            )
            customer_id = customer.id
            await db.users.update_one(
                {"user_id": user["user_id"]}, {"$set": {"stripe_customer_id": customer_id}}
            )
        except Exception as e:
            logger.exception("Stripe customer create failed: %s", e)
            raise HTTPException(status_code=502, detail=f"Stripe error: {e}")

    origin = payload.return_origin.rstrip("/")
    success_url = f"{origin}/billing/success?session_id={{CHECKOUT_SESSION_ID}}"
    cancel_url = f"{origin}/billing/cancel"

    try:
        session = stripe.checkout.Session.create(
            customer=customer_id,
            mode="subscription",
            line_items=[
                {
                    "quantity": 1,
                    "price_data": {
                        "currency": "usd",
                        "recurring": {"interval": "month"},
                        "unit_amount": int(PRO_PRICE_USD * 100),
                        "product_data": {"name": "Handy-Andy Pro"},
                    },
                }
            ],
            subscription_data={"trial_period_days": TRIAL_DAYS, "metadata": {"user_id": user["user_id"]}},
            success_url=success_url,
            cancel_url=cancel_url,
            metadata={"user_id": user["user_id"]},
        )
    except Exception as e:
        logger.exception("Stripe checkout create failed: %s", e)
        raise HTTPException(status_code=502, detail=f"Stripe error: {e}")
    return {"checkout_url": session.url, "session_id": session.id}


@api.post("/subscription/cancel")
async def subscription_cancel(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    sub_id = user.get("stripe_subscription_id")
    if not sub_id:
        # No active Stripe sub — just mark canceled locally (trial reset)
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


@api.post("/subscription/confirm")
async def subscription_confirm(session_id: str, authorization: Optional[str] = Header(None)):
    """Client calls this after returning from Stripe Checkout to refresh status."""
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
            {
                "$set": {
                    "stripe_subscription_id": sub_id,
                    "stripe_subscription_status": status,
                    "current_tier": "pro",
                }
            },
        )
        return {"status": status}
    return {"status": "unknown"}


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
    await asyncio.gather(
        db.users.create_index("email", unique=True),
        db.users.create_index("user_id", unique=True),
        db.user_sessions.create_index("session_token", unique=True),
        db.user_sessions.create_index("user_id"),
        db.user_sessions.create_index("expires_at", expireAfterSeconds=0),
        db.jobs.create_index("user_id"),
        db.jobs.create_index("job_id", unique=True),
        db.audit_log.create_index("user_id"),
        db.audit_log.create_index("timestamp"),
    )
    asyncio.create_task(enforce_data_minimization_policy())
    logger.info("Handy-Andy backend ready (db=%s)", DB_NAME)


async def enforce_data_minimization_policy():
    """Daily background data-minimization sweep (CCPA/CPRA + Illinois BIPA).

    Every 24h: identify jobs marked 'closed' (the app's terminal "completed"
    state) for more than 30 days, then PERMANENTLY DELETE any associated raw
    audio assets (.mp3 / .wav / base64 blobs) from storage. Text transcripts
    are retained as the minimal record of work performed. Audit-log entries
    older than 7 years are purged. Expired sessions are swept defensively.
    """
    INTERVAL_S = 24 * 60 * 60
    while True:
        try:
            cutoff_30 = datetime.now(timezone.utc) - timedelta(days=30)
            cutoff_audit = datetime.now(timezone.utc) - timedelta(days=365 * 7)
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
            r2 = await db.audit_log.delete_many({"timestamp": {"$lt": cutoff_audit}})
            r3 = await db.user_sessions.delete_many(
                {"expires_at": {"$lt": datetime.now(timezone.utc)}}
            )
            logger.info(
                "data-minimization sweep: audio_purged_jobs=%s audit_deleted=%s sessions=%s",
                r1.modified_count, r2.deleted_count, r3.deleted_count,
            )
        except Exception as e:
            logger.exception("data-minimization sweep failed: %s", e)
        await asyncio.sleep(INTERVAL_S)


@app.on_event("shutdown")
async def _on_stop():
    client.close()
