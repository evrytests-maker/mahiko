# Interaction Audit

Дата финальной проверки: **2026-08-06**.

## Методика и границы

Инвентаризация выполнена поиском по `button`, `a`, `input`, `role="option"`, `role="treeitem"`, `role="tab"`, `role="listbox"`, `onClick`, `onSubmit`, `onKeyDown`, глобальным shortcuts и pointer handlers в `src/renderer/**`.

Повторяющиеся элементы перечислены как **семейства**: например, каждая строка дерева файлов использует один и тот же `source-row` handler, а каждая строка settings — один и тот же roving-focus/toggle flow. Это покрывает все динамические экземпляры без бессмысленного копирования десятков одинаковых строк.

Основное автоматизированное доказательство — `scripts/run_browser_qa.py`, который исполняет фактические TS/TSX-исходники в Chromium и завершился результатом **101/101**. Дополнительно в source находятся **22** Vitest/Testing Library test cases. Package-backed Vitest не смог быть запущен из-за недоступного npm-registry; этот предел честно зафиксирован в `VERIFICATION_REPORT.md`.

Обозначения evidence:

- **BQA:** название проверки из `artifacts/verification/browser/browser-qa.json`;
- **UT:** test case из `src/**/*.test.ts(x)`;
- **Core:** dependency-independent проверка фактической логики из `scripts/run_core_verification.mjs`.

## 1. Глобальная оболочка и shortcuts

| Компонент / подпись | Ожидаемое действие | State | Keyboard / focus | Automated evidence | Итог |
|---|---|---|---|---|---|
| `App` — «Перейти к чату» | Переводит к `#main-workspace` | Скрыта до focus, всегда доступна | Первый focusable link; Enter активирует fragment target | BQA `skip link targets the main workspace` | PASS |
| Header — «Показать боковую панель» | Открывает/закрывает Environment sidebar | `aria-expanded`, `aria-controls` | Native Enter/Space; после закрытия focus возвращается на trigger | BQA `sidebar close restores its trigger`; `outside pointer closes sidebar` | PASS |
| Header — проект | Открывает системный выбор папки; cancel ничего не меняет | Активна, async | Native Enter/Space; cancel сохраняет текущий UI | BQA `project and runtime controls survive a cancelled browser preview` | PASS |
| Header — «Обновить состояние OMP» | Повторно читает runtime snapshot | Состояние отображается текстом и glyph, не только цветом | Native Enter/Space | BQA `project and runtime controls survive a cancelled browser preview` | PASS |
| Header — «Открыть команды» | Открывает command palette | Modal open/closed | Click, `Ctrl/Cmd+K`; Escape закрывает и восстанавливает focus | BQA `palette Escape restores its trigger`; UT `фильтрует палитру…` | PASS |
| Header — «Показать сведения» | Открывает/закрывает Inspector | `aria-expanded`, `aria-controls` | Click, `Ctrl/Cmd+Shift+B`; Escape/close возвращает focus | BQA `inspector Escape closes and restores focus`; `inspector close restores its trigger` | PASS |
| `Ctrl/Cmd+B` | Переключает sidebar | Использует persisted `navVisible` | Не срабатывает как текстовый ввод | Source handler + sidebar BQA | PASS |
| `Ctrl/Cmd+,` | Открывает OMP settings | Modal | Settings получает focus; close/Escape возвращают предыдущий focus | BQA `settings close restores composer focus`; UT overlays | PASS |
| Global `Escape` | Приоритетно: modal → active run → picker → panels → file → page | Не закрывает случайно второй слой | Одна ветка на нажатие; running вызывает настоящий abort | BQA cancel/panel/page/focus checks | PASS |
| Pointer outside sidebar | Закрывает только sidebar | Listener существует только пока sidebar открыт | Не затрагивает Inspector/modal | BQA `outside pointer closes sidebar` | PASS |

## 2. Composer, status line и slash menu

