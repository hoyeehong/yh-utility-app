"""Unit tests for scan_bill fallback mechanism between gemini-3.5-flash and gemini-3.7-flash."""

import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi.testclient import TestClient

from main import (
    app,
    is_fallback_candidate_error,
    get_candidate_models,
    clean_json_text,
)


@pytest.fixture(autouse=True)
def mock_firebase_auth(monkeypatch):
    """Keep model-behavior tests independent from Firebase credentials."""
    monkeypatch.setattr("main.verify_request_token", lambda authorization, requested_uid: requested_uid)


def test_is_fallback_candidate_error():
    assert is_fallback_candidate_error(Exception("503 Service Unavailable: High demand")) is True
    assert is_fallback_candidate_error(Exception("429 RESOURCE_EXHAUSTED: Quota exceeded")) is True
    assert is_fallback_candidate_error(Exception("524 A timeout occurred")) is True
    assert is_fallback_candidate_error(Exception("504 Gateway Timeout")) is True
    assert is_fallback_candidate_error(Exception("Server disconnected or timeout error")) is True
    assert is_fallback_candidate_error(Exception("Invalid prompt syntax")) is False


def test_clean_json_text():
    raw_markdown = "```json\n{\"electricityRate\": 0.3191}\n```"
    assert clean_json_text(raw_markdown) == "{\"electricityRate\": 0.3191}"


def test_scan_bill_requires_firebase_auth(monkeypatch):
    monkeypatch.setattr("main.verify_request_token", lambda authorization, requested_uid: (_ for _ in ()).throw(
        __import__("fastapi").HTTPException(status_code=401, detail="unauthenticated")
    ))
    client = TestClient(app)
    files = {
        "elec_image": ("elec.jpg", b"fake_elec_data", "image/jpeg"),
        "water_image": ("water.jpg", b"fake_water_data", "image/jpeg"),
    }
    response = client.post("/api/scan-bill", files=files, data={"uid": "test-user-123"})
    assert response.status_code == 401


def test_scan_bill_rejects_oversized_image(monkeypatch):
    from main import MAX_IMAGE_BYTES

    client = TestClient(app)
    files = {
        "elec_image": ("elec.jpg", b"x" * (MAX_IMAGE_BYTES + 1), "image/jpeg"),
        "water_image": ("water.jpg", b"fake_water_data", "image/jpeg"),
    }
    response = client.post(
        "/api/scan-bill",
        files=files,
        data={"uid": "test-user-123"},
        headers={"Authorization": "Bearer test-token"},
    )
    assert response.status_code == 413


def test_candidate_models_default(monkeypatch):
    monkeypatch.setenv("SCAN_PRIMARY_MODEL", "gemini-3.5-flash")
    monkeypatch.setenv("SCAN_FALLBACK_MODEL", "gemini-3.7-flash")
    models = get_candidate_models()
    assert models == ["gemini-3.5-flash", "gemini-3.7-flash"]


@pytest.mark.anyio
async def test_scan_bill_fallback_on_503_high_demand():
    """Test that when primary model (3.5) hits 503, it automatically falls back to 3.7."""
    valid_scan_json = json.dumps({
        "billingMonth": "AUG 2026",
        "electricityRate": 0.3191,
        "electricityCurrentReading": 12345.6,
        "waterTaxBase": 10.0,
        "waterCurrentReading": 100.123,
        "confidence": "high",
    })

    # Mock primary runner to fail with 503
    async def mock_primary_run(*args, **kwargs):
        raise Exception("503 Service Unavailable: The model is experiencing high demand.")
        yield

    # Mock fallback runner to succeed
    mock_event = MagicMock()
    mock_event.content.parts = [MagicMock(text=valid_scan_json)]
    mock_event.text = None
    mock_event.is_final_response.return_value = True

    async def mock_fallback_run(*args, **kwargs):
        yield mock_event

    mock_primary_runner = MagicMock()
    mock_primary_runner.run_async = mock_primary_run

    mock_fallback_runner = MagicMock()
    mock_fallback_runner.run_async = mock_fallback_run

    def mock_get_runner(model_name: str):
        if "3.5" in model_name:
            return mock_primary_runner
        return mock_fallback_runner

    with patch("main.get_scan_runner", side_effect=mock_get_runner), \
         patch("main.get_candidate_models", return_value=["gemini-3.5-flash", "gemini-3.7-flash"]):
        
        client = TestClient(app)
        files = {
            "elec_image": ("elec.jpg", b"fake_elec_data", "image/jpeg"),
            "water_image": ("water.jpg", b"fake_water_data", "image/jpeg"),
        }
        data = {"uid": "test-user-123"}
        
        response = client.post("/api/scan-bill", files=files, data=data, headers={"Authorization": "Bearer test-token"})
        assert response.status_code == 200
        result = response.json()
        assert result["electricityRate"] == 0.3191
        assert result["electricityCurrentReading"] == 12345.6
        assert result["waterCurrentReading"] == 100.123


