"""Временный воспроизводимый алгоритм. Разработчик C заменяет реализацию.

Контракт функции менять только после согласования с разработчиком B.
"""


def predict_delay(shipment: dict, weather_severity: float, port_load: float) -> dict:
    historical = float(shipment["historical_avg_delay_hours"])
    delay = round(max(0.0, historical + 1.6 * weather_severity + 0.06 * port_load - 2.5), 1)

    reasons: list[str] = []
    if weather_severity >= 3:
        reasons.append("Неблагоприятная погода")
    if port_load >= 70:
        reasons.append("Высокая загрузка порта")
    if historical >= 3:
        reasons.append("Исторически высокий уровень задержек")
    if not reasons:
        reasons.append("Риск задержки по базовой оценке")

    risk = "high" if delay >= 8 else "medium" if delay >= 4 else "low"
    return {"delay_hours": delay, "risk": risk, "reasons": reasons}
