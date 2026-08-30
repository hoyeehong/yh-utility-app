"""
Arize / Phoenix & OpenTelemetry Telemetry Module.

Provides:
- Distributed tracing & APM for LLMs, Google ADK agents, and tools.
- Auto-instrumentation for LiteLLM and FastAPI via OpenInference.
- Local Phoenix server orchestration (http://localhost:6006) and Arize Cloud export.
- Safe graceful fallback when observability is disabled or packages are missing.
"""

import functools
import json
import logging
import os
from typing import Any, Callable, Dict, Optional

logger = logging.getLogger("adk_telemetry")

_TELEMETRY_INITIALIZED = False
_TRACER: Optional[Any] = None
_PHOENIX_SESSION: Optional[Any] = None


def is_telemetry_enabled() -> bool:
    """Check whether Arize / Phoenix telemetry is enabled via env."""
    val = os.getenv("ENABLE_ARIZE_OBSERVABILITY", "false").lower()
    return val in ("1", "true", "yes", "on")


def get_tracer():
    """Returns the active OpenTelemetry tracer or None if uninitialized."""
    global _TRACER
    return _TRACER


def init_telemetry(app=None) -> bool:
    """
    Initializes Arize AX & OpenTelemetry instrumentors.
    Supports Arize AX Cloud (via arize-otel) and local Phoenix fallback.
    
    Returns True if successfully initialized, False otherwise.
    """
    global _TELEMETRY_INITIALIZED, _TRACER, _PHOENIX_SESSION

    if not is_telemetry_enabled():
        logger.info("Arize telemetry is disabled (ENABLE_ARIZE_OBSERVABILITY!=true).")
        return False

    if _TELEMETRY_INITIALIZED:
        return True

    try:
        space_id = os.getenv("ARIZE_SPACE_ID") or os.getenv("ARIZE_SPACE_KEY")
        api_key = os.getenv("ARIZE_API_KEY")
        project_name = os.getenv("ARIZE_PROJECT_NAME", "utility-bill-assistant")
        tracer_provider = None

        # 1. Primary: Arize AX Cloud setup via arize.otel.register
        if space_id and api_key:
            try:
                from arize.otel import register
                tracer_provider = register(
                    space_id=space_id,
                    api_key=api_key,
                    project_name=project_name,
                )
                print(f"INFO: [Telemetry] ✅ Arize AX tracing registered for project '{project_name}'.", flush=True)
                logger.info(f"Arize AX tracing registered for project '{project_name}'.")
            except Exception as e:
                logger.warning(f"arize.otel.register failed ({e}), falling back to standard OTel setup.")

        # 2. Fallback: Local Phoenix or custom OTLP endpoint
        if tracer_provider is None:
            auto_launch = os.getenv("PHOENIX_AUTO_LAUNCH", "false").lower() in ("1", "true", "yes", "on")
            if auto_launch:
                try:
                    import phoenix as px
                    _PHOENIX_SESSION = px.launch_app(port=6006)
                    print("INFO: [Telemetry] ⚡ Arize Phoenix local dashboard running at http://localhost:6006", flush=True)
                    logger.info("Arize Phoenix local dashboard running at http://localhost:6006")
                except Exception as e:
                    logger.debug(f"Standalone Phoenix app not launched: {e}")

            collector_endpoint = (
                os.getenv("ARIZE_OTLP_ENDPOINT")
                or os.getenv("PHOENIX_COLLECTOR_ENDPOINT", "http://localhost:6006/v1/traces")
            )

            from opentelemetry import trace
            from opentelemetry.sdk.trace import TracerProvider
            from opentelemetry.sdk.trace.export import BatchSpanProcessor
            from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
            from opentelemetry.sdk.resources import Resource

            resource = Resource.create({
                "service.name": "utility-bill-adk-backend",
                "openinference.project.name": project_name,
                "project_name": project_name,
                "model_id": project_name,
            })
            tracer_provider = TracerProvider(resource=resource)
            headers = {}
            if api_key:
                headers["api_key"] = api_key
            if space_id:
                headers["space_id"] = space_id
                headers["space_key"] = space_id

            exporter = OTLPSpanExporter(
                endpoint=collector_endpoint,
                headers=headers if headers else None,
            )
            tracer_provider.add_span_processor(BatchSpanProcessor(exporter))
            trace.set_tracer_provider(tracer_provider)
            print(f"INFO: [Telemetry] ✅ Fallback OpenTelemetry exporter configured (exporting to {collector_endpoint}).", flush=True)

        from opentelemetry import trace
        _TRACER = trace.get_tracer("utility-bill-adk-backend", tracer_provider=tracer_provider)

        # 3. Instrument Google ADK
        try:
            from openinference.instrumentation.google_adk import GoogleADKInstrumentor
            GoogleADKInstrumentor().instrument(tracer_provider=tracer_provider)
            print("INFO: [Telemetry] Google ADK OpenInference instrumentor active.", flush=True)
            logger.info("Google ADK OpenInference instrumentor active.")
        except Exception as e:
            logger.warning(f"Google ADK instrumentation warning: {e}")

        # 4. Instrument LiteLLM
        try:
            from openinference.instrumentation.litellm import LiteLLMInstrumentor
            LiteLLMInstrumentor().instrument(tracer_provider=tracer_provider)
            print("INFO: [Telemetry] LiteLLM OpenInference instrumentor active.", flush=True)
            logger.info("LiteLLM OpenInference instrumentor active.")
        except Exception as e:
            logger.warning(f"LiteLLM instrumentation warning: {e}")

        # 5. Instrument Google GenAI SDK
        try:
            from openinference.instrumentation.google_genai import GoogleGenAIInstrumentor
            GoogleGenAIInstrumentor().instrument(tracer_provider=tracer_provider)
            print("INFO: [Telemetry] Google GenAI OpenInference instrumentor active.", flush=True)
            logger.info("Google GenAI OpenInference instrumentor active.")
        except Exception as e:
            logger.warning(f"Google GenAI instrumentation warning: {e}")

        # 6. Instrument FastAPI app if provided
        if app is not None:
            try:
                from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
                FastAPIInstrumentor.instrument_app(app, tracer_provider=tracer_provider)
                print("INFO: [Telemetry] FastAPI OpenTelemetry instrumentor active.", flush=True)
                logger.info("FastAPI OpenTelemetry instrumentor active.")
            except Exception as e:
                logger.warning(f"FastAPI instrumentation warning: {e}")

        _TELEMETRY_INITIALIZED = True
        return True

    except ImportError as exc:
        logger.warning(f"Arize / OpenTelemetry packages not installed ({exc}). Telemetry disabled.")
        return False
    except Exception as exc:
        logger.error(f"Failed to initialize Arize telemetry: {exc}", exc_info=True)
        return False


