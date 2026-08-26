"""
FastAPI app for the ADK backend.

Serves:
  POST /api/scan-bill   — 3-image multimodal bill scan
  ADK built-in routes   — served by `adk api_server` (mounts /run, /events etc.)

Run locally:
  cd adk-backend
  adk web           # includes the dev UI at /dev-ui/
  # OR for REST-only:
  uvicorn main:app --reload --port 8000
"""

import base64
import json
import logging
import os
from contextlib import asynccontextmanager
from typing import List

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

try:
    from google.adk.runners import Runner
    from google.adk.sessions import InMemorySessionService
except (ImportError, ModuleNotFoundError):
    class Runner:  # type: ignore
        def __init__(self, **kwargs):
            for k, v in kwargs.items():
                setattr(self, k, v)
    class InMemorySessionService:  # type: ignore
        async def create_session(self, **kwargs):
            class _Session:
                id = "mock-session"
            return _Session()

try:
    from google.genai import types as genai_types
except (ImportError, ModuleNotFoundError):
    class _Blob:  # type: ignore
        def __init__(self, mime_type=None, data=None):
            self.mime_type = mime_type
            self.data = data
    class _Part:  # type: ignore
        def __init__(self, inline_data=None, text=None):
            self.inline_data = inline_data
            self.text = text
    class _Content:  # type: ignore
        def __init__(self, role=None, parts=None):
            self.role = role
            self.parts = parts or []
    class genai_types:  # type: ignore
        Blob = _Blob
        Part = _Part
        Content = _Content

from agent import root_agent
from agents.bill_scan_agent import create_bill_scan_agent
from telemetry import init_telemetry, trace_span

logger = logging.getLogger("adk_backend")


# ─── App ──────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="Utility Bill ADK Backend",
    description="Singapore utility bill AI agent — scan, calculate, save.",
    version="1.0.0",
)

# Initialize Arize Phoenix / OpenTelemetry instrumentation
init_telemetry(app)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:57771"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Bill scan endpoint & Model Fallback Configuration ────────────────────────

PRIMARY_SCAN_MODEL = os.getenv("SCAN_PRIMARY_MODEL", os.getenv("LLM_MODEL", "gemini-3.5-flash"))
FALLBACK_SCAN_MODEL = os.getenv(
    "SCAN_FALLBACK_MODEL",
    "gemini-3.7-flash" if "3.5" in PRIMARY_SCAN_MODEL else "gemini-3.5-flash",
)

_scan_sessions = InMemorySessionService()
_scan_runners: dict[str, Runner] = {}


def get_scan_runner(model_name: str) -> Runner:
    """Retrieve or lazily initialize an ADK Runner for a specific model."""
    if model_name not in _scan_runners:
        agent = create_bill_scan_agent(model_name=model_name)
        _scan_runners[model_name] = Runner(
            agent=agent,
            app_name=f"utility-bill-scanner-{model_name}",
            session_service=_scan_sessions,
        )
    return _scan_runners[model_name]


def get_candidate_models() -> List[str]:
    """Returns ordered list of models to try for bill scanning (primary -> fallback)."""
    candidates = [PRIMARY_SCAN_MODEL]
    if FALLBACK_SCAN_MODEL and FALLBACK_SCAN_MODEL not in candidates:
        candidates.append(FALLBACK_SCAN_MODEL)
    return candidates


def is_fallback_candidate_error(exc: Exception) -> bool:
    """
    Check if an exception is a transient, rate-limit, or timeout scenario
    (e.g., HTTP 503, 429, 524, 504, timeouts, high demand) suitable for model fallback.
    """
    status_code = getattr(exc, "status_code", None) or getattr(exc, "code", None)
    if status_code in (429, 500, 503, 504, 524):
        return True

    err_str = str(exc).lower()
    fallback_keywords = [
        "503", "429", "524", "504",
        "resource_exhausted", "resourceexhausted",
        "rate limit", "rate_limit", "quota",
        "high demand", "unavailable", "service unavailable",
        "timeout", "timed out", "deadline exceeded", "deadline_exceeded",
        "connection reset", "server disconnected", "overloaded",
    ]
    return any(kw in err_str for kw in fallback_keywords)


def clean_json_text(raw_text: str) -> str:
    """Strip markdown fences (```json ... ```) from LLM output."""
    clean = raw_text.strip()
    if clean.startswith("```"):
        lines = clean.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        clean = "\n".join(lines).strip()
    return clean


