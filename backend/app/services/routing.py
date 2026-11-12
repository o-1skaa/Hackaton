"""Временные синтетические варианты маршрута. Разработчик C заменяет реализацию.

Значения расстояний, ETA и CO₂e являются только примером, не реальными расчётами.
"""


def calculate_routes(shipment: dict, predicted_delays: dict[str, float]) -> list[dict]:
    # Без прогноза задержка маршрута равна нулю, это базовый ETA, не AI-оценка.
    # Приоритет демо: меньшие выбросы, пока задержка не достигла 5 часов.
    main_delay = predicted_delays.get("main", 0)
    alternative_delay = predicted_delays.get("alternative", 0)
    alt_recommended = 70 + alternative_delay < 72 + main_delay and main_delay >= 5
    return [
        {
            "route_id": "main",
            "name": "Основной (демо): Астрахань → Махачкала → Бендер-Аббас",
            "distance_km": 1800.0,
            "eta_hours": round(72 + main_delay, 1),
            "co2_kg": 540.0,
            "recommended": not alt_recommended,
            "reason": (
                "Меньше CO₂; при задержке от 5 ч сравниваются ETA"
                if not alt_recommended else "Основной маршрут задерживается; альтернатива быстрее"
            ),
        },
        {
            "route_id": "alternative",
            "name": "Альтернативный (демо): Астрахань → Баку → Бендер-Аббас",
            "distance_km": 1950.0,
            "eta_hours": round(70 + alternative_delay, 1),
            "co2_kg": 620.0,
            "recommended": alt_recommended,
            "reason": "Меньше ETA при задержке основного маршрута" if alt_recommended else "Резервный маршрут",
        },
    ]
