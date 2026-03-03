# Plantiz Multimodal Research Agent

Одностраничный веб-продукт для полевых исследований растений:
- Upload image
- Optional inputs: region / season / goal
- Run Agent
- Agent Timeline (5 шагов + live progress + self-check retry)
- Research Report
- Export Markdown
- History (last 5)

## Архитектура
- `src/` — React UI
- `server/index.mjs` — backend-оркестратор агента (HTTP + SSE)

## Запуск (локально)
0. (Опционально) создать `.env` по примеру `.env.example` и добавить `OPENAI_API_KEY=sk-...`
1. Терминал 1: `npm run dev:server`
2. Терминал 2: `npm run dev`
3. Открыть URL от Vite (обычно `http://localhost:5173`)

Vite проксирует `/api/*` на backend `http://localhost:8788`.

## Переменные окружения backend
- `OPENAI_API_KEY` — ключ OpenAI (опционально)
- `OPENAI_MODEL` — модель (по умолчанию `gpt-4o-mini`)
- `PORT` — порт backend (по умолчанию `8788`)

Если меняете `PORT`, обновите `target` в `vite.config.js` на тот же порт.

Если `OPENAI_API_KEY` не задан, backend работает в fallback-режиме (детерминированная локальная генерация отчета).

## API
- `GET /api/health`
- `POST /api/research/run`
  - body: `{ imageDataUrl, imageName, region?, season?, goal? }`
  - response: `{ ok: true, runId }`
- `GET /api/research/stream/:runId` (SSE)
  - события: `run_started`, `step_update`, `report_ready`, `run_error`
- `GET /api/research/history`

## Build
`npm run build`
