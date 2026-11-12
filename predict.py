
import csv
from pathlib import Path

HISTORY_PATH = Path(__file__).resolve().parents[2] / "data" / "history.csv"


def predict_delay(weather_severity: int, port_load: int) -> float:
    if not 0 <= weather_severity <= 5:
        raise ValueError("Погода должна быть от 0 до 5")
    if not 0 <= port_load <= 100:
        raise ValueError("Загрузка порта должна быть от 0 до 100")

    neighbors = []

    with open(HISTORY_PATH, "r", encoding="utf-8-sig") as file:
        reader = csv.DictReader(file)

        for row in reader:
            weather = int(row["weather_severity"])
            load = int(row["port_load"])
            delay = float(row["actual_delay_hours"])

            distance = 20 * abs(weather_severity - weather) + abs(port_load - load)
            neighbors.append((distance, delay))

    if not neighbors:
        raise ValueError("История перевозок пуста")

    neighbors.sort(key=lambda x: x[0])

    nearest = neighbors[:5]
    average = sum(item[1] for item in nearest) / len(nearest)

    return round(max(0, average), 1)


def get_risk(delay_hours: float) -> str:
    if delay_hours < 2:
        return "low"
    elif delay_hours < 4:
        return "medium"
    return "high"


def get_reasons(weather_severity: int, port_load: int) -> list[str]:
    reasons = []

    if weather_severity >= 3:
        reasons.append("Неблагоприятные погодные условия")

    if port_load >= 70:
        reasons.append("Высокая загруженность порта")

    if not reasons:
        reasons.append("Существенных факторов задержки не обнаружено")

    return reasons


def predict(weather_severity: int, port_load: int) -> dict:
    delay = predict_delay(weather_severity, port_load)

    return {
        "delay_hours": delay,
        "risk": get_risk(delay),
        "reasons": get_reasons(weather_severity, port_load)
    }
