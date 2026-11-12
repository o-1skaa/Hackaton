from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_health_and_shipments():
    assert client.get("/health").status_code == 200
    response = client.get("/api/shipments")
    assert response.status_code == 200
    assert len(response.json()) == 4
    assert response.json()[0]["synthetic"] is True


def test_shipment_not_found():
    response = client.get("/api/shipments/UNKNOWN")
    assert response.status_code == 404
    assert "error" in response.json()


def test_prediction_is_deterministic():
    payload = {"shipment_id": "SCT-001", "weather_severity": 4, "port_load": 90}
    first = client.post("/api/predict", json=payload)
    second = client.post("/api/predict", json=payload)
    assert first.status_code == 200
    assert first.json() == second.json()
    assert first.json()["delay_hours"] >= 0
    assert len(first.json()["reasons"]) >= 1
    assert client.get("/api/routes/SCT-001").json()[1]["recommended"] is True


def test_preclearance_requires_demo_key():
    payload = {"shipment_id": "SCT-001", "documents": [{"type": "invoice", "filename": "invoice.txt"}]}
    response = client.post("/api/preclearance", json=payload)
    assert response.status_code == 401
    assert "error" in response.json()


def test_preclearance_approved_and_events():
    payload = {"shipment_id": "SCT-001", "documents": [
        {"type": "invoice", "filename": "invoice.txt"},
        {"type": "packing_list", "filename": "packing.txt"},
    ]}
    response = client.post("/api/preclearance", json=payload, headers={"X-API-Key": "demo-local-key"})
    assert response.status_code == 200
    assert response.json()["status"] == "approved"
    check_id = response.json()["check_id"]
    assert client.get(f"/api/preclearance/{check_id}").json()["status"] == "approved"
    events = client.get("/api/shipments/SCT-001/events").json()
    assert any(event["event"] == "submitted" for event in events)
    assert any(event["event"] == "approved" for event in events)


def test_preclearance_rejected():
    payload = {"shipment_id": "SCT-002", "documents": [{"type": "invoice", "filename": "invoice.txt"}]}
    response = client.post("/api/preclearance", json=payload, headers={"X-API-Key": "demo-local-key"})
    assert response.status_code == 200
    assert response.json()["status"] == "rejected"
    assert response.json()["reasons"]


def test_invalid_prediction_parameters():
    payload = {"shipment_id": "SCT-001", "weather_severity": 99, "port_load": 101}
    response = client.post("/api/predict", json=payload)
    assert response.status_code == 422
    assert "error" in response.json()
