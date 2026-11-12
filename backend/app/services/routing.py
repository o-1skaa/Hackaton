"""Временные синтетические варианты маршрута. Разработчик C заменяет реализацию.

Значения расстояний, ETA и CO₂e являются только примером, не реальными расчётами.
"""


def calculate_routes(shipment: dict, predicted_delay_hours: float) -> list[dict]:
    alt_recommended = predicted_delay_hours >= 5
    return [
        {
            "route_id": "main",
            "name": "Основной (демо): Астрахань → Махачкала → Бендер-Аббас",
            "distance_km": 1800.0,
            "eta_hours": round(72 + predicted_delay_hours, 1),
            "co2_kg": 540.0,
            "recommended": not alt_recommended,
            "reason": "Основной маршрут",
        },
        {
            "route_id": "alternative",
            "name": "Альтернативный (демо): Астрахань → Баку → Бендер-Аббас",
            "distance_km": 1950.0,
            "eta_hours": 70.0,
            "co2_kg": 620.0,
            "recommended": alt_recommended,
            "reason": "Обход задержки на основном маршруте" if alt_recommended else "Резервный маршрут",
        },
    ]
