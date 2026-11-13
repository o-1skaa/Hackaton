# API Smart Caspian Transit

GET `/health` — состояние API.
GET `/api/shipments` — список отправок.
GET `/api/shipments/{id}` — карточка, расчётные этапы/статус, последняя портовая задержка, preclearance_status и latest_check_id.
POST `/api/shipments` — создать отправку (201):

```json
{"name":"Оборудование","weight_tonnes":20,"departure_at":"2026-11-12T08:00:00Z","conditions":{"weather_severity":3,"port_load":70,"rail_delay":4,"wind_speed":10,"wave_height":1}}
```

Направление фиксировано, статус вычисляется по расчётному расписанию. Имя непустое, масса >0 и ≤10000 т. Дата ISO 8601 с часовым поясом. Погода 0–5, порт 0–100%, поезд 0–720 ч, ветер 0–100 м/с, волны 0–30 м. Числа конечные. Невалидный запрос — 422.

GET `/api/prediction-context/{id}` — условия и происхождение данных. Новые отправки используют введённые условия, встроенные — сводку из файлов.
POST `/api/predict` принимает `{"shipment_id":"SCT-001","route_id":"main"}`. Route: main или alternative. Ответ: delay_hours, risk (low/medium/high), reasons, method=historical_knn, route_id, synthetic=true, metrics. delay_hours — задержка обработки порта/терминала, без поезда и ожидания рейса. Повторный запрос с теми же условиями даёт тот же ответ. Обновляет только прогноз выбранного маршрута.

GET `/api/model-metrics` — train_count=160, test_count=40, MAE прогноза, MAE среднего, средний прогноз и описание границ проверки. Единицы ошибки — часы.
GET `/api/routes/{id}` — два маршрута. Каждый содержит route_id, name, distance_km, eta_hours (длительность), eta_at (ISO дата), co2_kg, recommended, reason, waypoints ([широта, долгота]), legs и transfer.

Leg: mode (rail/ferry/road), stops (русские названия), waypoints, distance_km, duration_hours, factor_kg_per_tkm, co2_kg. Итоговые расстояние и выбросы — суммы по legs.
Transfer: applicable (есть ли паром), planned_train_arrival_hours, actual_train_arrival_hours, ready_hours, planned_ferry_departure_hours, ferry_departure_hours, missed_ferry, wait_hours, delay_hours, interval_hours. Время отсчитывается от отправления груза. Для alternative поля парома не применяются, проверяйте applicable.

Маршруты всегда учитывают автоматически рассчитанный исторический прогноз. POST predict возвращает его объяснение/метрики и записывает событие. Базовые встроенные отправки имеют опорное отправление 12 ноября 2026, 00:00 UTC и массу 20 т. Добавленные — введённые дату и массу.

GET `/api/shipments/{id}/operations` — состояние цифрового двойника, риски, погода и альтернативный маршрут:

- `twin`: route_id, as_of (UTC ISO), location, location_source=calculated, current_stage, next_stop, stages (name/status/arrival_at), transport (mode/from/to/status), status, eta_hours (полная длительность), remaining_hours, planned_eta_at, eta_at, co2_kg, missed_connection, synthetic=true.
- `risks`: code, title, level (low/medium/high/critical), recommendation, route_action, source. После расчётного завершения перевозки активных рисков нет.
- `weather`: code/title/value/unit/level/description. Пороговые правила в `rule_note`, не результат обучения ML.
- `routes`: оба маршрута с историческим прогнозом. `alternative`: прогноз альтернативы при переходе сейчас, включая уже потраченное ожидание. `can_apply`: доступен ли переход.

POST `/api/shipments/{id}/route` с `{"route_id":"alternative"}` — применить сухопутный маршрут; ответ как operations. Доступен только с основного до расчётного отправления парома. Повторное применение уже активного маршрута идемпотентно; небезопасная по расписанию смена — 409. Выбор и время ожидания сохраняются в SQLite, исходное плановое прибытие сохраняется. Это демо с одним направлением переключения.

POST `/api/preclearance` с заголовком `X-API-Key` проверяет JSON-содержимое документов:

```json
{"shipment_id":"SCT-001","documents":[{"type":"invoice","filename":"invoice.json","content":"{\"shipment_id\":\"SCT-001\",\"weight_tonnes\":20,\"document_number\":\"INV-1\"}"},{"type":"packing_list","filename":"packing_list.json","content":"{\"shipment_id\":\"SCT-001\",\"weight_tonnes\":20,\"document_number\":\"PL-1\"}"}]}
```

Ответ: status=verified/rejected, check_id, reasons. GET `/api/preclearance/{check_id}` дополнительно возвращает shipment_id и документы (type, filename, status=verified/error/approved, reasons). Исходное содержимое не сохраняется. Проверка требует ровно один документ каждого типа, обязательные поля, номер отправки и совпадение массы. До 10 документов, до 100000 символов в content каждого; интерфейс ограничивает файлы 100 КБ. Произвольные PDF и сканы не анализируются.

POST `/api/preclearance/{check_id}/submit` с `X-API-Key` и пустым телом — отдельная передача успешно проверенного актуального пакета на демооформление; возвращает проверку с status=approved. Повторная отправка идемпотентна. Непроверенный/отклонённый/устаревший пакет — 409. Реального обращения в таможенные органы нет.

GET `/api/shipments/{id}/events` — события prediction_updated, verified, rejected, submitted, approved, route_applied.
Ошибка — JSON с полем error; отсутствующий ресурс 404, неверный ключ 401, неверный ввод 422, конфликт состояния 409.
Отправки, выбранный маршрут и проверки сохраняются в SQLite. Журнал и явные запросы прогнозов — в памяти до перезапуска. Данные синтетические, положение расчётное, HTTPS/производственная авторизация не входят в локальное демо.
