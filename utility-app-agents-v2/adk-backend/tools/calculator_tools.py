"""
ADK function tools wrapping Singapore utility bill calculation logic.

Each function is decorated with @tool so ADK auto-generates the JSON schema
for the LLM to call them correctly.

Singapore SP Group formulas (as implemented in the original index.js):

  Electricity:
    usage = currentReading - lastReading
    total = usage × rate

  Water:
    multiplierOne   = usage × 1.21
    multiplierTwo   = usage × 0.92
    multiplierThree = multiplierOne × 0.5
    waterFinalTotal = multiplierOne + multiplierTwo + multiplierThree
    waterTaxFinalCost = taxBase × 0.5

  Combined (9% GST):
    combined = (electricityTotal + waterFinalTotal + waterTaxFinalCost) × 1.09

Reference: https://google.github.io/adk-docs/tools/function-tools/
"""

import contextlib
import httpx

try:
    from google.adk.tools import tool
except ImportError:
    def tool(fn):
        return fn

try:
    from telemetry import trace_tool
except ImportError:
    def trace_tool(tool_name=None):
        def decorator(fn):
            return fn
        return decorator


# ─── Electricity ──────────────────────────────────────────────────────────────

@tool
@trace_tool("calculate_electricity")
def calculate_electricity(
    current_reading: float,
    last_reading: float,
    rate_per_kwh: float,
) -> dict:
    """
    Calculate electricity cost for a billing period.

    Args:
        current_reading: Current meter reading in kWh.
        last_reading: Previous month's meter reading in kWh.
        rate_per_kwh: Electricity tariff in $/kWh (e.g. 0.3191).

    Returns:
        dict with usage (kWh), rate ($/kWh), and total cost before GST.
    """
    usage = current_reading - last_reading
    total = usage * rate_per_kwh
    return {
        "usage": round(usage, 4),
        "rate":  rate_per_kwh,
        "total": round(total, 4),
    }


# ─── Water ────────────────────────────────────────────────────────────────────

@tool
@trace_tool("calculate_water")
def calculate_water(
    current_reading: float,
    last_reading: float,
    tax_base: float,
) -> dict:
    """
    Calculate water cost using SP Group's tiered multiplier formula.

    Args:
        current_reading: Current month water meter reading (cubic metres).
        last_reading: Previous month water meter reading (cubic metres).
        tax_base: The water conservation tax base amount from the bill ($).

    Returns:
        dict with usage breakdown and total before GST.
    """
    usage       = current_reading - last_reading
    mult_one    = usage * 1.21        # Waterborne Fee
    mult_two    = usage * 0.92        # Sanitary Appliance Fee
    mult_three  = mult_one * 0.5      # Rebate
    water_total = mult_one + mult_two + mult_three
    tax_final   = tax_base * 0.5
    return {
        "usage":          round(usage, 4),
        "multiplierOne":  round(mult_one, 4),
        "multiplierTwo":  round(mult_two, 4),
        "multiplierThree": round(mult_three, 4),
        "taxBase":        tax_base,
        "taxFinalCost":   round(tax_final, 4),
        "total":          round(water_total, 4),
    }


# ─── Combined total ───────────────────────────────────────────────────────────

@tool
@trace_tool("calculate_combined_total")
def calculate_combined_total(
    electricity_total: float,
    water_total: float,
    water_tax_final_cost: float,
    gst_rate: float = 0.09,
) -> dict:
    """
    Compute the combined utility bill total inclusive of GST.

    Args:
        electricity_total: Electricity subtotal before GST.
        water_total: Water subtotal before GST.
        water_tax_final_cost: Water conservation tax component.
        gst_rate: GST rate (default 0.09 = 9%).

    Returns:
        dict with subtotal, gst_amount, and combined_total.
    """
    subtotal    = electricity_total + water_total + water_tax_final_cost
    gst_amount  = subtotal * gst_rate
    combined    = subtotal * (1 + gst_rate)
    return {
        "subtotal":      round(subtotal, 4),
        "gstAmount":     round(gst_amount, 4),
        "combinedTotal": round(combined, 4),
    }


# ─── Live tariff ──────────────────────────────────────────────────────────────

@tool
@trace_tool("fetch_current_tariff")
def fetch_current_tariff() -> dict:
    """
    Fetch the latest Singapore electricity tariff from EMA / data.gov.sg.
    Falls back to a hardcoded schedule if the live API is unavailable.

    Returns:
        dict with quarter, rate ($/kWh), centsPerKwh, and source.
    """
    # Hardcoded fallback schedule (update quarterly if needed)
    tariff_schedule = [
        {"quarter": "Q3 2026 (Jul - Sep)", "rate": 0.3191, "centsPerKwh": 31.91},
        {"quarter": "Q2 2026 (Apr - Jun)", "rate": 0.2989, "centsPerKwh": 29.89},
        {"quarter": "Q1 2026 (Jan - Mar)", "rate": 0.3034, "centsPerKwh": 30.34},
    ]

    with contextlib.suppress(Exception):
        resp = httpx.get(
            "https://data.gov.sg/api/action/datastore_search"
            "?resource_id=d_61eac3cdb086814af485dcc682b75ae9&limit=1&sort=quarter%20desc",
            timeout=4.0,
        )
        if resp.status_code == 200:
            records = resp.json().get("result", {}).get("records", [])
            if records:
                raw = records[0].get("tariff_rate") or records[0].get("rate")
                if raw:
                    rate = float(raw)
                    if rate > 1:          # stored as cents, convert to dollars
                        rate /= 100
                    return {
                        "quarter":     records[0].get("quarter", "Latest"),
                        "rate":        round(rate, 4),
                        "centsPerKwh": round(rate * 100, 2),
                        "source":      "data.gov.sg (live)",
                    }

    latest = tariff_schedule[0]
    return {**latest, "source": "SP Group / EMA Schedule (fallback)"}
