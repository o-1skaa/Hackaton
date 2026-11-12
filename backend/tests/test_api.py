import json
import httpx
import pytest
from fastapi.testclient import TestClient
import app.main as main


@pytest.fixture(autouse=True)
def isolated_state(monkeypatch):
    monkeypatch.setenv("GIGACHAT_CREDENTIALS", "test-only-key")
    original_post = httpx.Client.post
    def model_response(self, url, **kwargs):
        if str(url).startswith("/"):
            return original_post(self, url, **kwargs)
        return httpx.Response(200, request=httpx.Request('POST', url), json={
            'model':'test-gigachat', 'choices':[{'finish_reason':'stop', 'message':{'content':json.dumps({
                'delay_hours':6.5, 'risk':'high', 'reasons':['Демонстрационный ответ API']})}}]})
    monkeypatch.setattr(httpx.Client, 'post', model_response)
    monkeypatch.setattr(main, "ROUTE_PREDICTIONS", {})
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


def test_prediction_uses_provider_output(client):
    payload = {"shipment_id": "SCT-001"}
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
        "shipment_id": "SCT-001",
    })
    assert result.status_code == 200
    assert result.json()["delay_hours"] == 6.5
    assert result.json()["risk"] == "high"
    detail = client.get("/api/shipments/SCT-001").json()
    assert detail["last_delay_hours"] == result.json()["delay_hours"]
    assert client.get("/api/shipments/SCT-001/events").json()[-1]["event"] == "prediction_updated"


def test_unknown_prediction_has_no_side_effects(client):
    response = client.post("/api/predict", json={
        "shipment_id": "UNKNOWN",
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


def test_context_is_authoritative(client):
    context = client.get('/api/prediction-context/SCT-001').json()
    assert context['synthetic'] is True
    assert context['provider']['configured'] is True
    assert context['provider']['provider'] == 'gigachat'
    assert context['provider']['model'] == 'GigaChat-2'
    assert context['observation_id']
    result = client.post('/api/predict', json={'shipment_id':'SCT-001','route_id':'alternative'})
    assert result.status_code == 200
    assert result.json()['conditions'] == context['conditions']
    assert result.json()['source_snapshot_id'] == context['snapshot_id']
    assert result.json()['method'] == 'external_llm'
    routes = client.get('/api/routes/SCT-001').json()
    assert routes[0]['eta_hours'] == 72
    assert routes[1]['eta_hours'] == 76.5


def test_provider_failure_does_not_mutate_state(client, monkeypatch):
    monkeypatch.delenv('GIGACHAT_CREDENTIALS', raising=False)
    result = client.post('/api/predict', json={'shipment_id':'SCT-001'})
    assert result.status_code == 503
    assert not main.EVENTS['SCT-001']
    assert not main.LATEST_PREDICTIONS
    assert not main.ROUTE_PREDICTIONS


@pytest.mark.parametrize('field,value', [('weather_severity',2),('port_load',50),('wind_speed',8),('wave_height',1),('rail_delay',2),('route_id','unknown')])
def test_invalid_extended_inputs(client, field, value):
    result = client.post('/api/predict', json={'shipment_id':'SCT-001',field:value})
    assert result.status_code == 422


def test_snapshot_stays_fixed_until_restart(client):
    first = client.get('/api/prediction-context/SCT-001').json()
    assert client.get('/api/prediction-context/SCT-001').json() == first
    with TestClient(main.app) as restarted:
        second = restarted.get('/api/prediction-context/SCT-001').json()
    assert first['snapshot_id'] != second['snapshot_id']
    assert first['conditions'] != second['conditions']

