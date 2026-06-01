"""J.P. The Handyman: Pro Tools & Diagnostics — FastAPI backend."""

import asyncio
import base64
import json
import logging
import os
import re
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import List, Optional

import httpx
from dotenv import load_dotenv
from fastapi import APIRouter, FastAPI, Header, HTTPException
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field
from starlette.middleware.cors import CORSMiddleware

from emergentintegrations.llm.chat import ImageContent, LlmChat, UserMessage
from emergentintegrations.llm.openai.text_to_speech import OpenAITextToSpeech

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
EMERGENT_LLM_KEY = os.environ["EMERGENT_LLM_KEY"]

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("jp_handyman")

app = FastAPI(title="J.P. The Handyman API")
api = APIRouter(prefix="/api")


# ============================================================
# Models
# ============================================================

class UserPublic(BaseModel):
    user_id: str
    email: str
    name: str
    picture: Optional[str] = None
    created_at: datetime


class SessionRequest(BaseModel):
    session_token: str


class BOMItem(BaseModel):
    name: str
    quantity: str = "1"
    stock: str = "In Stock"  # In Stock | Low Stock | Out of Stock


class Photo(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    label: str = "before"  # before | after
    base64: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class Job(BaseModel):
    job_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    title: str
    description: str = ""
    status: str = "open"  # open | in_progress | emergent | closed
    safety_notes: str = ""
    location: str = ""
    tools_suggested: List[str] = Field(default_factory=list)
    bom: List[BOMItem] = Field(default_factory=list)
    photos: List[Photo] = Field(default_factory=list)
    ai_diagnostic: str = ""
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


class VoiceGreetRequest(BaseModel):
    persona: str = "standard"  # standard | folksy | southern | sassy
    name: Optional[str] = None
    pitch: Optional[float] = 1.0  # client-side cue
    pace: Optional[float] = 1.0


# ============================================================
# Helpers
# ============================================================

PERSONA_VOICES = {
    "standard": ("onyx", "Speak in a calm, professional handyman tone."),
    "folksy": ("fable", "Speak in a warm, folksy small-town tone. Use friendly idioms."),
    "southern": ("echo", "Speak in a relaxed Southern drawl. Friendly and slow."),
    "sassy": ("nova", "Speak with sassy confidence and a touch of humor."),
}


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
    """Pull a JSON object out of an LLM response (handles ```json fences)."""
    if not text:
        return {}
    # strip fences
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


async def _gemini_vision(prompt: str, image_base64: str, system: str) -> str:
    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"vision-{uuid.uuid4().hex[:8]}",
        system_message=system,
    ).with_model("gemini", "gemini-2.5-flash")

    # Strip "data:image/...;base64," prefix if present
    raw = image_base64.split(",", 1)[-1] if image_base64.startswith("data:") else image_base64
    img = ImageContent(image_base64=raw)
    msg = UserMessage(text=prompt, file_contents=[img])
    return await chat.send_message(msg)


# ============================================================
# Auth Routes
# ============================================================

@api.post("/auth/session")
async def create_session(payload: SessionRequest):
    """Exchange a session_id from Emergent auth for an app session.

    The frontend calls this with the session_token it received from
    https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data .
    We trust that token, look up the profile against the same endpoint,
    upsert the user, and persist our own session row.
    """
    headers = {"X-Session-ID": payload.session_token}
    async with httpx.AsyncClient(timeout=15) as h:
        r = await h.get(
            "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
            headers=headers,
        )
    if r.status_code != 200:
        # fall back: treat the token itself as the session token (already validated upstream)
        raise HTTPException(status_code=401, detail="Failed to validate session with Emergent")
    data = r.json()
    email = data.get("email")
    name = data.get("name") or email
    picture = data.get("picture")
    session_token = data.get("session_token") or payload.session_token
    if not email:
        raise HTTPException(status_code=400, detail="No email in session data")

    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        user_id = existing["user_id"]
        await db.users.update_one(
            {"user_id": user_id},
            {"$set": {"name": name, "picture": picture}},
        )
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        await db.users.insert_one(
            {
                "user_id": user_id,
                "email": email,
                "name": name,
                "picture": picture,
                "created_at": datetime.now(timezone.utc),
            }
        )

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
    return {"session_token": session_token, "user": user_doc, "expires_at": expires_at}


