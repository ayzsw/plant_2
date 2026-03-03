# Plantiz Multimodal Research Agent

Одностраничный веб-продукт для полевых исследований растений:
- Upload image
- Optional inputs: region / season / goal
- Run Agent
- Agent Timeline (5 шагов + live progress + self-check retry)
- Research Report
- Export Markdown
- History (last 5)

## Режим по умолчанию
Проект работает как **frontend-only** (без backend):
- агентный пайплайн выполняется в браузере,
- отчёт генерируется локально,
- история хранится в `localStorage`.

## Запуск
- `npm run dev`
- открыть URL от Vite (обычно `http://localhost:5173`)

## Build
- `npm run build`

## Примечание
Файл `server/index.mjs` оставлен в репозитории как опциональный backend-прототип, но для текущего деплоя не используется.
