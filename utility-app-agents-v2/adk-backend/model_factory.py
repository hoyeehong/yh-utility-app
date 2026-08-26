"""
Unified Model Factory for Google ADK.

Supports:
1. Google Gemini VLMs (e.g. gemini-3.1-pro, gemini-3.1-flash, gemini-2.0-flash)
   - Uses native Google GenAI SDK
   - Authenticates via GEMINI_API_KEY or Google Cloud Vertex AI (GOOGLE_CLOUD_PROJECT)

2. Third-Party VLMs via LiteLLM:
   - Groq (e.g. groq/llama-3.2-11b-vision-preview, llama-3.2-11b-vision-preview) -> GROQ_API_KEY
   - Anthropic (e.g. anthropic/claude-3-7-sonnet-20250219, claude-3-5-sonnet-20241022) -> ANTHROPIC_API_KEY
   - OpenAI (e.g. openai/gpt-4o, gpt-4o-mini) -> OPENAI_API_KEY

Reference: https://google.github.io/adk-docs/models/
"""

import os

try:
    from google.adk.models.lite_llm import LiteLlm
except (ImportError, ModuleNotFoundError):
    # Standalone mock / fallback when google-adk is not in current local venv
    class LiteLlm:  # type: ignore
        def __init__(self, model: str, **kwargs):
            self.model = model
            self.kwargs = kwargs
        def __repr__(self):
            return f"LiteLlm(model='{self.model}')"


def _normalize_model_name(raw_model: str) -> str:
    """Auto-detect and format the provider prefix for LiteLLM if missing."""
    m = raw_model.strip()
    
    # 1. Native Gemini models
    if m.lower().startswith("gemini"):
        return m
    
    # 2. If standard provider prefix already provided
    if "/" in m:
        provider = m.split("/", 1)[0].lower()
        if provider in ("openrouter", "groq", "anthropic", "openai", "deepseek", "mistral", "ollama", "vertex_ai"):
            return m
        
        # If user passed e.g. qwen/... or google/... with OpenRouter key
        if os.getenv("OPENROUTER_API_KEY"):
            return f"openrouter/{m}"

        # If user passed e.g. meta-llama/llama-3.2-11b-vision-preview with Groq key
        if os.getenv("GROQ_API_KEY"):
            model_base = m.split("/", 1)[1]
            return f"groq/{model_base}"
    
    # 3. Auto-prefix based on model name keywords
    m_lower = m.lower()
    if m_lower.startswith("qwen"):
        return f"openrouter/qwen/{m}" if os.getenv("OPENROUTER_API_KEY") else f"openrouter/{m}"
    if m_lower.startswith("llama") or "vision-preview" in m_lower or "versatile" in m_lower or "instant" in m_lower:
        return f"groq/{m}" if os.getenv("GROQ_API_KEY") else f"openrouter/meta-llama/{m}"
    if m_lower.startswith("claude"):
        return f"anthropic/{m}"
    if m_lower.startswith("gpt"):
        return f"openai/{m}"
    
    # 4. If OpenRouter API key is set, default unknown models to openrouter/
    if os.getenv("OPENROUTER_API_KEY"):
        return f"openrouter/{m}"
        
    return m


def get_model(model_name: str | None = None):
    """
    Returns the appropriate model object or string identifier for ADK.
    
    If model is Gemini, returns native string.
    Otherwise, returns LiteLlm(model=normalized_name).
    """
    raw_model = model_name or os.getenv("LLM_MODEL", "groq/llama-3.2-11b-vision-preview")
    normalized = _normalize_model_name(raw_model)
    
    if normalized.lower().startswith("gemini"):
        return normalized
        
    return LiteLlm(model=normalized)
