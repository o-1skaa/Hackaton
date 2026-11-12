"""Random demo scenarios. No AI, training, or outbound requests."""
from random import choice

SCENARIOS = (
    ("on-time", 0.0, "Задержек нет: обработка груза идёт по расписанию."),
    ("loading", 1.5, "Очередь на погрузку в транзитном порту."),
    ("documents", 3.0, "Ожидание проверки сопроводительных документов."),
    ("rail", 4.5, "Поздняя подача железнодорожного состава."),
    ("wind", 6.0, "Сильный ветер: временно приостановлены портовые операции."),
    ("terminal", 8.0, "Перегрузка контейнерного терминала."),
    ("inspection", 12.0, "Дополнительный таможенный досмотр груза."),
)


def provider_status() -> dict:
    return {"provider": "local", "configured": True, "method": "demo_random"}


def predict(*, shipment: dict, source: dict, route_id: str = "main") -> dict:
    scenario_id, delay, reason = choice(SCENARIOS)
    return {"delay_hours": delay,
            "risk": "low" if delay < 2 else "medium" if delay < 4 else "high",
            "reasons": [reason], "scenario_id": scenario_id, "method": "demo_random",
            "route_id": route_id, "synthetic": True}
