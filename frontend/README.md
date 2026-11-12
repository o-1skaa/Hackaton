# Frontend

React + TypeScript + Vite. Полная инструкция — в [README проекта](../README.md).

`npm ci && npm run dev` — разработка на http://localhost:5173 (API проксируется в :8000).
`npm run build` — сборка в dist; FastAPI раздаёт её на `/` после запуска сервера.
`npm run lint` — проверка кода.

По умолчанию запросы относительные. `VITE_API_URL` позволяет задать иной базовый URL.
Нужны Node.js 22.12+ и npm. `dist` и node_modules не коммитятся.
