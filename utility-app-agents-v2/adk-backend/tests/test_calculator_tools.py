"""Unit tests for utility bill calculator tools."""

import pytest
from tools.calculator_tools import (
    calculate_electricity,
    calculate_water,
    calculate_combined_total,
    fetch_current_tariff,
)

def test_calculate_electricity():
    res = calculate_electricity(current_reading=150.0, last_reading=100.0, rate_per_kwh=0.3191)
    assert res["usage"] == 50.0
    assert res["rate"] == 0.3191
    assert res["total"] == round(50.0 * 0.3191, 4)

def test_calculate_water():
    res = calculate_water(current_reading=30.0, last_reading=10.0, tax_base=10.0)
    assert res["usage"] == 20.0
    assert res["multiplierOne"] == round(20.0 * 1.21, 4)
    assert res["multiplierTwo"] == round(20.0 * 0.92, 4)
    assert res["multiplierThree"] == round(res["multiplierOne"] * 0.5, 4)
    assert res["taxFinalCost"] == 5.0
    assert res["total"] == round(res["multiplierOne"] + res["multiplierTwo"] + res["multiplierThree"], 4)

def test_calculate_combined_total():
    res = calculate_combined_total(
        electricity_total=15.955,
        water_total=54.7,
        water_tax_final_cost=5.0,
        gst_rate=0.09
    )
    expected_subtotal = 15.955 + 54.7 + 5.0
    expected_gst = expected_subtotal * 0.09
    expected_combined = expected_subtotal * 1.09
    assert res["subtotal"] == round(expected_subtotal, 4)
    assert res["gstAmount"] == round(expected_gst, 4)
    assert res["combinedTotal"] == round(expected_combined, 4)

def test_fetch_current_tariff_fallback():
    res = fetch_current_tariff()
    assert "rate" in res
    assert "quarter" in res
    assert "centsPerKwh" in res
    assert res["rate"] > 0
