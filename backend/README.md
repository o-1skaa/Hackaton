# Backend Smart Caspian Transit

FastAPI, Python 3.10+. Запуск и описание модели: [общий README](../README.md).

`app/services/prediction.py` рассчитывает задержку обработки порта/терминала по 8 ближайшим историческим наблюдениям с учётом погоды и загрузки порта. Отложенные строки не участвуют в прогнозе. Метрики доступны через GET /api/model-metrics и в ответе прогноза. Внешних API и ключей ИИ нет.

`app/services/routing.py` использует единую геометрию для карты и расстояний, суммирует выбросы по участкам и учитывает пропущенный паром по расписанию. Альтернатива через Баку сухопутная.

Новые отправки сохраняются в SQLite в data/.runtime/shipments.sqlite3. Их условия не меняются при перезапуске. Для встроенных отправок при запуске выбираются синтетические сводки. Выбранный маршрут и результаты проверок документов также сохраняются в SQLite; журнал и явные запросы прогнозов — в памяти.

Контракт: [docs/api-contract.md](../docs/api-contract.md).
Репетиция: [docs/demo.md](../docs/demo.md).
Тесты: `python -m pip install -r requirements-dev.txt`, затем `python -m pytest -q`.

Цифровой двойник и центр рисков: GET /api/shipments/{id}/operations. Применить альтернативу: POST /api/shipments/{id}/route. Документы — JSON с shipment_id, weight_tonnes и document_number: сначала POST /api/preclearance, затем POST /api/preclearance/{check_id}/submit (X-API-Key). Подробный контракт: ../docs/api-contract.md.