def trace_tool(tool_name: Optional[str] = None):
    """
    Decorator to trace tool execution with OpenInference TOOL semantic conventions.
    """
    def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
        name = tool_name or func.__name__

        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            if not _TELEMETRY_INITIALIZED or _TRACER is None:
                return func(*args, **kwargs)

            try:
                from opentelemetry.trace import Status, StatusCode

                with _TRACER.start_as_current_span(name) as span:
                    span.set_attribute("openinference.span.kind", "TOOL")
                    span.set_attribute("tool.name", name)
                    
                    # Capture input arguments safely
                    try:
                        safe_args = {f"arg_{i}": str(a) for i, a in enumerate(args)}
                        safe_kwargs = {k: str(v) for k, v in kwargs.items() if k not in ("uid", "auth", "token")}
                        span.set_attribute("tool.parameters", json.dumps({**safe_args, **safe_kwargs}))
                    except Exception:
                        pass

                    try:
                        result = func(*args, **kwargs)
                        try:
                            span.set_attribute("tool.output", json.dumps(result) if isinstance(result, (dict, list)) else str(result))
                        except Exception:
                            pass
                        span.set_status(Status(StatusCode.OK))
                        return result
                    except Exception as err:
                        span.record_exception(err)
                        span.set_status(Status(StatusCode.ERROR, str(err)))
                        raise
            except Exception:
                # If tracing fails for any reason, do not break business logic
                return func(*args, **kwargs)

        return wrapper
    return decorator


def trace_span(span_name: str, span_kind: str = "CHAIN", attributes: Optional[Dict[str, Any]] = None):
    """
    Context manager for creating a custom OpenInference span (AGENT, CHAIN, or LLM).
    """
    class _SpanContext:
        def __enter__(self):
            if not _TELEMETRY_INITIALIZED or _TRACER is None:
                return None
            try:
                self.span = _TRACER.start_span(span_name)
                self.span.set_attribute("openinference.span.kind", span_kind)
                if attributes:
                    for k, v in attributes.items():
                        if isinstance(v, (dict, list)):
                            self.span.set_attribute(k, json.dumps(v))
                        elif v is not None:
                            self.span.set_attribute(k, str(v) if not isinstance(v, (int, float, bool)) else v)
                return self.span
            except Exception:
                return None

        def __exit__(self, exc_type, exc_val, exc_tb):
            if hasattr(self, "span") and self.span is not None:
                try:
                    from opentelemetry.trace import Status, StatusCode
                    if exc_type is not None:
                        self.span.record_exception(exc_val)
                        self.span.set_status(Status(StatusCode.ERROR, str(exc_val)))
                    else:
                        self.span.set_status(Status(StatusCode.OK))
                    self.span.end()
                except Exception:
                    pass

    return _SpanContext()
