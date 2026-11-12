import os
from pathlib import Path
from datetime import datetime, timezone
from uuid import uuid4

from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.encoders import jsonable_encoder
from fastapi.middleware.cors import CORSMiddleware

from app.data import SHIPMENTS
from app.schemas import (
    PredictRequest, PredictResponse, PreclearanceRequest, PreclearanceResponse,
    HealthResponse, ShipmentSummary, ShipmentDetail, Event, Route, PreclearanceCheck,
)
from app.services.prediction import predict as make_prediction
from app.services.routing import calculate_routes

load_dotenv(Path(__file__).resolve().parents[1] / ".env")
DEMO_API_KEY = os.getenv("DEMO_API_KEY", "demo-local-key")

app = FastAPI(
    title="Smart Caspian Transit — DEMO API",
    description="Все грузы, документы, маршруты и прогнозы демонстрационные/синтетические.",
    version="1.0.0",
)
@app.exception_handler(HTTPException)
async def handle_http_error(request, exc: HTTPException):
    error = exc.detail.get("error", exc.detail) if isinstance(exc.detail, dict) else str(exc.detail)
    return JSONResponse(status_code=exc.status_code, content={"error": error})


@app.exception_handler(RequestValidationError)
async def handle_validation_error(request, exc: RequestValidationError):
    return JSONResponse(
        status_code=422,
        content={"error": "Invalid request payload", "details": jsonable_encoder(exc.errors())},
    )


app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "X-API-Key"],
)

# Только демо-хранилище в памяти: при перезапуске очищается.
EVENTS: dict[str, list[dict]] = {shipment_id: [] for shipment_id in SHIPMENTS}
LATEST_PREDICTIONS: dict[str, float] = {}
PRECLEARANCE_CHECKS: dict[str, dict] = {}


def get_shipment_or_404(shipment_id: str) -> dict:
    shipment = SHIPMENTS.get(shipment_id)
    if shipment is None:
        raise HTTPException(status_code=404, detail={"error": "Shipment not found"})
    return shipment


def add_event(shipment_id: str, event: str, details: str) -> None:
    EVENTS[shipment_id].append({
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "event": event,
        "details": details,
    })


@app.get("/health", response_model=HealthResponse)
def health() -> dict:
    return {"status": "ok", "mode": "synthetic-demo"}


@app.get("/api/shipments", response_model=list[ShipmentSummary])
def list_shipments() -> list[dict]:
    return [
        {
            "id": shipment["id"],
            "name": shipment["name"],
            "origin": shipment["origin"],
            "destination": shipment["destination"],
            "status": shipment["status"],
            "synthetic": True,
        }
        for shipment in SHIPMENTS.values()
    ]


@app.get("/api/shipments/{shipment_id}", response_model=ShipmentDetail)
def get_shipment(shipment_id: str) -> dict:
    shipment = get_shipment_or_404(shipment_id)
    related_checks = [check for check in PRECLEARANCE_CHECKS.values() if check["shipment_id"] == shipment_id]
    last_check = related_checks[-1] if related_checks else None
    return {
        **shipment,
        "synthetic": True,
        "preclearance_status": last_check["status"] if last_check else "not_submitted",
        "last_delay_hours": LATEST_PREDICTIONS.get(shipment_id),
    }


@app.post("/api/predict", response_model=PredictResponse)
def predict(payload: PredictRequest) -> dict:
    get_shipment_or_404(payload.shipment_id)
    result = make_prediction(payload.weather_severity, payload.port_load)
    LATEST_PREDICTIONS[payload.shipment_id] = result["delay_hours"]
    add_event(payload.shipment_id, "prediction_updated", f"Задержка: {result['delay_hours']} ч")
    return result


@app.post("/api/preclearance", response_model=PreclearanceResponse)
def preclearance(payload: PreclearanceRequest, x_api_key: str | None = Header(default=None)) -> dict:
    if x_api_key != DEMO_API_KEY:
        raise HTTPException(status_code=401, detail={"error": "Invalid or missing demo API key"})

    get_shipment_or_404(payload.shipment_id)
    check_id = f"CHK-{uuid4().hex[:8].upper()}"
    add_event(payload.shipment_id, "submitted", f"Тестовый пакет отправлен; ID: {check_id}")

    doc_types = {doc.type.strip().lower() for doc in payload.documents}
    required = {"invoice", "packing_list"}
    missing = sorted(required - doc_types)
    reasons = [f"Отсутствует документ: {name}" for name in missing]
    status = "rejected" if missing else "approved"

    check = {
        "check_id": check_id,
        "shipment_id": payload.shipment_id,
        "status": status,
        "reasons": reasons,
        "documents": [{"type": doc.type, "filename": doc.filename} for doc in payload.documents],
    }
    PRECLEARANCE_CHECKS[check_id] = check
    add_event(payload.shipment_id, status, f"Проверка {check_id}: {', '.join(reasons) if reasons else 'демо-пакет принят'}")
    return {"status": status, "check_id": check_id, "reasons": reasons}


@app.get("/api/preclearance/{check_id}", response_model=PreclearanceCheck)
def get_check(check_id: str) -> dict:
    check = PRECLEARANCE_CHECKS.get(check_id)
    if check is None:
        raise HTTPException(status_code=404, detail={"error": "Check not found"})
    return check


@app.get("/api/shipments/{shipment_id}/events", response_model=list[Event])
def shipment_events(shipment_id: str) -> list[dict]:
    get_shipment_or_404(shipment_id)
    return EVENTS[shipment_id]


@app.get("/api/routes/{shipment_id}", response_model=list[Route])
def routes(shipment_id: str) -> list[dict]:
    shipment = get_shipment_or_404(shipment_id)
    return calculate_routes(shipment, LATEST_PREDICTIONS.get(shipment_id, 0))
