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

## Прогноз

Запрос `POST /api/predict`:

```json
{"shipment_id":"SCT-001","route_id":"main"}
```

Обязателен ID груза. `route_id`: main / alternative, по умолчанию main.
Погода, загрузка порта, ветер, волны и задержка поезда берутся сервером из текущей
сводки. Любое дополнительное поле в запросе (в том числе прежние погодные параметры)
даёт 422. Неизвестный груз — 404.

Пример ответа (число иллюстративное, фактический результат возвращает Gemini):

```json
{
  "delay_hours":6.5,"risk":"high","reasons":["Высокая загрузка порта и сильный ветер"],
  "model":"gemini-3.8-flash","model_version":"gemini-3.8-flash","method":"external_llm",
  "prompt_version":"caspian-gemini-v2","route_id":"main","synthetic":true,
  "source_snapshot_id":"DEMO-run-id-SCT-001",
  "conditions":{"weather_severity":4,"port_load":90,"wind_speed":17,"wave_height":2.8,"rail_delay":3}
}
```

`model_version` — идентификатор модели из ответа Gemini `modelVersion`, при отсутствии
используется запрошенное имя. `prompt_version` — версия инструкций приложения.
`risk`: low (<2 ч), medium (2–4 ч), high (>=4 ч). При успехе сохраняются задержка
выбранного маршрута, `last_delay_hours` и событие с моделью и ID сводки.
При сбое ETA и события не меняются. Повторный AI-запрос может дать другой результат,
при этом исходные условия в одном запуске сервера одинаковые.

`GET /api/prediction-context/{shipment_id}` возвращает:

- `snapshot_id`: ID сводки текущего запуска;
- `observation_id`: ID выбранной записи файла;
- `synthetic: true`;
- `observed_at`: время формирования демо-сводки, ISO UTC;
- `conditions`: weather_severity (0–5), port_load (0–100 %), wind_speed (0–100 м/с), wave_height (0–30 м), rail_delay (0–720 ч);
- `sources`: массив `{name, kind, note}`;
- `provider`: `{provider: "gemini", configured: boolean, model, method, prompt_version}`.

`configured` проверяет наличие ключа, а не баланс и доступность API. Ключ не передаётся
клиенту. Сводка читается из файлов репозитория при запуске, остаётся стабильной до
следующего запуска и отличается от прошлого сохранённого снимка.

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

## Журнал и маршруты

`Event`: `{timestamp: string, event: "prediction_updated" | "submitted" | "approved" | "rejected", details: string}`. Время — ISO 8601 UTC. Журнал сначала пуст.

`Route`: `{route_id: string, name: string, distance_km: number, eta_hours: number, co2_kg: number, recommended: boolean, reason: string}`.
Возвращаются основной и альтернативный маршруты. Ровно один рекомендуется; политика и ограничения описаны в backend/README.md.

## Ошибки

| Код | Причина | Тело |
| --- | --- | --- |
| 401 | Нет ключа или ключ неверный для POST preclearance | `{error: string}` |
| 404 | Груз или проверка не найдены | `{error: string}` |
| 502 | Невалидный ответ модели | `{error: string}` |
| 503 | Нет ключа или API провайдера недоступен | `{error: string}` |
| 504 | Тайм-аут AI API | `{error: string}` |
| 422 | Некорректный запрос | `{error: "Invalid request payload", details: array}` |

Данные и состояние демонстрационные; прогнозы, проверки и события сбрасываются после перезапуска сервера.
