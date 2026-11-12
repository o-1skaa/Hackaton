"""Parse repository observations and select one new demo report per server run."""
import json
import os
from pathlib import Path
import secrets
from datetime import datetime, timezone
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field

DATA = Path(__file__).resolve().parents[2] / 'data'
OBSERVATIONS_PATH = DATA / 'source_observations.json'
RUNTIME_PATH = DATA / '.runtime' / 'source_snapshots.json'


class Conditions(BaseModel):
    model_config = ConfigDict(extra='forbid')
    weather_severity: float = Field(ge=0, le=5, allow_inf_nan=False)
    wind_speed: float = Field(ge=0, le=100, allow_inf_nan=False)
    wave_height: float = Field(ge=0, le=30, allow_inf_nan=False)
    port_load: float = Field(ge=0, le=100, allow_inf_nan=False)
    rail_delay: float = Field(ge=0, le=720, allow_inf_nan=False)


class Observation(BaseModel):
    observation_id: str = Field(min_length=1)
    conditions: Conditions
    sources: list[dict[str, str]] = Field(min_length=1)


def refresh_snapshots(shipment_ids, *, observations_path=None, runtime_path=None) -> dict:
    observations_path = observations_path or OBSERVATIONS_PATH
    runtime_path = runtime_path or RUNTIME_PATH
    pool = json.loads(observations_path.read_text(encoding='utf-8'))
    try:
        previous = json.loads(runtime_path.read_text(encoding='utf-8'))
    except (FileNotFoundError, json.JSONDecodeError):
        previous = {}
    snapshots = {}
    run_id = uuid4().hex[:12]
    now = datetime.now(timezone.utc).isoformat()
    for shipment_id in shipment_ids:
        observations = [Observation.model_validate(row) for row in pool[shipment_id]]
        if len({item.observation_id for item in observations}) != len(observations):
            raise ValueError(f'Duplicate observation IDs for {shipment_id}')
        if len({item.conditions.model_dump_json() for item in observations}) < 2:
            raise ValueError(f'At least two different observations required for {shipment_id}')
        previous_item = previous.get(shipment_id, {})
        available = [item for item in observations if item.conditions.model_dump() != previous_item.get('conditions')]
        chosen = secrets.choice(available)
        snapshots[shipment_id] = {
            'snapshot_id': f'DEMO-{run_id}-{shipment_id}', 'observation_id': chosen.observation_id,
            'synthetic': True, 'observed_at': now,
            'conditions': chosen.conditions.model_dump(), 'sources': chosen.sources,
        }
    runtime_path.parent.mkdir(parents=True, exist_ok=True)
    # Atomic replacement; no tracked source file is modified on startup.
    temporary = runtime_path.with_name(f'.snapshots-{uuid4().hex}.tmp')
    try:
        temporary.write_text(json.dumps(snapshots, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        os.replace(temporary, runtime_path)
    finally:
        temporary.unlink(missing_ok=True)
    return snapshots
