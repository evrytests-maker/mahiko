# GUI control matrix

Status date: 2026-08-08. Paths below start in the root production renderer, never in immutable `frontend/`.

| Control / stable label | Real action and path | Error, disabled or cancel path | Evidence | Status |
|---|---|---|---|---|
| `Сообщение mahiko`, Enter | `App.submit → preload agent.run → IPC agent:run → OmpService.runAgent → OMP prompt`; stream events feed `ActivityStream` | Blank/working input blocked; sanitized RPC error is rendered | `App.test.tsx`; live GUI fixed-phrase check | Working |
| Provider-visible thinking | OMP `thinking_start/delta/end` → normalized IPC stream → separate `ActivityStream` blocks | Only readable provider output is shown; signatures/encrypted reasoning are ignored; final answer remains separate | service, activity and ActivityStream tests | Working |
| Activity `Остановить`, global Esc | `App.stopRun → agent.cancel → OmpRpcClient.abort` | Acknowledged abort settles even without `agent_end`; late success is ignored; next run is allowed | RPC regression + App tests; live cancel/restart check | Working |
| Activity `Повторить` | Reuses the selected run's original prompt through `submit` | Disabled while another run is active | `ActivityStream.test.tsx`, `App.test.tsx` | Working |
| Activity `Копировать` | Browser Clipboard API copies observed activity details | Button reports copied state; unavailable clipboard does not invent output | `ActivityStream.test.tsx` | Working |
| Activity details / `ещё` | Local expand/collapse of real stream/tool rows | Empty detail groups are omitted | `ActivityStream.test.tsx` | Working |
| Model picker / `/models` | `omp.getModels`, then `omp.setModel(provider,id)` | Offline state disables RPC operation and renders error | `OmpChrome.test.tsx`, `App.test.tsx` | Working |
| Reasoning picker | `omp.setThinkingLevel(level)` | Unsupported/offline call reports actual IPC error | `OmpChrome.test.tsx` | Working |
| Context / auto-compaction | `omp.setAutoCompaction(enabled)` | Busy state disables repeated changes | `OmpChrome.test.tsx` | Working |
| `Сжать сейчас`, `/compact` | `omp.compact()` | Disabled without ready RPC; actual error is shown | `OmpChrome.test.tsx`, `App.test.tsx` | Working |
| OMP status / refresh | `runtime.refresh → OmpService.reset → exact version/readiness probe` | Version mismatch is fail-closed; no agent prompt during probe | runtime/service tests; `check:omp` | Working |
| Project button / folder chooser | `project.choose → Electron dialog → SettingsStore`; reloads real file list | Cancel returns `null` and preserves the current project | project file/App tests | Working |
| `Проекты`, `/session` | Opens floating Projects page with observed root, counts and entries | Empty project shows an honest empty state | `Pages.test.tsx`, App tests | Working |
| Project file rows | `project.readFile` confines path to selected root and opens a file window | Traversal, missing/non-file and oversized preview paths are rejected/truncated | `project-files.test.ts` | Working |
| Floating window move/maximize/resize/close | Local window manager state; pointer and keyboard support | Bounds are clamped; Escape closes the top surface | renderer interaction tests and GUI smoke | Working |
| Environment sidebar | Opens/closes real navigation; Escape and outside click restore focus | No hidden backend mutation | App/overlay tests and GUI smoke | Working |
| `Изменения`, `/MCP`, `Скиллы`, `Субагенты` | No supported OMP RPC 17.2.9 mutation contract | Visibly disabled with a reason/title | App tests and GUI smoke | Disabled honestly |
| Settings `Вид` and theme buttons | `settings.update({theme}) → SettingsStore` | Other settings tabs are disabled because no safe write contract exists | `Overlays.test.tsx`, App tests | Working / scoped |
| Command palette / slash menu | Filters real command map; Enter dispatches the selected command | Empty results shown; Escape closes and restores focus | overlay/chrome tests | Working |
| Workbench Terminal | `terminal.run → IPC → bounded shell` in selected project | Blank/>4096 rejected, output capped at 1 MiB, timeout 120 s, stderr/exit shown | App GUI smoke and IPC implementation | Working |
| Workbench Browser | Preload browser API → Electron `WebContentsView`; navigate/back/forward/reload | Navigation failures shown; view hidden while overlays cover it | component implementation and GUI smoke | Working |
| Workbench Files | Observed project list; click uses the same confined `project.readFile` path | Honest empty state | App GUI smoke | Working |
| Workbench width/tabs/close | Local pointer/keyboard resize and tab state | Width clamped to 360–720 px; Escape closes | component tests/manual GUI | Working |
| Provider list | `omp.getLoginProviders → OMP get_login_providers` | Offline/unavailable provider disables login; empty list is explicit | `OmpPanels.test.tsx` | Working |
| `Подключить / регистрация` | `omp.login(providerId) → OMP login`; HTTPS `open_url` is opened by Electron; provider status is refreshed | Busy provider disables duplicate login; user completes password/CAPTCHA; failure is shown verbatim after sanitization | `OmpPanels.test.tsx`; live completion pending selected account | Working; external confirmation required |
| Account pool add/edit/delete | Local draft loaded from `omp.getAccountPool()` | No seeded identities; blank rows ignored; duplicate providers rejected | `OmpPanels.test.tsx` | Working |
| `Сохранить пул` | `omp.setAccountPool → atomic 0600 JSON → dispose active RPC client` | Write/validation errors shown; restart requirement displayed | service implementation + `OmpPanels.test.tsx` | Working |
| Custom API form | `omp.saveCustomProvider → validated OMP config + model selector verification` | Rollback on failed verification; API key password field is never echoed in status | service tests + `OmpPanels.test.tsx` | Working |
| Extension UI select/input/editor/confirm | OMP UI event → `OmpUiDialog` → `omp.respondUi` | Cancel sends explicit cancellation; focus is trapped/restored | `OmpUiDialog.test.tsx` | Working |
| Extension UI `open_url`/notice | OMP HTTPS URL → main-process `shell.openExternal`; renderer shows dismissible notice | Non-HTTPS URL is not opened; failures remain observed | OMP client/service tests | Working |
| Setup `Пропустить`, `Готово`, close/Escape | Close locally; `Готово` persists onboarding completion | Does not claim provider authentication or pool save | panel/App tests | Working |
| New-events button / scroll | Scrolls transcript to observed unseen activity | Hidden when already at bottom/no unseen events | App tests/manual GUI | Working |

Intentional handoff deviation: the duplicate lower `Working… [Esc]` button was removed at the user's request because it looked poor. Cancellation remains visible and operable in the active Activity card through `Остановить · Esc`, including global Escape and screen-reader status.

Manual auth boundary: the GUI starts and observes registration, but credentials, CAPTCHA, MFA and provider consent remain in the provider-controlled browser page. This is an intentional security boundary, not an unimplemented button.
