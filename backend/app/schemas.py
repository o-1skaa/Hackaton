from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator


class PredictRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    shipment_id: str
    route_id: Literal["main", "alternative"] = "main"


class PredictResponse(BaseModel):
    delay_hours: float
    risk: Literal["low", "medium", "high"]
    reasons: list[str]
    method: Literal["historical_knn"]
    metrics: dict
    route_id: Literal["main", "alternative"]
    synthetic: Literal[True]


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
    weight_tonnes: float = 20
    departure_at: str = "2026-11-12T00:00:00+00:00"
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
    waypoints: list[tuple[float, float]]
    legs: list[dict]
    transfer: dict
    eta_at: str


class CheckedDocument(BaseModel):
    type: str
    filename: str


class PreclearanceCheck(PreclearanceResponse):
    shipment_id: str
    documents: list[CheckedDocument]


class ShipmentCreate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    name: str = Field(min_length=1, max_length=120, pattern=r'.*\S.*')
    weight_tonnes: float = Field(gt=0, le=10000, allow_inf_nan=False)
    departure_at: str
    conditions: dict

    @field_validator('departure_at')
    @classmethod
    def valid_date(cls, value):
        from datetime import datetime
        if datetime.fromisoformat(value.replace('Z','+00:00')).tzinfo is None:
            raise ValueError('Укажите часовой пояс')
        return value

    @field_validator('conditions')
    @classmethod
    def valid_conditions(cls, value):
        from app.services.data_sources import Conditions
        return Conditions.model_validate(value).model_dump()