| Контрол | Действие | Disabled / selected / expanded | Keyboard / focus | Evidence | Итог |
|---|---|---|---|---|---|
| Input «Сообщение ma-hi-ko» | Редактирует prompt; обычный Enter отправляет | Disabled на весь active run; placeholder меняется | Escape очищает непустой draft; ArrowUp/Down управляют slash suggestions | BQA `composer disables during run`, `composer Escape clears a draft`; UT OmpChrome | PASS |
| Form submit / «Отправить сообщение» | Запускает один preview run | Disabled при пустом prompt и во время run | Enter либо native button Enter/Space; guard не допускает double submit | BQA `empty composer keeps send disabled`, activity flow; App guard | PASS |
| Model trigger | Открывает model listbox | `aria-label` содержит текущую модель | Listbox получает focus; ArrowUp/Down, Enter; после выбора focus возвращается | BQA model selection/focus; UT keyboard model listbox | PASS |
| Model options | Выбирают модель | `role=option`, `aria-selected`, highlighted row | Pointer, hover, Enter через listbox | BQA keyboard + Inspector mouse selection; UT | PASS |
| Thinking trigger | Открывает thinking listbox | Текущий level в accessible name | ArrowUp/Down, Enter, Escape; focus restoration | BQA thinking selection/focus; UT | PASS |
| Thinking options | Меняют уровень | `role=option`, `aria-selected` | Pointer/hover или Enter из listbox | BQA + UT | PASS |
| Project status segment | Открывает project chooser | Text fallback «выбрать проект» | Native button semantics | BQA cancelled chooser safety | PASS |
| Context status segment | Переключает compact/full context | `aria-pressed`; label меняется в обе стороны | Native Enter/Space | BQA `status context control exposes pressed state`; UT | PASS |
| Runtime status segment | Refresh runtime | Семантический label | Native Enter/Space | BQA runtime controls | PASS |
| Slash suggestions | Маршрутизируют точную команду | Max 5, `role=listbox/option`, `aria-selected` | ArrowUp/Down, Enter, pointer/hover; быстрый Enter не выбирает старый index | BQA settings/plugins/routes; UT `slash-команду без race` | PASS |
| Slash command Escape | Очищает input, а не закрывает случайный panel | — | Escape | BQA composer draft clear | PASS |

Проверены все объявленные slash routes: `/models`, `/settings`, `/session`, `/mcp list`, `/plugins`, `/usage`, `/context`, `/compact`, `/login`, `/tools`, `/memory`, `/changelog full`. Несуществующая команда не создаёт ложную активность и остаётся обычным prompt только если пользователь отправляет её без доступного suggestion.

## 3. Environment sidebar и file viewer

| Контрол / семейство | Действие | State | Keyboard / focus | Evidence | Итог |
|---|---|---|---|---|---|
| «Скрыть панель среды» | Закрывает sidebar | — | Native button; focus на header trigger | BQA `sidebar close restores its trigger` | PASS |
| «Изменения» | Открывает Changes surface и закрывает sidebar | Active row определяется текущим view | Native button | BQA `changes row opens the changes surface` | PASS |
| «Локальный» disclosure | Показывает/скрывает environment details | `aria-expanded` | Native button | BQA collapse + expand | PASS |
| Branch `main` | Открывает Changes surface | — | Native button | BQA `branch row opens the same changes surface` | PASS |
| «Создать коммит или отправить» | Намеренно недоступно без OMP git tools | Реальный `disabled`, tooltip объясняет причину | Не попадает в action flow | BQA `unavailable git action is truly disabled` | PASS |
| Browser project row | Возвращает в chat | Active styling | Native button | BQA `browser project row returns to chat` | PASS |
| «Выбрать папку проекта» | Открывает chooser и закрывает sidebar | Cancel безопасен | Native button | BQA `sidebar project chooser closes after a cancelled dialog` | PASS |
| Directory `treeitem` | Раскрывает/сворачивает конкретный каталог | `aria-expanded`, stable path key | Native button; доступно без hover | BQA tree expansion/show-all | PASS |
| File `treeitem` | Читает bounded preview и закрывает sidebar | Active file row | Native button; loading через `aria-busy` у viewer | BQA file open | PASS |
| «Показать все / Свернуть» | Меняет лимит отображения source tree | Двусторонняя подпись | Native button | BQA reveal + collapse | PASS |
| Sidebar footer «Настройки OMP» | Открывает settings, закрывая sidebar | Modal | Close восстанавливает focus на header sidebar trigger | BQA sidebar settings/focus | PASS |
| File viewer «Вернуться в чат» | Закрывает read-only file view | — | Native button; Escape имеет тот же маршрут | BQA back button + earlier file Escape | PASS |

## 4. Inspector