@api.get("/auth/me")
async def whoami(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    return {"user": user}


@api.post("/auth/logout")
async def logout(authorization: Optional[str] = Header(None)):
    if authorization and authorization.startswith("Bearer "):
        token = authorization[len("Bearer "):].strip()
        await db.user_sessions.delete_one({"session_token": token})
    return {"ok": True}


# ============================================================
# Dev login (for testing/Expo Go without OAuth round-trip)
# ============================================================

class DevLoginRequest(BaseModel):
    email: str
    name: Optional[str] = None


@api.post("/auth/dev-login")
async def dev_login(payload: DevLoginRequest):
    """Tester-only shortcut to mint a session without going through Google.

    Useful for the testing_agent and for Expo Go users where the OAuth
    redirect can be flaky. Creates/updates a user and returns a token.
    """
    email = payload.email.strip().lower()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Valid email required")
    name = payload.name or email.split("@", 1)[0].title()

    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        user_id = existing["user_id"]
        await db.users.update_one({"user_id": user_id}, {"$set": {"name": name}})
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        await db.users.insert_one(
            {
                "user_id": user_id,
                "email": email,
                "name": name,
                "picture": None,
                "created_at": datetime.now(timezone.utc),
            }
        )

    session_token = f"dev_{uuid.uuid4().hex}"
    expires_at = datetime.now(timezone.utc) + timedelta(days=7)
    await db.user_sessions.insert_one(
        {
            "session_token": session_token,
            "user_id": user_id,
            "expires_at": expires_at,
            "created_at": datetime.now(timezone.utc),
        }
    )
    user_doc = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    return {"session_token": session_token, "user": user_doc}


# ============================================================
# Jobs
# ============================================================

DEMO_JOBS = [
    {
        "title": "Kitchen Faucet Leak — Apt 3B",
        "description": "Continuous drip at the base of the faucet. Tenant reports water pooling under the sink overnight.",
        "status": "in_progress",
        "safety_notes": "Shut off hot/cold supply valves before disassembly. Inspect cabinet floor for rot.",
        "location": "412 Oakwood Ave, Unit 3B",
        "tools_suggested": ["Basin wrench", "Plumber's tape", "Adjustable wrench"],
        "bom": [
            {"name": "Cartridge replacement", "quantity": "1", "stock": "In Stock"},
            {"name": "O-ring kit", "quantity": "1", "stock": "Low Stock"},
            {"name": "Plumber's tape (1 roll)", "quantity": "1", "stock": "In Stock"},
        ],
    },
    {
        "title": "Drywall Patch — Hallway Impact Hole",
        "description": "Roughly 4-inch hole from doorknob impact. Needs patch, sand, prime, and paint match.",
        "status": "open",
        "safety_notes": "Wear N95 when sanding compound. Drop cloth required.",
        "location": "78 Birch Lane",
        "tools_suggested": ["Drywall saw", "Putty knife", "Sanding block"],
        "bom": [
            {"name": "Drywall patch kit (6x6)", "quantity": "1", "stock": "In Stock"},
            {"name": "Joint compound (quart)", "quantity": "1", "stock": "In Stock"},
            {"name": "Primer (touch-up)", "quantity": "1", "stock": "Low Stock"},
        ],
    },
    {
        "title": "URGENT — Exposed Wiring in Garage",
        "description": "Homeowner found bare conductors near breaker panel. Power to garage circuit suspected live.",
        "status": "emergent",
        "safety_notes": "DO NOT touch. Kill main breaker before inspection. Lockout/tagout required.",
        "location": "29 Maple Ridge Dr",
        "tools_suggested": ["Non-contact voltage tester", "Wire nuts", "Electrical tape"],
        "bom": [
            {"name": "12 AWG THHN wire (10 ft)", "quantity": "1", "stock": "In Stock"},
            {"name": "Wire nuts (assorted)", "quantity": "1", "stock": "In Stock"},
            {"name": "Junction box", "quantity": "1", "stock": "Out of Stock"},
        ],
    },
    {
        "title": "Deck Board Replacement — Back Patio",
        "description": "Two pressure-treated boards rotted through. Replace and re-stain matching existing finish.",
        "status": "closed",
        "safety_notes": "Verify no live wires below decking before cutting.",
        "location": "1102 Hilltop Ct",
        "tools_suggested": ["Circular saw", "Pry bar", "Impact driver"],
        "bom": [
            {"name": "Pressure-treated 2x6 (8 ft)", "quantity": "2", "stock": "In Stock"},
            {"name": "Deck screws (1 lb)", "quantity": "1", "stock": "In Stock"},
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
    # Drop photos to keep payloads lean
    for j in jobs:
        j["photo_count"] = len(j.get("photos", []))
        j.pop("photos", None)
    return {"jobs": jobs}


@api.post("/jobs")
async def create_job(payload: JobCreate, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
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
        {"job_id": job_id, "user_id": user["user_id"]},
        {"$set": updates},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Job not found")
    job = await db.jobs.find_one({"job_id": job_id}, {"_id": 0})
    return {"job": job}


@api.post("/jobs/{job_id}/photos")
async def add_photo(job_id: str, payload: PhotoAdd, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    photo = Photo(label=payload.label, base64=payload.base64)
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
# AI Vision
# ============================================================

ANALYZE_SYSTEM = (
    "You are J.P., a master handyman and field technician AI. Given a photo of a "
    "repair task, return a strictly-formatted JSON object with the keys: "
    "`diagnostic` (short paragraph), `tools` (list of strings), `bom` (list of "
    "{name, quantity, stock} where stock is 'In Stock' or 'Low Stock'), and "
    "`safety_notes` (string). Be concise, pragmatic, and field-ready."
)


@api.post("/ai/analyze-job")
async def analyze_job(payload: AnalyzeRequest, authorization: Optional[str] = Header(None)):
    await get_current_user(authorization)
    prompt = (
        "Analyze the attached job-site photo and produce the JSON object. "
        + (f"Additional context: {payload.context}" if payload.context else "")
    )
    try:
        raw = await _gemini_vision(prompt, payload.image_base64, ANALYZE_SYSTEM)
    except Exception as e:
        logger.exception("Gemini analyze failed: %s", e)
        raise HTTPException(status_code=502, detail=f"AI vision failed: {e}")
    data = _extract_json(raw)
    return {
        "diagnostic": data.get("diagnostic", raw[:600]),
        "tools": data.get("tools", []),
        "bom": data.get("bom", []),
        "safety_notes": data.get("safety_notes", ""),
        "raw": raw,
    }


DIAG_SYSTEM = (
    "You are J.P., a diagnostic field assistant. Given a photo of a broken "
    "asset, return JSON: `root_cause` (string), `severity` ('low'|'medium'|'high'), "
    "`steps` (numbered list of strings — the repair blueprint), `tools` (list), "
    "`safety_warnings` (list)."
)


@api.post("/ai/diagnostic")
async def ai_diagnostic(payload: DiagnosticRequest, authorization: Optional[str] = Header(None)):
    await get_current_user(authorization)
    prompt = (
        "Diagnose the failure in this photo. Field-ready, no fluff. "
        + (f"Tech notes: {payload.notes}" if payload.notes else "")
    )
    try:
        raw = await _gemini_vision(prompt, payload.image_base64, DIAG_SYSTEM)
    except Exception as e:
        logger.exception("Gemini diag failed: %s", e)
        raise HTTPException(status_code=502, detail=f"AI vision failed: {e}")
    data = _extract_json(raw)
    return {
        "root_cause": data.get("root_cause", raw[:400]),
        "severity": data.get("severity", "medium"),
        "steps": data.get("steps", []),
        "tools": data.get("tools", []),
        "safety_warnings": data.get("safety_warnings", []),
        "raw": raw,
    }


SAFETY_SYSTEM = (
    "You are J.P., a job-site safety officer. Evaluate hazards visible in the "
    "photo and described context. Return JSON: `hazards` (list of "
    "{name, severity, mitigation}), `osha_flags` (list of strings), "
    "`overall_rating` ('safe'|'caution'|'unsafe'), `recommendation` (string)."
)


@api.post("/ai/safety")
async def ai_safety(payload: SafetyRequest, authorization: Optional[str] = Header(None)):
    await get_current_user(authorization)
    if not payload.image_base64:
        # text-only fallback
        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=f"safety-{uuid.uuid4().hex[:8]}",
            system_message=SAFETY_SYSTEM,
        ).with_model("gemini", "gemini-2.5-flash")
        text = (
            f"No photo provided. Location: {payload.location or 'unspecified'}. "
            f"Notes: {payload.notes or 'none'}. Produce the JSON evaluation."
        )
        try:
            raw = await chat.send_message(UserMessage(text=text))
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"AI safety failed: {e}")
    else:
        ctx = []
        if payload.location:
            ctx.append(f"Location: {payload.location}")
        if payload.notes:
            ctx.append(f"Notes: {payload.notes}")
        prompt = "Evaluate the job-site for hazards. " + " ".join(ctx)
        try:
            raw = await _gemini_vision(prompt, payload.image_base64, SAFETY_SYSTEM)
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"AI safety failed: {e}")
    data = _extract_json(raw)
    return {
        "hazards": data.get("hazards", []),
        "osha_flags": data.get("osha_flags", []),
        "overall_rating": data.get("overall_rating", "caution"),
        "recommendation": data.get("recommendation", raw[:400]),
        "raw": raw,
    }


# ============================================================
# Voice / TTS
# ============================================================

@api.post("/voice/greet")
async def voice_greet(payload: VoiceGreetRequest, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    persona = payload.persona.lower() if payload.persona else "standard"
    voice, flavor = PERSONA_VOICES.get(persona, PERSONA_VOICES["standard"])

    name = payload.name or user.get("name") or "partner"
    # Build a short, persona-tinted greeting via Gemini, then synthesize
    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"greet-{uuid.uuid4().hex[:8]}",
        system_message=(
            "You are J.P., a handyman assistant. Produce one short greeting (2 "
            f"sentences max, under 220 chars). {flavor} Address the user by name."
        ),
    ).with_model("gemini", "gemini-2.5-flash")
    try:
        text = await chat.send_message(
            UserMessage(text=f"Greet {name}. Welcome them back to the J.P. toolkit and offer to help.")
        )
    except Exception as e:
        logger.warning("Greeting text gen failed: %s", e)
        text = f"Hey {name}, J.P. here. Tools loaded — let's go to work."

    text = (text or "").strip().strip('"').strip()
    if len(text) > 400:
        text = text[:400]

    tts = OpenAITextToSpeech(api_key=EMERGENT_LLM_KEY)
    speed = max(0.5, min(2.0, payload.pace or 1.0))
    try:
        audio_b64 = await tts.generate_speech_base64(
            text=text, model="tts-1", voice=voice, speed=speed, response_format="mp3"
        )
    except Exception as e:
        logger.exception("TTS failed: %s", e)
        raise HTTPException(status_code=502, detail=f"TTS failed: {e}")
    return {"text": text, "audio_base64": audio_b64, "voice": voice, "persona": persona}


# ============================================================
# Mount
# ============================================================

@api.get("/")
async def root():
    return {"name": "J.P. The Handyman API", "version": "1.0.0"}


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
    )
    logger.info("J.P. backend ready (db=%s)", DB_NAME)


@app.on_event("shutdown")
async def _on_stop():
    client.close()