@pytest.mark.anyio
async def test_scan_bill_fallback_on_429_quota():
    """Test that when primary model hits 429 quota exhausted, it falls back to 3.7."""
    valid_scan_json = json.dumps({
        "billingMonth": "AUG 2026",
        "electricityRate": 0.3200,
        "electricityCurrentReading": 54321.0,
        "waterTaxBase": 8.5,
        "waterCurrentReading": 200.456,
        "confidence": "high",
    })

    async def mock_primary_run(*args, **kwargs):
        raise Exception("429 RESOURCE_EXHAUSTED: Rate limit reached.")
        yield

    mock_event = MagicMock()
    mock_event.content.parts = [MagicMock(text=valid_scan_json)]
    mock_event.text = None
    mock_event.is_final_response.return_value = True

    async def mock_fallback_run(*args, **kwargs):
        yield mock_event

    mock_primary_runner = MagicMock()
    mock_primary_runner.run_async = mock_primary_run

    mock_fallback_runner = MagicMock()
    mock_fallback_runner.run_async = mock_fallback_run

    def mock_get_runner(model_name: str):
        if "3.5" in model_name:
            return mock_primary_runner
        return mock_fallback_runner

    with patch("main.get_scan_runner", side_effect=mock_get_runner), \
         patch("main.get_candidate_models", return_value=["gemini-3.5-flash", "gemini-3.7-flash"]):
        
        client = TestClient(app)
        files = {
            "elec_image": ("elec.jpg", b"fake_elec_data", "image/jpeg"),
            "water_image": ("water.jpg", b"fake_water_data", "image/jpeg"),
        }
        data = {"uid": "test-user-123"}
        
        response = client.post("/api/scan-bill", files=files, data=data, headers={"Authorization": "Bearer test-token"})
        assert response.status_code == 200
        result = response.json()
        assert result["electricityRate"] == 0.3200
        assert result["electricityCurrentReading"] == 54321.0


@pytest.mark.anyio
async def test_scan_bill_fallback_on_524_timeout():
    """Test that when primary model hits 524 timeout, it falls back to 3.7."""
    valid_scan_json = json.dumps({
        "billingMonth": "AUG 2026",
        "electricityRate": 0.3191,
        "electricityCurrentReading": 11111.0,
        "waterTaxBase": 5.0,
        "waterCurrentReading": 55.555,
        "confidence": "high",
    })

    async def mock_primary_run(*args, **kwargs):
        raise Exception("524 A timeout occurred during request execution")
        yield

    mock_event = MagicMock()
    mock_event.content.parts = [MagicMock(text=valid_scan_json)]
    mock_event.text = None
    mock_event.is_final_response.return_value = True

    async def mock_fallback_run(*args, **kwargs):
        yield mock_event

    mock_primary_runner = MagicMock()
    mock_primary_runner.run_async = mock_primary_run

    mock_fallback_runner = MagicMock()
    mock_fallback_runner.run_async = mock_fallback_run

    def mock_get_runner(model_name: str):
        if "3.5" in model_name:
            return mock_primary_runner
        return mock_fallback_runner

    with patch("main.get_scan_runner", side_effect=mock_get_runner), \
         patch("main.get_candidate_models", return_value=["gemini-3.5-flash", "gemini-3.7-flash"]):
        
        client = TestClient(app)
        files = {
            "elec_image": ("elec.jpg", b"fake_elec_data", "image/jpeg"),
            "water_image": ("water.jpg", b"fake_water_data", "image/jpeg"),
        }
        data = {"uid": "test-user-123"}
        
        response = client.post("/api/scan-bill", files=files, data=data, headers={"Authorization": "Bearer test-token"})
        assert response.status_code == 200
        result = response.json()
        assert result["electricityCurrentReading"] == 11111.0
        assert result["waterCurrentReading"] == 55.555