| Контрол | Действие | State | Keyboard / focus | Evidence | Итог |
|---|---|---|---|---|---|
| «Скрыть сведения» | Закрывает Inspector | — | Click/Escape; focus возвращается на trigger | BQA inspector close/focus | PASS |
| Project value | Project chooser | Async cancel safe | Native button | BQA Inspector interaction sequence | PASS |
| Branch `main ?18` | Changes surface | — | Native button | BQA Inspector branch sequence | PASS |
| Model value | Открывает общий model picker | Текущая модель | Picker keyboard/pointer; shared state | BQA `inspector model action applies a mouse selection` | PASS |
| Thinking value | Циклически меняет уровень | Accessible name содержит current | Native button | BQA `inspector thinking control cycles the level`; UT | PASS |
| Context usage | Compact/full | `aria-pressed`; label and value change | Native button | BQA `inspector context control exposes pressed state` | PASS |
| OMP value | Refresh runtime | Text + semantic class | Native button | BQA Inspector sequence, clean console | PASS |
| RPC value | Refresh runtime | Text + semantic class | Native button | BQA Inspector sequence, clean console | PASS |

## 5. Activity stream

| Контрол / состояние | Действие | State contract | Keyboard / focus | Evidence | Итог |
|---|---|---|---|---|---|
| Current operation | Показывает единственную активную строку и elapsed | `running`, `aria-live=polite` только для существенного статуса | Не требует hover | BQA `current operation is visible`; UT transitions | PASS |
| «Остановить Esc» | Abort активного preview и timers | Доступна только running; один вызов | Click или global Escape | BQA Escape cancel + `Stop button aborts the active stream`; UT calls once/cleanup | PASS |
| Event detail toggle | Раскрывает summary/command/output | Только события с реальными details получают button; `aria-expanded/controls` | Native Enter/Space | BQA running/error/success details; UT no false disclosure | PASS |
| «Ещё N шагов / Свернуть список» | Лимит 5 строк, раскрытие полного плана | `aria-expanded` | Native button | BQA output scenario; UT compact five-row rail | PASS |
| «Повторить» | Повторяет тот же prompt в том же ActivityRun ID с attempt+1 | Только error/cancelled и только без другого active run | Native button | BQA cancel retry + error retry; UT | PASS |
| «Копировать детали» | Копирует безопасную сериализацию activity | Feedback «Скопировано»; нет скрытого reasoning | Native button | BQA clipboard content; UT | PASS |
| «К новым событиям» | Возвращает transcript к низу только по запросу | Появляется только если user scroll-up сохранён | Native button | BQA manual scroll/new events | PASS |
| Pending | Не выглядит running/completed | Text + glyph + label | — | Core/UT transitions | PASS |
| Success | Duration/exit code/summary | Terminal; details collapsed by default | — | BQA 7/7, exit 0 | PASS |
| Error | Краткая причина, exit code, recovery, Retry/Copy | Terminal; не маскируется цветом | — | BQA error state/details/retry | PASS |
| Cancelled | Завершённый terminal state без late updates | Pending/running становятся cancelled; completed сохраняются | — | BQA no late completion; Core/UT abort cleanup | PASS |

Output команды хранится ограниченно и в DOM показываются только последние 20 строк. Stable IDs формируются adapter/fixture, не presentation component. UI не содержит chain-of-thought; только безопасные summaries, наблюдаемые команды и результаты.

## 6. Settings overlay

| Контрол | Действие | State | Keyboard / focus | Evidence | Итог |
|---|---|---|---|---|---|
| Dialog root | Контейнер OMP settings | `role=dialog`, `aria-modal` | Получает focus при открытии | BQA/UT settings focus | PASS |
| «Закрыть настройки» | Закрывает modal | — | Native button; focus restoration | BQA sidebar/composer focus; UT | PASS |
| Settings tabs | Меняют раздел | `role=tab`, `aria-selected`, roving `tabIndex` | Pointer; ArrowLeft/Right; Home/End; focus переходит на активный tab | BQA `settings tabs support roving arrow focus`; UT | PASS |
| Settings rows | Выбирают строку; boolean row реально переключается | Selected styling; boolean получает `aria-pressed` | Pointer; ArrowUp/Down перемещают focus; Enter/Space toggles boolean | BQA initial/toggle/arrow focus; UT | PASS |
| Root keyboard navigation | Навигация без Tab по terminal-style grid | Selected row/tab | Arrow keys, Enter/Space, Escape | BQA initial settings keyboard; UT | PASS |
| Plugin empty state | Не имитирует кнопку установки | Static explanatory text | — | Visual/source review | PASS |

Исправленный дефект: раньше settings row выглядела как кнопка, но mouse click только выделял boolean row и не менял значение. Теперь pointer и keyboard выполняют одинаковое действие; tabs/rows используют roving focus.

## 7. Command palette

