# Smart Caspian Transit — backend MVP

Это демонстрационный backend для кейса №2 IV Каспийского цифрового форума 2026.
**Все данные синтетические; это не таможенная, навигационная или производственная система.**

## Запуск (Windows PowerShell)

Требуется Python 3.10+.

```powershell
cd backend
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item .env.example .env
python -m uvicorn app.main:app --reload
```

Если PowerShell блокирует активацию, не меняйте системные настройки, используйте прямой путь:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload
```

Документация для тестирования без Postman: http://127.0.0.1:8000/docs
Health: http://127.0.0.1:8000/health

## API-контракт (заморозить на первом чекпоинте)

Все ответы JSON. В `GET /api/shipments` и `GET /api/routes/{shipment_id}` возвращается **массив**, без обёртки `data` или `routes`.

| Метод | Путь | Смысл |
| --- | --- | --- |
| GET | `/api/shipments` | 4 тестовых груза |
| GET | `/api/shipments/{id}` | Детали, этапы, последний статус pre-clearance |
| POST | `/api/predict` | Прогноз (пока базовый модуль, владелец — C) |
| POST | `/api/preclearance` | Проверка тестовых документов; нужен `X-API-Key` |
| GET | `/api/preclearance/{check_id}` | Статус последней проверки |
| GET | `/api/shipments/{id}/events` | Журнал событий |
| GET | `/api/routes/{shipment_id}` | Основной + альтернативный маршрут (владелец — C) |

### Прогноз

```json
{"shipment_id":"SCT-001","weather_severity":4,"port_load":90}
```

`weather_severity`: от 0 до 5, `port_load`: процент от 0 до 100.

Ответ:

```json
{"delay_hours":11.3,"risk":"high","reasons":["Неблагоприятная погода","Высокая загрузка порта"]}
```

Обратите внимание: в примере выше список причин иллюстративный; текущий код также может добавить прочие причины. Реальная величина задержки вычисляется детерминированно из синтетической истории и входных параметров.

### Pre-clearance

Заголовок: `X-API-Key: demo-local-key` (читается из `.env`; ключ только для локального демо).

```json
{
  "shipment_id": "SCT-001",
  "documents": [
    {"type": "invoice", "filename": "invoice.txt"},
    {"type": "packing_list", "filename": "packing.txt"}
  ]
}
```

API записывает событие `submitted`, затем синхронно возвращает `approved` или `rejected`. Для отклонения удалите `packing_list`. События видны через `/api/shipments/SCT-001/events`. Содержимое документов не отправляется в реальные сервисы и не сохраняется.

### Ошибки

- `404`: неизвестный груз / проверка.
- `401`: отсутствует или неверен демонстрационный API-ключ.
- `422`: некорректные поля запроса.
- Все ошибки (включая `401`, `404`, `422`) содержат поле `error`, как в контракте. `422` дополнительно содержит `details`.

## Разделение задач и интеграция

- **B (Backend)** редактирует `app/main.py`, `app/schemas.py`, `app/data.py`, `data/shipments.json`, pre-clearance, события, интеграцию API.
- **C (Prediction & routing)** редактирует только `app/services/prediction.py` и `app/services/routing.py` и тесты своего алгоритма. Подписи функций и формат возвращаемого JSON сохраняются.
- **A (Frontend)** работает с URL `http://127.0.0.1:8000`; CORS разрешён для Vite `localhost:5173`.

## Тесты

Из папки `backend`:

```powershell
python -m pytest -q
```

## Ограничения безопасности

- `X-API-Key` — лишь демонстрация проверки доступа. **Нельзя класть настоящий секрет во frontend**: любой ключ, находящийся в браузерном коде, будет виден пользователю. Для реального защищённого API потребуется серверное посредничество и полноценная авторизация.
- Проверки pre-clearance и журнал событий хранятся **в памяти процесса** и обнуляются при перезапуске.
- Реальных таможенных запросов, GPS и отправки документов нет.
- Длины маршрутов, ETA и CO₂e — условные числа до интеграции алгоритма C.
