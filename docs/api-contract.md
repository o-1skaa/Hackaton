# API Smart Caspian Transit

GET `/health` — состояние API.
GET `/api/shipments` — список отправок.
GET `/api/shipments/{id}` — карточка, этапы, последняя портовая задержка и комплектность документов.
POST `/api/shipments` — создать отправку (201):

```json
{"name":"Оборудование","weight_tonnes":20,"departure_at":"2026-11-12T08:00:00Z","conditions":{"weather_severity":3,"port_load":70,"rail_delay":4,"wind_speed":10,"wave_height":1}}
```

Направление фиксировано, начальный статус pending. Имя непустое, масса >0 и ≤10000 т. Дата ISO 8601 с часовым поясом. Погода 0–5, порт 0–100%, поезд 0–720 ч, ветер 0–100 м/с, волны 0–30 м. Числа конечные. Невалидный запрос — 422.

GET `/api/prediction-context/{id}` — условия и происхождение данных. Новые отправки используют введённые условия, встроенные — сводку из файлов.
POST `/api/predict` принимает `{"shipment_id":"SCT-001","route_id":"main"}`. Route: main или alternative. Ответ: delay_hours, risk (low/medium/high), reasons, method=historical_knn, route_id, synthetic=true, metrics. delay_hours — задержка обработки порта/терминала, без поезда и ожидания рейса. Повторный запрос с теми же условиями даёт тот же ответ. Обновляет только прогноз выбранного маршрута.

GET `/api/model-metrics` — train_count=160, test_count=40, MAE прогноза, MAE среднего, средний прогноз и описание границ проверки. Единицы ошибки — часы.
GET `/api/routes/{id}` — два маршрута. Каждый содержит route_id, name, distance_km, eta_hours (длительность), eta_at (ISO дата), co2_kg, recommended, reason, waypoints ([широта, долгота]), legs и transfer.

Leg: mode (rail/ferry/road), stops (русские названия), waypoints, distance_km, duration_hours, factor_kg_per_tkm, co2_kg. Итоговые расстояние и выбросы — суммы по legs.
Transfer: applicable (есть ли паром), planned_train_arrival_hours, actual_train_arrival_hours, ready_hours, planned_ferry_departure_hours, ferry_departure_hours, missed_ferry, wait_hours, delay_hours, interval_hours. Время отсчитывается от отправления груза. Для alternative поля парома не применяются, проверяйте applicable.

До прогноза задержка обработки равна нулю. Опоздание поезда уже известно из условий. Для сравнения прогнозов рассчитайте оба маршрута. Базовые встроенные отправки имеют опорное отправление 12 ноября 2026, 00:00 UTC и массу 20 т. Добавленные — введённые дату и массу.

POST `/api/preclearance` с заголовком `X-API-Key` и телом `{"shipment_id":"SCT-001","documents":[{"type":"invoice","filename":"invoice.pdf"},{"type":"packing_list","filename":"packing.pdf"}]}` проверяет комплектность. GET `/api/preclearance/{check_id}` возвращает проверку.
GET `/api/shipments/{id}/events` — события прогнозов и документов.

Ошибка — JSON с полем error; отсутствующий ресурс 404, неверный ключ 401, неверный ввод 422.
Отправки сохраняются в SQLite. Журнал, прогнозы и документы — в памяти до перезапуска.
