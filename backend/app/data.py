import json
from pathlib import Path

DATA_PATH = Path(__file__).resolve().parents[1] / "data" / "shipments.json"

with DATA_PATH.open("r", encoding="utf-8") as file:
    SHIPMENTS = {item["id"]: item for item in json.load(file)}
