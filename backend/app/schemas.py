from typing import Literal
from pydantic import BaseModel, ConfigDict, Field


class PredictRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    shipment_id: str
    route_id: Literal["main", "alternative"] = "main"


class PredictResponse(BaseModel):
    delay_hours: float
    risk: Literal["low", "medium", "high"]
    reasons: list[str]
    model: str
    model_version: str
    method: Literal["external_llm"]
    prompt_version: str
    route_id: Literal["main", "alternative"]
    synthetic: Literal[True]
    source_snapshot_id: str
    conditions: dict[str, float]


class SourceContext(BaseModel):
    snapshot_id: str
    observation_id: str
    synthetic: Literal[True]
    observed_at: str
    conditions: dict[str, float]
    sources: list[dict[str, str]]


class PredictionContext(SourceContext):
    provider: dict[str, str | bool]


class Document(BaseModel):
    type: str = Field(min_length=1, description="Например: invoice, packing_list")
    filename: str = Field(min_length=1)
    content: str | None = None  # Тестовое содержимое, необязательно


class PreclearanceRequest(BaseModel):
    shipment_id: str
    documents: list[Document] = Field(min_length=1)


class PreclearanceResponse(BaseModel):
    status: Literal["submitted", "approved", "rejected"]
    check_id: str
    reasons: list[str]


class HealthResponse(BaseModel):
    status: Literal["ok"]
    mode: Literal["synthetic-demo"]


class ShipmentSummary(BaseModel):
    id: str
    name: str
    origin: str
    destination: str
    status: Literal["pending", "in_transit", "completed"]
    synthetic: Literal[True]


class Stage(BaseModel):
    name: str
    status: Literal["pending", "current", "completed"]


class ShipmentDetail(ShipmentSummary):
    historical_avg_delay_hours: float
    stages: list[Stage]
    preclearance_status: Literal["not_submitted", "submitted", "approved", "rejected"]
    last_delay_hours: float | None


class Event(BaseModel):
    timestamp: str
    event: Literal["prediction_updated", "submitted", "approved", "rejected"]
    details: str


class Route(BaseModel):
    route_id: str
    name: str
    distance_km: float
    eta_hours: float
    co2_kg: float
    recommended: bool
    reason: str


class CheckedDocument(BaseModel):
    type: str
    filename: str


class PreclearanceCheck(PreclearanceResponse):
    shipment_id: str
    documents: list[CheckedDocument]
