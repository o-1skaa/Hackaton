# API-контракт Smart Caspian Transit

Базовый адрес: `http://127.0.0.1:8000`. Все тела запросов и ответов — JSON.
Массивы возвращаются без обёрток `data` или `routes`.
Авторитетные модели — `backend/app/schemas.py`; полный OpenAPI доступен по `/openapi.json`.

| Метод | Путь | Ответ 200 |
| --- | --- | --- |
| GET | `/health` | `{status: "ok", mode: "synthetic-demo"}` |
| GET | `/api/shipments` | `ShipmentSummary[]` |
| GET | `/api/shipments/{shipment_id}` | `ShipmentDetail` |
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

Запрос:

```json
{"shipment_id":"SCT-001","weather_severity":4,"port_load":90}
```

Погода: число 0–5; загрузка порта: число 0–100. Неизвестный груз возвращает 404.
Ответ для текущей синтетической истории:

```json
{"delay_hours":6.5,"risk":"high","reasons":["Неблагоприятные погодные условия","Высокая загруженность порта"]}
```

`risk`: `low | medium | high`. После запроса обновляется `last_delay_hours` и добавляется событие `prediction_updated`.

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
| 422 | Некорректный запрос | `{error: "Invalid request payload", details: array}` |

Данные и состояние демонстрационные; прогнозы, проверки и события сбрасываются после перезапуска сервера.


## Подготовка frontend к расширению прогноза

Текущий POST `/api/predict` остаётся описанным выше. Обученная ML-модель и
физические погодные параметры пока отсутствуют в backend.

Frontend готов к добавлению в PredictRequest: `wind_speed` (м/с), `wave_height`
(м), `rail_delay` (ч), `route_id` (строка из GET routes), при сохранении
`shipment_id` и `port_load`. Поля включаются только при наличии в OpenAPI.
Если новый backend не использует `weather_severity`, его не нужно объявлять:
интерфейс скроет погодную шкалу и не отправит её вместо физических параметров.

Для сведений о модели frontend поддерживает необязательные строки в PredictResponse:
`model`, `method`, `model_version`. Они не являются доказательством качества модели;
метрики должны быть проверены при её обучении. Пока backend не возвращает эти поля,
интерфейс показывает отсутствие сведений. Расширение контрактов нужно реализовать
на backend вместе с моделью, а не просто добавить поля, которые прогноз игнорирует.
