import os
from contextlib import asynccontextmanager, contextmanager
from pathlib import Path
from datetime import datetime, timezone
from uuid import uuid4

from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.encoders import jsonable_encoder
from fastapi.middleware.cors import CORSMiddleware

from app.data import SHIPMENTS
from app.schemas import (
    PredictRequest, PredictResponse, PreclearanceRequest, PreclearanceResponse,
    HealthResponse, ShipmentSummary, ShipmentDetail, Event, Route, PreclearanceCheck, PredictionContext, ShipmentCreate,
)
from app.services.prediction import predict as make_prediction, provider_status, metrics
from app.services.routing import calculate_routes
from app.services.data_sources import refresh_snapshots

load_dotenv(Path(__file__).resolve().parents[1] / ".env")
DEMO_API_KEY = os.getenv("DEMO_API_KEY", "demo-local-key")

@asynccontextmanager
async def lifespan(app: FastAPI):
    load_saved_shipments()
    app.state.source_snapshots = refresh_snapshots([key for key in SHIPMENTS if not SHIPMENTS[key].get('conditions')])
    for key, item in SHIPMENTS.items():
        if item.get('conditions'):
            app.state.source_snapshots[key] = source_for(item)
        EVENTS.setdefault(key, [])
    yield


app = FastAPI(
    lifespan=lifespan,
    title="Smart Caspian Transit — DEMO API",
    description="Все грузы, документы, маршруты и прогнозы демонстрационные/синтетические.",
    version="1.2.0",
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
ROUTE_PREDICTIONS: dict[str, dict[str, float]] = {}
PRECLEARANCE_CHECKS: dict[str, dict] = {}


import json
import sqlite3
DB_PATH = Path(__file__).resolve().parents[1] / 'data' / '.runtime' / 'shipments.sqlite3'

@contextmanager
def database():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB_PATH)
    try:
        with db:
            db.execute('CREATE TABLE IF NOT EXISTS shipments (id TEXT PRIMARY KEY, payload TEXT NOT NULL)')
            yield db
    finally:
        db.close()

def load_saved_shipments():
    with database() as db:
        for key, payload in db.execute('SELECT id, payload FROM shipments'):
            SHIPMENTS[key] = json.loads(payload)

def source_for(item):
    return {'snapshot_id': item['id'], 'observation_id': 'manual', 'synthetic': True,
            'observed_at': datetime.now(timezone.utc).isoformat(), 'conditions': item['conditions'],
            'sources': [{'name': 'Ввод оператора', 'kind': 'manual', 'note': 'Параметры отправки'}]}

@app.get('/api/model-metrics')
def model_metrics():
    return metrics()

@app.post('/api/shipments', response_model=ShipmentSummary, status_code=201)
def create_shipment(payload: ShipmentCreate):
    key = 'SCT-' + uuid4().hex[:10].upper()
    item = {**payload.model_dump(), 'id': key, 'origin': 'Астрахань', 'destination': 'Бендер-Аббас',
            'status': 'pending', 'synthetic': True, 'historical_avg_delay_hours': metrics()['baseline_delay_hours'],
            'stages': [{'name': name, 'status': 'pending'} for name in ['Астрахань', 'Махачкала / Баку', 'Энзели', 'Бендер-Аббас']]}
    with database() as db:
        db.execute('INSERT INTO shipments VALUES (?, ?)', (key,json.dumps(item, ensure_ascii=False)))
    SHIPMENTS[key] = item
    EVENTS[key] = []
    app.state.source_snapshots[key] = source_for(item)
    return item


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
        "historical_avg_delay_hours": metrics()["baseline_delay_hours"],
        "synthetic": True,
        "preclearance_status": last_check["status"] if last_check else "not_submitted",
        "last_delay_hours": LATEST_PREDICTIONS.get(shipment_id),
    }


@app.get("/api/prediction-context/{shipment_id}", response_model=PredictionContext)
def prediction_context(shipment_id: str) -> dict:
    get_shipment_or_404(shipment_id)
    return {**app.state.source_snapshots[shipment_id], "provider": provider_status()}


@app.post("/api/predict", response_model=PredictResponse)
def predict(payload: PredictRequest) -> dict:
    shipment = get_shipment_or_404(payload.shipment_id)
    result = make_prediction(shipment=shipment, source=app.state.source_snapshots[payload.shipment_id],
                             route_id=payload.route_id)
    ROUTE_PREDICTIONS.setdefault(payload.shipment_id, {})[payload.route_id] = result["delay_hours"]
    LATEST_PREDICTIONS[payload.shipment_id] = result["delay_hours"]
    add_event(payload.shipment_id, "prediction_updated", f"Прогноз / {payload.route_id}: {result['delay_hours']} ч; {result['reasons'][0]}")
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
    return calculate_routes({**shipment, "conditions": app.state.source_snapshots[shipment_id]["conditions"]}, ROUTE_PREDICTIONS.get(shipment_id, {}))


# Register after API routes; missing API endpoints must remain JSON 404s.
FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if FRONTEND_DIST.is_dir():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")


@app.get("/", include_in_schema=False)
def frontend_index():
    if (FRONTEND_DIST / "index.html").is_file():
        return FileResponse(FRONTEND_DIST / "index.html")
    return JSONResponse(status_code=503, content={"error": "Frontend is not built. Run python start.py from the repository root."})


@app.get("/favicon.svg", include_in_schema=False)
def frontend_icon():
    icon = FRONTEND_DIST / "favicon.svg"
    if icon.is_file():
        return FileResponse(icon)
    raise HTTPException(status_code=404, detail="Icon not found")
