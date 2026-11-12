# Smart Caspian Transit

Демонстрационный MVP для кейса №2 IV Каспийского цифрового форума 2026: грузы и этапы перевозки, прогноз задержек, проверка комплектности документов и сравнение маршрутов.
Все данные синтетические. Реальных таможенных, погодных и навигационных интеграций нет.

## Состав

- `backend/app/main.py` — FastAPI, события и демо-проверки документов.
- `backend/app/schemas.py` — модели запросов и ответов.
- `backend/app/services/` — прогноз и выбор маршрута.
- `backend/data/` — четыре демонстрационных груза и синтетическая история задержек.
- `backend/tests/` — API и алгоритмы.
- `docs/api-contract.md` — контракт для интеграции.
- `.github/workflows/ci.yml` — тесты на Python 3.10 и 3.12.

`frontend` сейчас является файлом-заглушкой; пользовательский интерфейс в эту версию не включён.

## Быстрый запуск

Нужен Python 3.10+. Из корня репозитория:

```sh
cd backend
python -m venv .venv
```

Windows PowerShell:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item .env.example .env
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload
```

Linux/macOS:

```sh
.venv/bin/python -m pip install -r requirements.txt
cp .env.example .env
.venv/bin/python -m uvicorn app.main:app --reload
```

Swagger: http://127.0.0.1:8000/docs. Health: http://127.0.0.1:8000/health.
Запускать сервер следует из `backend`; `.env` и файлы данных разрешаются относительно кода.

## Проверка

Из `backend`, с Python своего виртуального окружения:

```sh
python -m pip install -r requirements-dev.txt
python -m pytest -q
```

Подробности и ограничения: [backend/README.md](backend/README.md).
