"""Unit tests for Arize / Phoenix Telemetry & Evaluation Suite."""

import pytest
import os
from telemetry import is_telemetry_enabled, init_telemetry, trace_tool, trace_span
from evals.eval_bill_scan import (
    eval_schema_conformance,
    eval_reading_plausibility,
    eval_accuracy_against_ground_truth,
    run_benchmark_evals,
)


def test_is_telemetry_enabled(monkeypatch):
    monkeypatch.setenv("ENABLE_ARIZE_OBSERVABILITY", "true")
    assert is_telemetry_enabled() is True

    monkeypatch.setenv("ENABLE_ARIZE_OBSERVABILITY", "false")
    assert is_telemetry_enabled() is False

    monkeypatch.delenv("ENABLE_ARIZE_OBSERVABILITY", raising=False)
    assert is_telemetry_enabled() is False


def test_trace_tool_decorator_preserves_functionality():
    @trace_tool("test_addition")
    def add(a: int, b: int) -> int:
        """Add two numbers."""
        return a + b

    assert add.__name__ == "add"
    assert add.__doc__ == "Add two numbers."
    assert add(3, 4) == 7


def test_trace_span_context_manager():
    with trace_span("test_custom_span", span_kind="CHAIN", attributes={"key": "value"}) as span:
        # Executes safely even when tracer is disabled or in fallback mode
        val = 10 * 5
        assert val == 50


def test_trace_tool_handles_exceptions():
    @trace_tool("failing_tool")
    def faulty():
        raise ValueError("Something went wrong in calculation")

    with pytest.raises(ValueError, match="Something went wrong"):
        faulty()


def test_eval_schema_conformance():
    complete_data = {
        "billingMonth": "AUG 2026",
        "electricityRate": 0.3191,
        "electricityCurrentReading": 1000.0,
        "waterTaxBase": 10.0,
        "waterCurrentReading": 25.0,
    }
    res = eval_schema_conformance(complete_data)
    assert res["passed"] is True
    assert res["score"] == 1.0

    incomplete_data = {
        "billingMonth": "AUG 2026",
        "electricityCurrentReading": 1000.0,
    }
    res_inc = eval_schema_conformance(incomplete_data)
    assert res_inc["passed"] is False
    assert res_inc["score"] < 1.0


def test_eval_reading_plausibility():
    plausible_data = {
        "electricityRate": 0.3191,
        "electricityCurrentReading": 1540.2,
        "waterCurrentReading": 45.120,
    }
    res = eval_reading_plausibility(plausible_data)
    assert res["passed"] is True
    assert res["score"] == 1.0

    implausible_data = {
        "electricityRate": 5.50,  # Unrealistic tariff
        "electricityCurrentReading": -100,  # Negative reading
        "waterCurrentReading": 1000000,
    }
    res_imp = eval_reading_plausibility(implausible_data)
    assert res_imp["passed"] is False
    assert res_imp["score"] == 0.0


def test_eval_accuracy_against_ground_truth():
    extracted = {
        "billingMonth": "AUG 2026",
        "electricityRate": 0.3191,
        "electricityCurrentReading": 1200.0,
    }
    ground_truth = {
        "billingMonth": "AUG 2026",
        "electricityRate": 0.3191,
        "electricityCurrentReading": 1200.0,
    }
    res = eval_accuracy_against_ground_truth(extracted, ground_truth)
    assert res["passed"] is True
    assert res["score"] == 1.0

    imperfect_extracted = {
        "billingMonth": "AUG 2026",
        "electricityRate": 0.3000,
        "electricityCurrentReading": 1200.0,
    }
    res_imp = eval_accuracy_against_ground_truth(imperfect_extracted, ground_truth)
    assert res_imp["score"] < 1.0


def test_run_benchmark_evals():
    dataset = [
        (
            {
                "billingMonth": "AUG 2026",
                "electricityRate": 0.3191,
                "electricityCurrentReading": 100.0,
                "waterTaxBase": 5.0,
                "waterCurrentReading": 10.0,
            },
            {
                "billingMonth": "AUG 2026",
                "electricityRate": 0.3191,
                "electricityCurrentReading": 100.0,
                "waterTaxBase": 5.0,
                "waterCurrentReading": 10.0,
            },
        )
    ]
    summary = run_benchmark_evals(dataset)
    assert summary["total_samples"] == 1
    assert summary["avg_schema_score"] == 1.0
    assert summary["avg_plausibility_score"] == 1.0
    assert summary["avg_accuracy_score"] == 1.0