@pytest.mark.anyio
async def test_scan_bill_exhausted_fallback_raises_error():
    """Test that when both primary and fallback models fail with 503, a 503 HTTPException is returned."""
    async def mock_fail_run(*args, **kwargs):
        raise Exception("503 Service Unavailable: High demand")
        yield

    mock_runner = MagicMock()
    mock_runner.run_async = mock_fail_run

    with patch("main.get_scan_runner", return_value=mock_runner), \
         patch("main.get_candidate_models", return_value=["gemini-3.5-flash", "gemini-3.7-flash"]):
        
        client = TestClient(app)
        files = {
            "elec_image": ("elec.jpg", b"fake_elec_data", "image/jpeg"),
            "water_image": ("water.jpg", b"fake_water_data", "image/jpeg"),
        }
        data = {"uid": "test-user-123"}
        
        response = client.post("/api/scan-bill", files=files, data=data, headers={"Authorization": "Bearer test-token"})
        assert response.status_code == 503
        assert "503" in response.text or "high traffic" in response.text


@pytest.mark.anyio
async def test_scan_bill_fallback_reverse_37_to_35():
    """Test fallback when primary is 3.7 and fallback is 3.5."""
    valid_scan_json = json.dumps({
        "billingMonth": "AUG 2026",
        "electricityRate": 0.3191,
        "electricityCurrentReading": 99999.0,
        "waterTaxBase": 10.0,
        "waterCurrentReading": 123.456,
        "confidence": "high",
    })

    async def mock_primary_37_run(*args, **kwargs):
        raise Exception("503 Service Unavailable: High demand")
        yield

    mock_event = MagicMock()
    mock_event.content.parts = [MagicMock(text=valid_scan_json)]
    mock_event.text = None
    mock_event.is_final_response.return_value = True

    async def mock_fallback_35_run(*args, **kwargs):
        yield mock_event

    mock_37_runner = MagicMock()
    mock_37_runner.run_async = mock_primary_37_run

    mock_35_runner = MagicMock()
    mock_35_runner.run_async = mock_fallback_35_run

    def mock_get_runner(model_name: str):
        if "3.7" in model_name:
            return mock_37_runner
        return mock_35_runner

    with patch("main.get_scan_runner", side_effect=mock_get_runner), \
         patch("main.get_candidate_models", return_value=["gemini-3.7-flash", "gemini-3.5-flash"]):
        
        client = TestClient(app)
        files = {
            "elec_image": ("elec.jpg", b"fake_elec_data", "image/jpeg"),
            "water_image": ("water.jpg", b"fake_water_data", "image/jpeg"),
        }
        data = {"uid": "test-user-123"}
        
        response = client.post("/api/scan-bill", files=files, data=data, headers={"Authorization": "Bearer test-token"})
        assert response.status_code == 200
        result = response.json()
        assert result["electricityCurrentReading"] == 99999.0


@pytest.mark.anyio
async def test_scan_bill_non_retryable_401_no_fallback():
    """Test that a non-retryable 401 unauthenticated error fails immediately without attempting fallback loop."""
    attempts = []

    async def mock_fail_run(*args, **kwargs):
        attempts.append(1)
        raise Exception("401 Unauthenticated: Invalid API key")
        yield

    mock_runner = MagicMock()
    mock_runner.run_async = mock_fail_run

    with patch("main.get_scan_runner", return_value=mock_runner), \
         patch("main.get_candidate_models", return_value=["gemini-3.5-flash", "gemini-3.7-flash"]):
        
        client = TestClient(app)
        files = {
            "elec_image": ("elec.jpg", b"fake_elec_data", "image/jpeg"),
            "water_image": ("water.jpg", b"fake_water_data", "image/jpeg"),
        }
        data = {"uid": "test-user-123"}
        
        response = client.post("/api/scan-bill", files=files, data=data, headers={"Authorization": "Bearer test-token"})
        assert response.status_code == 401
        assert len(attempts) == 1  # Did not attempt second model