ALLOWED_MIME_TYPES = {"image/jpeg", "image/png", "image/webp", "image/heic"}
MAX_IMAGE_BYTES = 10 * 1024 * 1024


def verify_request_token(authorization: str | None, requested_uid: str) -> str:
    """Verify the Firebase ID token and ensure it owns the requested user scope."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="A valid Firebase sign-in is required.")

    token = authorization[7:].strip()
    if not token:
        raise HTTPException(status_code=401, detail="A valid Firebase sign-in is required.")

    try:
        import firebase_admin
        from firebase_admin import auth as firebase_auth

        if not firebase_admin._apps:
            firebase_admin.initialize_app()
        claims = firebase_auth.verify_id_token(token)
    except (ValueError, RuntimeError) as exc:
        logger.info("Rejected invalid Firebase token: %s", type(exc).__name__)
        raise HTTPException(status_code=401, detail="Invalid or expired Firebase sign-in.") from exc
    except ImportError as exc:
        logger.error("Firebase Admin SDK is required for authenticated requests")
        raise HTTPException(status_code=503, detail="Authentication service is unavailable.") from exc
    except Exception as exc:
        logger.info("Firebase token verification failed: %s", type(exc).__name__)
        raise HTTPException(status_code=401, detail="Invalid or expired Firebase sign-in.") from exc

    token_uid = claims.get("uid")
    if not token_uid or token_uid != requested_uid:
        raise HTTPException(status_code=403, detail="The signed-in user does not own this request.")
    return token_uid


def _image_part(raw: bytes, mime: str) -> genai_types.Part:
    return genai_types.Part(
        inline_data=genai_types.Blob(mime_type=mime, data=raw)
    )


@app.post("/api/scan-bill")
async def scan_bill(
    elec_image:   UploadFile = File(..., description="Electricity meter photo"),
    water_image:  UploadFile = File(..., description="Water meter photo"),
    uid:          str        = Form(..., description="Firebase Auth user UID"),
    bill_image:   UploadFile | None = File(None, description="Optional SP Group utility bill photo"),
    authorization: str | None = Header(default=None),
):
    """
    Accept meter images and optional SP Group bill image.
    Executes multimodal OCR with automatic model fallback between gemini-3.5-flash and gemini-3.7-flash
    when 503 (high demand), 429 (rate limit), or 524/504 (timeout) exceptions occur.
    """
    verify_request_token(authorization, uid)

    images_to_check = [img for img in (bill_image, elec_image, water_image) if img is not None]
    for img in images_to_check:
        if img.content_type not in ALLOWED_MIME_TYPES:
            raise HTTPException(
                400,
                f"Unsupported image type '{img.content_type}'. "
                f"Accepted: {', '.join(ALLOWED_MIME_TYPES)}",
            )

    for img in images_to_check:
        raw = await img.read()
        if len(raw) > MAX_IMAGE_BYTES:
            raise HTTPException(status_code=413, detail="Each image must be 10 MB or smaller.")
        await img.seek(0)

    candidate_models = get_candidate_models()
    span_attributes = {
        "user.id": uid,
        "scan.has_bill_image": bill_image is not None,
        "scan.has_elec_image": elec_image is not None,
        "scan.has_water_image": water_image is not None,
        "scan.primary_model": candidate_models[0],
        "scan.candidate_models": candidate_models,
    }

    with trace_span("scan_bill_multimodal", span_kind="CHAIN", attributes=span_attributes) as span:
        parts = []

        if bill_image is not None:
            bill_raw = await bill_image.read()
            parts.extend([
                _image_part(bill_raw, bill_image.content_type),
                genai_types.Part(text="Image: SP Group utility bill (extract billingMonth, electricityRate, waterTaxBase)"),
            ])
        else:
            parts.append(genai_types.Part(text="Note: No SP Group bill image was provided. Set electricityRate, waterTaxBase, and billingMonth to null."))

        if elec_image is not None:
            elec_raw = await elec_image.read()
            parts.extend([
                _image_part(elec_raw, elec_image.content_type),
                genai_types.Part(text="Image: Electricity meter display (extract electricityCurrentReading)"),
            ])

        if water_image is not None:
            water_raw = await water_image.read()
            parts.extend([
                _image_part(water_raw, water_image.content_type),
                genai_types.Part(text="Image: Water meter display (extract waterCurrentReading)"),
            ])

        parts.append(genai_types.Part(text="Extract all fields as instructed and return only valid JSON."))
        content = genai_types.Content(role="user", parts=parts)

        last_error: Exception | None = None
        clean_text = ""
        successful_model = None

        for idx, model_name in enumerate(candidate_models):
            is_fallback = idx > 0
            runner = get_scan_runner(model_name)

            try:
                session = await _scan_sessions.create_session(
                    app_name=f"utility-bill-scanner-{model_name}",
                    user_id=uid,
                )

                final_text = ""
                async for event in runner.run_async(
                    user_id=uid,
                    session_id=session.id,
                    new_message=content,
                ):
                    if getattr(event, "content", None) and getattr(event.content, "parts", None):
                        for part in event.content.parts:
                            if getattr(part, "text", None):
                                final_text += part.text
                    elif getattr(event, "text", None):
                        final_text += event.text

                    if event.is_final_response() and final_text:
                        break

                parsed_clean = clean_json_text(final_text)
                if not parsed_clean:
                    raise ValueError(f"Model '{model_name}' returned an empty response.")

                # Validate JSON parseability
                _ = json.loads(parsed_clean)

                clean_text = parsed_clean
                successful_model = model_name

                if span and hasattr(span, "set_attribute"):
                    span.set_attribute("scan.model_used", model_name)
                    span.set_attribute("scan.fallback_triggered", is_fallback)
                    if is_fallback:
                        span.set_attribute("scan.primary_model_failed", candidate_models[0])
                        span.set_attribute("scan.fallback_reason", str(last_error)[:200] if last_error else "")

                if is_fallback:
                    logger.info(
                        f"✅ Fallback to '{model_name}' succeeded after primary '{candidate_models[0]}' failed."
                    )
                break

            except Exception as exc:
                last_error = exc
                logger.warning(
                    f"⚠️ Scan attempt {idx + 1}/{len(candidate_models)} failed using '{model_name}': {exc}"
                )

                if span and hasattr(span, "set_attribute"):
                    span.set_attribute(f"scan.attempt_{idx}_model", model_name)
                    span.set_attribute(f"scan.attempt_{idx}_error", str(exc)[:200])

                # Check if we should fallback to next model
                if idx < len(candidate_models) - 1 and is_fallback_candidate_error(exc):
                    next_model = candidate_models[idx + 1]
                    logger.info(f"🔄 Triggering automatic fallback from '{model_name}' to '{next_model}'...")
                    continue

                # If non-retryable error (e.g. 401 unauthenticated) or all models exhausted:
                break

        if not clean_text:
            err_str = str(last_error) if last_error else "Empty response from agent"
            if "503" in err_str or "high demand" in err_str.lower() or "unavailable" in err_str.lower():
                raise HTTPException(
                    503,
                    detail="The AI models (gemini-3.5-flash / gemini-3.7-flash) are currently experiencing temporary high traffic. Please wait a few seconds and click Scan Images again.",
                )
            if "429" in err_str or "quota" in err_str.lower() or "resource_exhausted" in err_str.lower():
                raise HTTPException(
                    429,
                    detail="API rate limit or quota reached across models. Please wait a moment before trying again.",
                )
            if "401" in err_str or "unauthenticated" in err_str.lower() or "invalid api key" in err_str.lower():
                raise HTTPException(
                    401,
                    detail="API authentication failed. Please verify your LLM API key in .env.",
                )
            if "524" in err_str or "504" in err_str or "timeout" in err_str.lower():
                raise HTTPException(
                    504,
                    detail="The scan request timed out. Please try again with clear, well-lit photos.",
                )
            raise HTTPException(502, detail=f"Model error during scanning: {err_str[:250]}")

        try:
            result = json.loads(clean_text)
        except json.JSONDecodeError:
            raise HTTPException(502, f"Agent returned non-JSON: {clean_text[:300]}")

        if "error" in result:
            raise HTTPException(422, result)

        # ── Normalize & validate decimal precision ────────────────────────────────
        if result.get("electricityCurrentReading") is not None:
            try:
                result["electricityCurrentReading"] = round(float(result["electricityCurrentReading"]), 1)
            except (ValueError, TypeError):
                pass

        if result.get("waterCurrentReading") is not None:
            try:
                result["waterCurrentReading"] = round(float(result["waterCurrentReading"]), 3)
            except (ValueError, TypeError):
                pass

        if span and hasattr(span, "set_attribute"):
            span.set_attribute("scan.extracted_json", json.dumps(result))

        return result


# ─── Health check ─────────────────────────────────────────────────────────────

@app.get("/")
def root():
    return {"status": "ok", "service": "utility-bill-adk-backend"}


@app.get("/health")
def health():
    return {"status": "ok", "service": "utility-bill-adk-backend"}

