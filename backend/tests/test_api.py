import pytest
from fastapi.testclient import TestClient
import app.main as main


@pytest.fixture(autouse=True)
def isolated_state(monkeypatch):
    monkeypatch.setattr(main, "DEMO_API_KEY", "test-only-key")
    monkeypatch.setattr(main, "EVENTS", {sid: [] for sid in main.SHIPMENTS})
    monkeypatch.setattr(main, "LATEST_PREDICTIONS", {})
    monkeypatch.setattr(main, "PRECLEARANCE_CHECKS", {})


@pytest.fixture
def client():
    with TestClient(main.app) as test_client:
        yield test_client


def test_health_and_shipments(client):
    assert client.get("/health").status_code == 200
    response = client.get("/api/shipments")
    assert response.status_code == 200
    assert len(response.json()) == 4
    assert response.json()[0]["synthetic"] is True


def test_shipment_not_found(client):
    response = client.get("/api/shipments/UNKNOWN")
    assert response.status_code == 404
    assert "error" in response.json()


def test_prediction_is_deterministic(client):
    payload = {"shipment_id": "SCT-001", "weather_severity": 4, "port_load": 90}
    first = client.post("/api/predict", json=payload)
    second = client.post("/api/predict", json=payload)
    assert first.status_code == 200
    assert first.json() == second.json()
    assert first.json()["delay_hours"] >= 0
    assert len(first.json()["reasons"]) >= 1
    assert client.get("/api/routes/SCT-001").json()[1]["recommended"] is True


def test_preclearance_requires_demo_key(client):
    payload = {"shipment_id": "SCT-001", "documents": [{"type": "invoice", "filename": "invoice.txt"}]}
    response = client.post("/api/preclearance", json=payload)
    assert response.status_code == 401
    assert "error" in response.json()


def test_preclearance_approved_and_events(client):
    payload = {"shipment_id": "SCT-001", "documents": [
        {"type": "invoice", "filename": "invoice.txt"},
        {"type": "packing_list", "filename": "packing.txt"},
    ]}
    response = client.post("/api/preclearance", json=payload, headers={"X-API-Key": "test-only-key"})
    assert response.status_code == 200
    assert response.json()["status"] == "approved"
    check_id = response.json()["check_id"]
    assert client.get(f"/api/preclearance/{check_id}").json()["status"] == "approved"
    events = client.get("/api/shipments/SCT-001/events").json()
    assert any(event["event"] == "submitted" for event in events)
    assert any(event["event"] == "approved" for event in events)


def test_preclearance_rejected(client):
    payload = {"shipment_id": "SCT-002", "documents": [{"type": "invoice", "filename": "invoice.txt"}]}
    response = client.post("/api/preclearance", json=payload, headers={"X-API-Key": "test-only-key"})
    assert response.status_code == 200
    assert response.json()["status"] == "rejected"
    assert response.json()["reasons"]


def test_invalid_prediction_parameters(client):
    payload = {"shipment_id": "SCT-001", "weather_severity": 99, "port_load": 101}
    response = client.post("/api/predict", json=payload)
    assert response.status_code == 422
    assert "error" in response.json()


@pytest.mark.parametrize("path", [
    "/api/routes/UNKNOWN", "/api/shipments/UNKNOWN/events", "/api/preclearance/UNKNOWN",
])
def test_missing_resources(client, path):
    response = client.get(path)
    assert response.status_code == 404
    assert "error" in response.json()


def test_prediction_updates_detail_and_events(client):
    assert client.get("/api/shipments/SCT-001").json()["last_delay_hours"] is None
    result = client.post("/api/predict", json={
        "shipment_id": "SCT-001", "weather_severity": 4, "port_load": 90,
    })
    assert result.status_code == 200
    assert result.json()["delay_hours"] == 6.5
    assert result.json()["risk"] == "high"
    detail = client.get("/api/shipments/SCT-001").json()
    assert detail["last_delay_hours"] == result.json()["delay_hours"]
    assert client.get("/api/shipments/SCT-001/events").json()[-1]["event"] == "prediction_updated"


def test_unknown_prediction_has_no_side_effects(client):
    response = client.post("/api/predict", json={
        "shipment_id": "UNKNOWN", "weather_severity": 4, "port_load": 90,
    })
    assert response.status_code == 404
    assert not main.LATEST_PREDICTIONS


def test_preclearance_latest_status_and_document_normalization(client):
    payload = {"shipment_id": "SCT-001", "documents": [
        {"type": " INVOICE ", "filename": "invoice.txt"},
        {"type": "PACKING_LIST", "filename": "packing.txt"},
    ]}
    headers = {"X-API-Key": "test-only-key"}
    assert client.post("/api/preclearance", json=payload, headers=headers).json()["status"] == "approved"
    payload["documents"].pop()
    assert client.post("/api/preclearance", json=payload, headers=headers).json()["status"] == "rejected"
    assert client.get("/api/shipments/SCT-001").json()["preclearance_status"] == "rejected"


def test_wrong_key_does_not_create_events(client):
    response = client.post("/api/preclearance", json={
        "shipment_id": "SCT-001", "documents": [{"type": "invoice", "filename": "i.txt"}],
    }, headers={"X-API-Key": "wrong"})
    assert response.status_code == 401
    assert client.get("/api/shipments/SCT-001/events").json() == []


def test_openapi_has_response_models(client):
    schema = client.get("/openapi.json").json()
    for path in ["/api/shipments", "/api/shipments/{shipment_id}",
                 "/api/routes/{shipment_id}", "/api/preclearance/{check_id}",
                 "/api/shipments/{shipment_id}/events"]:
        response_schema = schema["paths"][path]["get"]["responses"]["200"]["content"]["application/json"]["schema"]
        assert "$ref" in response_schema or "items" in response_schema
