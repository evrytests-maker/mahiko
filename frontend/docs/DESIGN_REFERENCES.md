# Design References

Дата исследования: **2026-08-06**. Использованы только официальные источники; наблюдения адаптированы, а не скопированы.

## 1. Claude Code — interactive mode

Источник: `https://code.claude.com/docs/en/interactive-mode`

Наблюдения:

- `Esc` останавливает текущий ответ или tool call, не стирая уже завершённую работу.
- Transcript viewer раскрывает подробное использование инструментов; часть tool activity по умолчанию свёрнута до компактной строки.
- Shell mode показывает фактический прогресс и вывод в реальном времени.
- Task list различает pending, in-progress и complete и ограничивает основной список пятью задачами.
- Session recap остаётся одно-строчным и не конкурирует с основным transcript.

Адаптация в проекте:

- отдельная компактная текущая операция;
- управляемая отмена с сохранением завершённых событий;
- свёрнутые команды/tool details и ограниченный output;
- task summary максимум на 5 строк с счётчиком остатка;
- короткий финальный summary без скрытого reasoning.

## 2. Claude Code — official changelog

Источник: `https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md`

На дату просмотра верхняя версия changelog: **2.1.223**.

Релевантные наблюдения:

- В записи 2.1.221 для Focus view описан expandable per-turn summary с live running-tool indicator.
- Для долгих tool calls добавлялся progress heartbeat вместо молчания.
- Отдельно исправлялись избыточные повторные screen-reader announcements от thinking status row и проблемы остановки background tools.

Адаптация в проекте:

- live-регион сообщает только значимые переходы, а не каждую секунду таймера;
- running indicator привязан к реальному текущему событию;
- детали раскрываются пользователем и не перегружают transcript;
- cancellation — отдельное terminal state, а не маскировка под error.

## 3. Claude Code — official repository

Источник: `https://github.com/anthropics/claude-code`

Использован только как подтверждение продуктового контекста terminal coding agent. Визуальные ассеты, названия, логотипы, тексты и пиксельная композиция не копируются.

## 4. Vercel Web Interface Guidelines

Источник: `https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md`

Локальная копия: `frontend/artifacts/skill-evidence/web-interface-guidelines.md`  
Метаданные и SHA-256: `frontend/artifacts/skill-evidence/web-interface-guidelines.meta.txt`

Применяемые правила:

- native semantics before ARIA;
- явные accessible names и `aria-hidden` для декора;
- видимый `:focus-visible`;
- polite live announcements для async status;
- `prefers-reduced-motion`;
- motion только через opacity/transform и без `transition: all`;
- resilient long content, `min-width: 0`, ограниченный вывод;
- tabular numeric timing;
- status не кодируется одним цветом.

## Граница заимствования

Результат берёт только общие interaction-паттерны: компактность, progressive disclosure, interruptibility, status visibility и transcript density. Он остаётся визуально самостоятельным OMP-интерфейсом без названия Claude, фирменных цветов, логотипов, шрифтов, точной геометрии или копирования чужого layout.
