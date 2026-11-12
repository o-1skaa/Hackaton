# API-контракт Smart Caspian Transit

Базовый адрес: `http://127.0.0.1:8000`. Все тела запросов и ответов — JSON.
Массивы возвращаются без обёрток `data` или `routes`.
Авторитетные модели — `backend/app/schemas.py`; полный OpenAPI доступен по `/openapi.json`.

| Метод | Путь | Ответ 200 |
| --- | --- | --- |
| GET | `/health` | `{status: "ok", mode: "synthetic-demo"}` |
| GET | `/api/shipments` | `ShipmentSummary[]` |
| GET | `/api/shipments/{shipment_id}` | `ShipmentDetail` |
| GET | `/api/prediction-context/{shipment_id}` | `PredictionContext` |
| POST | `/api/predict` | `PredictResponse` |
| POST | `/api/preclearance` | `PreclearanceResponse` |
| GET | `/api/preclearance/{check_id}` | `PreclearanceCheck` |
| GET | `/api/shipments/{shipment_id}/events` | `Event[]` |
| GET | `/api/routes/{shipment_id}` | `Route[]` |

## Грузы

`ShipmentSummary`: `id`, `name`, `origin`, `destination` — строки; `status` — `pending | in_transit | completed`; `synthetic` — `true`.

`ShipmentDetail` дополнительно содержит:

- `historical_avg_delay_hours`: число;
- `stages`: массив `{name: string, status: "pending" | "current" | "completed"}`;
- `preclearance_status`: `not_submitted | submitted | approved | rejected`;
- `last_delay_hours`: число или `null` до первого прогноза.

## Случайный сценарий

`POST /api/predict`: `{"shipment_id":"SCT-001","route_id":"main"}`.
`route_id`: main / alternative, по умолчанию main. Неизвестный груз — 404,
лишние поля и неверный маршрут — 422.

Пример ответа:

```json
{"delay_hours":6,"risk":"high","reasons":["Сильный ветер: временно приостановлены портовые операции."],"scenario_id":"wind","method":"demo_random","route_id":"main","synthetic":true}
```

Случайный выбор одного из 7 сценариев; повторения допустимы.
`risk`: low <2 ч, medium <4 ч, high >=4 ч. Ключи и внешние API не используются.
Задержка записывается для выбранного маршрута, в карточку и журнал.

`GET /api/prediction-context/{shipment_id}` сохраняет справочные синтетические
сводки; `provider`: `{"provider":"local","configured":true,"method":"demo_random"}`.
Сводки не участвуют в генерации задержки.

## Маршруты и карта

`GET /api/routes/{shipment_id}` возвращает Route[]: `route_id`, `name`,
`distance_km`, `eta_hours`, `co2_kg`, `recommended`, `reason`,
`waypoints` — массив пар [широта, долгота].
ETA = базовые 72 ч (main) или 70 ч (alternative) + последняя задержка маршрута.
Основной путь через Махачкалу; альтернативный через Баку. Общие конечные точки:
Астрахань и Бендер-Аббас. Геометрия схематичная, все показатели демонстрационные.
Карта Leaflet не делает запросов роутинга; только подложка загружается из OpenStreetMap.

## Проверка документов

POST требует заголовок `X-API-Key` со значением `DEMO_API_KEY` (локальный пример: `demo-local-key`).

```json
{
  "shipment_id": "SCT-001",
  "documents": [
    {"type":"invoice","filename":"invoice.txt"},
    {"type":"packing_list","filename":"packing.txt"}
  ]
}
```

`documents` — непустой массив. В документе `type` и `filename` — непустые строки; `content` — необязательная строка или null. Содержимое не сохраняется и не анализируется.

Ответ: `{status: "approved" | "rejected", check_id: string, reasons: string[]}`.
Оба обязательных типа дают approved, отсутствие одного из них — rejected. Сначала записывается событие submitted, затем итоговое событие. Проверка выполняется сразу; ожидать фоновую обработку не требуется.

GET проверки возвращает тот же результат плюс `shipment_id` и `documents: {type: string, filename: string}[]`. Возвращаемые типы документов сохраняют исходное написание.

## Журнал

`Event`: `{timestamp: string, event: "prediction_updated" | "submitted" | "approved" | "rejected", details: string}`.
Время — ISO 8601 UTC. Журнал сначала пуст.

## Ошибки

401 — неверный ключ проверки документов; 404 — груз или проверка не найдены;
422 — неверный запрос. Тело ошибки содержит `error`, для 422 также `details`.
Состояние демонстрационное и сбрасывается после перезапуска.
