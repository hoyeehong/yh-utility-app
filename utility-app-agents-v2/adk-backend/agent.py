"""
Root Utility Bill Agent — Claude Sonnet 5 via LiteLLM.

ADK convention: this module MUST expose `root_agent` at module level so that
`adk web` and `adk api_server` discover it automatically.

Run locally (choose one):
  cd adk-backend
  adk web           # opens http://localhost:8000/dev-ui/
  adk api_server    # exposes REST /run endpoint only

Reference: https://google.github.io/adk-docs/get-started/
"""

import os
from dotenv import load_dotenv

load_dotenv()

# Arize AX Tracing: Initialize tracer & instrumentors before ADK / agents / LLMs
from telemetry import init_telemetry
init_telemetry()

try:
    from google.adk.agents import LlmAgent
    from google.adk.models.lite_llm import LiteLlm
except (ImportError, ModuleNotFoundError):
    class LlmAgent:  # type: ignore
        def __init__(self, **kwargs):
            for k, v in kwargs.items():
                setattr(self, k, v)
    class LiteLlm:  # type: ignore
        def __init__(self, model: str, **kwargs):
            self.model = model
            self.kwargs = kwargs

from tools.calculator_tools import (
    calculate_electricity,
    calculate_water,
    calculate_combined_total,
    fetch_current_tariff,
)
from tools.firestore_tools import (
    save_bill_to_firestore,
    search_similar_bills,
    get_last_reading,
)
from agents.bill_scan_agent import create_bill_scan_agent
from model_factory import get_model

# ─── Bill Scan sub-agent (vision capable) ────────────────────────────────────

bill_scan_sub_agent = create_bill_scan_agent()

# ─── Root Agent ───────────────────────────────────────────────────────────────

root_agent = LlmAgent(
    name="utility_bill_assistant",
    model=get_model(),
    description=(
        "An intelligent Singapore utility bill assistant that scans bill images, "
        "extracts meter readings, calculates costs, and retrieves historical bill data."
    ),
    instruction="""
You are a Singapore utility bill assistant powered by SP Group data.

## Your capabilities

1. **Scan bill images** — When the user uploads images, delegate to the
   bill_scan_agent sub-agent which accepts three images:
     - Image 1: SP Group utility bill (extracts electricityRate, waterTaxBase, billingMonth)
     - Image 2: Electricity meter photo (extracts electricityCurrentReading)
     - Image 3: Water meter photo (extracts waterCurrentReading)

2. **Auto-fill lastReading** — Call get_last_reading(uid) at session start.
   If null (first session), ask the user to type their previous readings manually.

3. **Calculate costs** — Use calculate_electricity, calculate_water, and
   calculate_combined_total after confirming all readings with the user.

4. **Fetch live tariff** — Use fetch_current_tariff() if the bill image does
   not contain the electricity rate clearly.

5. **Save bills** — Call save_bill_to_firestore(uid, record_json) after the
   user confirms the calculated totals.

6. **Answer history questions** — Use search_similar_bills(uid, query) for
   natural language questions like "what did I pay last July?" or
   "has my electricity usage increased?"

## Workflow

1. User uploads 3 images → scan → present extracted readings as a confirmation card
2. Confirm lastReading (auto-fetched or user-typed)
3. Calculate → show breakdown → ask for approval
4. On approval → save to Firestore → confirm saved

## Output style

- All monetary amounts in SGD (e.g. "$45.23")
- Electricity usage in kWh, water usage in m³
- Always show the billing month in outputs
- Be concise and friendly — this is a chat UI, not a form
""",
    tools=[
        calculate_electricity,
        calculate_water,
        calculate_combined_total,
        fetch_current_tariff,
        save_bill_to_firestore,
        search_similar_bills,
        get_last_reading,
    ],
    sub_agents=[bill_scan_sub_agent],
)