| Контрол | Действие | State | Keyboard / focus | Evidence | Итог |
|---|---|---|---|---|---|
| Filter input | Фильтрует команды | Empty state «Команды не найдены» | AutoFocus; ArrowUp/Down/Enter/Escape обрабатываются modal | BQA empty search; UT filter | PASS |
| Command options | Выполняют route | `role=option`, `aria-selected`; hover обновляет selection | Pointer/hover или Enter | BQA hover + mouse route + keyboard MCP; UT | PASS |
| Escape | Закрывает palette | — | Focus возвращается на command trigger/composer | BQA/UT focus restoration | PASS |

## 8. Capability pages и dialogs

| Страница / контрол | Действие | State | Keyboard / focus | Evidence | Итог |
|---|---|---|---|---|---|
| Accounts search | Фильтрует providers, показывает empty state | Controlled input | Native input | BQA account search | PASS |
| Accounts provider rows | Выбирают provider и показывают безопасный notice | `aria-pressed` для текущего | Native button | BQA visible feedback | PASS |
| MCP «Добавить сервер» | Намеренно не делает ничего до OMP integration | Реальный disabled + tooltip | Не активируется | BQA MCP disabled | PASS |
| Skills search | Фильтрует catalog | Controlled input | Native input | BQA Skills route/search | PASS |
| Skill rows | Меняют detail pane | Selected styling | Native button | BQA react skill selection | PASS |
| Install / Reinstall | Открывает dry-run dialog | — | Native button; dialog получает focus | BQA install focus | PASS |
| Install scope user/project | Меняет command preview | `aria-pressed`; project disabled без path | Native button | BQA project scope enabled/command preview | PASS |
| Install cancel | Закрывает dialog без async action | — | Button/Escape; focus на install trigger | BQA cancel/focus | PASS |
| «Проверить установку» | Выполняет только `dryRun: true` | Disabled while busy; result toast после close | Native button; guard от повторного клика | BQA install dry-run result | PASS |
| Tools / Memory | Read-only capability status | Нет ложных controls | Escape возвращает chat | BQA slash routes | PASS |
| Usage / Changelog preview | Честный preview surface | Нет ложных controls | Escape возвращает chat | BQA routes | PASS |
| App diagnostics copy | Копирует redacted diagnostics и показывает notice | Async feedback | Native button | BQA standalone diagnostics | PASS |
| `ProjectsPage` toolbar/project rows | Вызывают chooser | Exported preview component, не mounted shell route | Native buttons | BQA standalone source harness | PASS |
| `ModelsPage` provider/model/search | Фильтруют и меняют selected detail | Exported preview component, не mounted shell route | Native inputs/buttons | BQA standalone source harness | PASS |

`ProjectsPage`, `ModelsPage` и `AppSettingsPage` сейчас экспортируются как preview components, но shell не монтирует их отдельным navigation menu. Они всё равно исполнены в source-level React harness браузерного QA, чтобы handlers не остались непроверенными.

## 9. Race, cleanup и state-consistency checks

| Риск | Проверка | Результат |
|---|---|---|
| Double submit / повторный click во время run | Composer и Send disabled; `activeControllerRef` guard | PASS |
| «Отмена» только скрывает spinner | Реальный `AbortController`, signal-aware wait, timer cleanup, no late updates | PASS |
| Retry создаёт дубликат transcript | Тот же ActivityRun ID, attempt+1, одна final assistant recap | PASS |
| Быстрый slash ArrowDown → Enter выбирает старый index | Selection reset синхронен, тест воспроизводит race | PASS |
| Model/thinking listbox теряет focus | Focus переносится в listbox и возвращается на trigger | PASS |
| Закрытие Inspector затем открытие modal крадёт focus | Deferred focus не выполняется при active modal | PASS |
| Install dialog не получает focus | Исправлено на explicit ref + `useLayoutEffect` | PASS |
| Settings click выглядит активным, но ничего не делает | Boolean rows теперь toggled и имеют `aria-pressed` | PASS |
| Autoscroll мешает читать историю | Near-bottom threshold + «К новым событиям» | PASS |
| Long command/path ломает layout | Wrapping + overflow checks на 760/1024/1920 | PASS |
| Screen reader получает шум каждую секунду | Один polite live-region для существенного статуса | PASS |
| Reduced motion | Activity transitions становятся `0s` | PASS |

## Итог

- Browser interaction audit: **101 passed, 0 failed**.
- Core behavior verification: **10 passed, 0 failed**.
- Fallback semantic scopes: **3 passed, 0 failed**.
- Console/page errors и unhandled rejections в browser scenarios: **0**.
- Все реально rendered clickable controls либо выполняют наблюдаемое действие, либо честно disabled с причиной.
