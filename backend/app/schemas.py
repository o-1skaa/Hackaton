from typing import Literal
from pydantic import BaseModel, Field


class PredictRequest(BaseModel):
    shipment_id: str
    weather_severity: float = Field(ge=0, le=5, description="0 — хорошая погода, 5 — экстремальная")
    port_load: float = Field(ge=0, le=100, description="Загрузка порта, в процентах")


class PredictResponse(BaseModel):
    delay_hours: float
    risk: Literal["low", "medium", "high"]
    reasons: list[str]


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
