import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type JSX, type KeyboardEvent } from "react";
import { settingsRows, settingsTabs, slashCommands } from "../data";
import { StatusSegments } from "./OmpChrome";

const settingLabels: Record<string, string> = {
  Theme: "Тема", "Dark Theme": "Тёмная тема", "Light Theme": "Светлая тема", "Symbol Preset": "Набор символов", "Color-Blind Mode": "Режим для дальтонизма",
  "Status Line": "Строка состояния", "Status Line Preset": "Профиль строки", "Status Line Separator": "Разделитель", "Session Accent": "Акцент сессии", "Transparent Status Line": "Прозрачный фон", "Compact Thinking Level": "Краткий уровень рассуждения",
  Thinking: "Рассуждение", "Thinking Level": "Глубина рассуждения", "Hide Thinking Blocks": "Скрывать блоки рассуждения", "Prose Only Thinking": "Только текст рассуждения", "Omit Thinking summaries": "Скрывать сводки рассуждения", "Loop Guard": "Защита от циклов", "Loop Guard Scan Prose": "Проверять циклы в тексте", "Loop Guard Tool-Call Reminder": "Напоминать об инструментах", "Tool-Call Loop Guard": "Защита от циклов инструментов", "Auto Thinking Model": "Автовыбор модели", "Auto Thinking Ceiling": "Предел рассуждения",
  Sampling: "Сэмплирование", Temperature: "Температура", "Top P": "Top P",
  Input: "Ввод", "Steering Mode": "Режим управления", "Follow-Up Mode": "Режим продолжений", "Interrupt Mode": "Режим прерывания", "Loop Mode": "Режим цикла", "Double-Escape Action": "Двойной Escape", "Session Tree Filter": "Фильтр дерева сессий", "Autocomplete Items": "Строки автодополнения", "Emoji Autocomplete": "Автодополнение эмодзи", "Large Paste Menu": "Меню большой вставки",
  Approvals: "Подтверждения", "Tool Approval Policies": "Политики инструментов", "Tool Approval": "Подтверждение инструментов",
  General: "Основное", "Auto-Promote Context": "Расширять контекст автоматически", "Branch Summaries": "Сводки веток",
  Compaction: "Сжатие", "Auto-Compact": "Автосжатие", "Mid-Turn Compaction": "Сжатие во время ответа", "Compaction Strategy": "Стратегия сжатия", "Compaction Threshold": "Порог сжатия", "Compaction Token Limit": "Лимит токенов сжатия", "Save Handoff Docs": "Сохранять документы передачи", "Remote Compaction": "Удалённое сжатие", "Remote Compaction V2": "Удалённое сжатие V2", "Idle Compaction": "Сжатие в простое", "Idle Compaction Threshold": "Порог сжатия в простое",
  "Memory Backend": "Хранилище памяти", "Auto-Learn": "Автообучение", "Auto-Learn (experimental)": "Автообучение (эксперимент)",
  Editing: "Редактирование", "Edit Mode": "Режим правки", "Fuzzy Match": "Нечёткое совпадение", "Fuzzy Match Threshold": "Порог совпадения", "Abort on Failed Preview": "Прерывать при ошибке предпросмотра", "Block Auto-Generated Files": "Защищать сгенерированные файлы", "Enforce Seen-Line Guard": "Править только прочитанные строки",
  Reading: "Чтение", "Line Numbers": "Номера строк", "Default Read Limit": "Лимит чтения", "Markdown Previews": "Предпросмотр Markdown", "Inline Read Previews": "Встроенный предпросмотр", "Read Summaries": "Сводки чтения",
  Bash: "Bash", "Bash Auto-Background": "Bash в фоне", "Bash Interceptor": "Перехватчик Bash", "direnv Auto-Load": "Автозагрузка direnv", "Shell Minimizer": "Сокращение вывода", "Shell Minimizer Source Outline": "Контур исходного вывода", "Eval & Runtimes": "Среды выполнения", "Python Eval Backend": "Среда Python", "JavaScript Eval Backend": "Среда JavaScript", "Ruby Eval Backend": "Среда Ruby", "Julia Eval Backend": "Среда Julia", "Python Kernel Mode": "Режим Python-ядра",
  "Available Tools": "Доступные инструменты", "Inspect Image": "Просмотр изображений",
  Modes: "Режимы", "Plan Mode": "Режим плана", "Start in Plan Mode": "Начинать с плана", "Goal Mode": "Режим цели", "Goal Status in Footer": "Статус цели внизу", "Refresh Title on Replan": "Обновлять заголовок при перепланировании",
  Subagents: "Субагенты", "Prefer Task Delegation": "Делегирование задач", "Batch Task Calls": "Параллельные задачи", "Per-Task Effort": "Усилие для каждой задачи", "Max Concurrent Tasks": "Одновременных задач", "LSP in Subagents": "LSP у субагентов", "Max Task Recursion": "Глубина делегирования", "Max Subagent Runtime": "Время работы субагента",
  Services: "Сервисы", "Max In-Flight Requests": "Одновременных запросов", "Web Search Provider Order": "Порядок веб-поиска", "Excluded Web Search Providers": "Исключённые поисковые провайдеры", "Web Search Timeout": "Тайм-аут поиска", "Gemini web_search model": "Модель веб-поиска Gemini", "Antigravity Endpoint Mode": "Режим Antigravity", "Image Provider Order": "Порядок генерации изображений", "Live Voice": "Голос в реальном времени", "Text-to-Speech Provider": "Провайдер синтеза речи", "Local TTS Model": "Локальная модель речи", "Local TTS Voice": "Локальный голос", "Speech Vocalization": "Озвучивание ответов", "Speech Vocalization Mode": "Режим озвучивания",
};

const localizeSetting = (value?: string): string => value ? settingLabels[value] ?? value : "";

function useRestoreFocus(fallbackSelector: string): void {
  const previousFocus = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  useEffect(() => () => {
    const target = previousFocus.current?.isConnected ? previousFocus.current : document.querySelector<HTMLElement>(fallbackSelector);
    window.requestAnimationFrame(() => target?.focus());
  }, [fallbackSelector]);
}

export function SettingsOverlay({ onClose }: { onClose(): void }): JSX.Element {
  useRestoreFocus('#environment-trigger, [aria-label="Сообщение ma-hi-ko"]');
  const rootRef = useRef<HTMLDivElement>(null);
  const [tabIndex, setTabIndex] = useState(0);
  const [selectedRow, setSelectedRow] = useState(0);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const activeTab = settingsTabs[tabIndex]?.[0] ?? "Appearance";
  const activeTabIcon = settingsTabs[tabIndex]?.[1] ?? "◫";
  const activeTabLabel = settingsTabs[tabIndex]?.[2] ?? "Интерфейс";
  const rows = settingsRows[activeTab] ?? [];
  const selectable = rows.filter((row) => row.label);
  const selected = selectable[selectedRow] ?? selectable[0];
  const selectedKey = selected?.label ? `${activeTab}:${selected.label}` : "";
  const selectedValue = selectedKey ? overrides[selectedKey] ?? selected?.value ?? "—" : "—";

  const changeRow = (rowIndex: number) => {
    const row = selectable[rowIndex];
    if (!row?.label) return;
    const key = `${activeTab}:${row.label}`;
    const value = overrides[key] ?? row.value ?? "—";
    if (!["true", "false"].includes(value)) return;
    setOverrides((current) => ({ ...current, [key]: value === "true" ? "false" : "true" }));
  };

  const changeSelected = () => changeRow(selectedRow);

  const selectTab = (index: number, focus = false) => {
    setTabIndex(index);
    setSelectedRow(0);
    if (focus) window.requestAnimationFrame(() => document.getElementById(`settings-tab-${index}`)?.focus());
  };

  const moveRowFocus = (rowIndex: number) => {
    const next = Math.max(0, Math.min(Math.max(0, selectable.length - 1), rowIndex));
    setSelectedRow(next);
    window.requestAnimationFrame(() => document.getElementById(`settings-row-${next}`)?.focus());
  };

  useLayoutEffect(() => { rootRef.current?.focus(); }, []);
  useEffect(() => {
    const listener = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      const root = document.querySelector<HTMLElement>('[role="dialog"][aria-label="Настройки OMP"]');
      if (event.target !== root) return;
      if (event.key === "ArrowRight") {
        event.preventDefault();
        setTabIndex((value) => (value + 1) % settingsTabs.length);
        setSelectedRow(0);
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setTabIndex((value) => (value - 1 + settingsTabs.length) % settingsTabs.length);
        setSelectedRow(0);
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedRow((value) => Math.min(Math.max(0, selectable.length - 1), value + 1));
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedRow((value) => Math.max(0, value - 1));
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        changeSelected();
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [onClose, selectable.length, selectedKey, selectedValue]);

  let logicalRow = -1;
  return (
    <div ref={rootRef} className="overlay-screen" role="dialog" aria-modal="true" aria-label="Настройки OMP" tabIndex={-1}>
      <section className="terminal-frame settings-frame">
        <div className="frame-title">Настройки OMP</div>
        <button type="button" className="settings-close" aria-label="Закрыть настройки" onClick={onClose}>esc ×</button>
        <div className="settings-workbench">
          <nav className="settings-tabs" role="tablist" aria-label="Разделы настроек OMP" aria-orientation="vertical">
            <div className="settings-nav-heading"><span>РАЗДЕЛЫ</span><small>OMP</small></div>
            {settingsTabs.map(([name, icon, label], index) => (
              <button
                key={name}
                type="button"
                id={`settings-tab-${index}`}
                role="tab"
                aria-selected={index === tabIndex}
                aria-controls="settings-active-panel"
                tabIndex={index === tabIndex ? 0 : -1}
                className={index === tabIndex ? "active" : ""}
                onClick={() => selectTab(index)}
                onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
                  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
                  event.preventDefault();
                  const next = event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? settingsTabs.length - 1
                      : (index + (["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : -1) + settingsTabs.length) % settingsTabs.length;
                  selectTab(next, true);
                }}
                title={label}
              >
                <span className="settings-code" aria-hidden="true">{icon}</span>
                <span className="settings-tab-label">{label}</span>
                <span className="settings-tab-arrow" aria-hidden="true">{index === tabIndex ? "›" : ""}</span>
              </button>
            ))}
          </nav>
          <section id="settings-active-panel" className="settings-panel" role="tabpanel" aria-labelledby={`settings-tab-${tabIndex}`}>
            <header className="settings-panel-header">
              <div><span>{activeTabIcon}</span><div><small>НАСТРОЙКИ OMP</small><h2>{activeTabLabel}</h2></div></div>
              <p>Изменения применяются к текущему профилю</p>
            </header>
            <div className="settings-content">
              {activeTab === "Plugins" ? <PluginEmpty /> : rows.map((row, index) => {
                if (row.section) return <div className="settings-section" key={`${row.section}-${index}`}>{localizeSetting(row.section)}</div>;
                logicalRow += 1;
                const isSelected = logicalRow === selectedRow;
                const rowIndex = logicalRow;
                return (
                  <button
                    id={`settings-row-${rowIndex}`}
                    type="button"
                    className={`setting-row${isSelected ? " selected" : ""}`}
                    key={row.label}
                    tabIndex={isSelected ? 0 : -1}
                    aria-pressed={["true", "false"].includes(overrides[`${activeTab}:${row.label}`] ?? row.value ?? "")
                      ? (overrides[`${activeTab}:${row.label}`] ?? row.value) === "true"
                      : undefined}
                    onClick={() => { setSelectedRow(rowIndex); changeRow(rowIndex); }}
                    onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
                      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                        event.preventDefault();
                        moveRowFocus(rowIndex + (event.key === "ArrowDown" ? 1 : -1));
                      } else if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedRow(rowIndex);
                        changeRow(rowIndex);
                      }
                    }}
                  >
                    <span className="row-cursor">{isSelected ? "❯" : " "}</span>
                    <span>{localizeSetting(row.label)}</span>
                    <span>{overrides[`${activeTab}:${row.label}`] ?? row.value}</span>
                    <span className={isSelected ? "scroll-thumb" : "scroll-rail"}>{isSelected ? "█" : "│"}</span>
                  </button>
                );
              })}
              {activeTab === "Appearance" ? (
                <div className="settings-preview">
                  <div className="muted">Предпросмотр строки OMP:</div>
                  <StatusSegments projectName="skills-python" runtime={null} />
                </div>
              ) : null}
            </div>
          </section>
        </div>
        <div className="setting-description">{selected?.label ? <><span>› {localizeSetting(selected.label)}</span><small>Управляет поведением OMP. Текущее значение: {selectedValue}.</small></> : ""}</div>
        <div className="overlay-help">↑/↓ строка · ←/→ раздел · Enter изменить · Esc закрыть</div>
      </section>
    </div>
  );
}

function PluginEmpty(): JSX.Element {
  return (
    <div className="plugin-empty">
      <div className="inner-rule" />
      <h3>/MCP и скиллы</h3>
      <p className="muted">Единая точка расширения OMP без отдельного раздела «Плагины».</p>
      <dl className="plugin-routing">
        <dt>/MCP</dt><dd>Серверы инструментов, транспорт и разрешения</dd>
        <dt>Скиллы</dt><dd>Повторно используемые инструкции из SKILL.md</dd>
      </dl>
      <p className="dim">Управление доступно в разделах <span className="text">/MCP</span> и <span className="text">Скиллы</span> левой панели.</p>
      <div className="inner-rule" />
    </div>
  );
}

export function CommandPalette({ onClose, onCommand }: { onClose(): void; onCommand(command: string): void }): JSX.Element {
  useRestoreFocus('[aria-label="Открыть команды"], [aria-label="Сообщение ma-hi-ko"]');
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const filtered = useMemo(() => slashCommands.filter(([command, description]) =>
    `${command} ${description}`.toLowerCase().includes(query.toLowerCase())), [query]);

  useEffect(() => {
    const listener = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelected((value) => Math.min(Math.max(0, filtered.length - 1), value + 1));
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelected((value) => Math.max(0, value - 1));
      }
      if (event.key === "Enter" && filtered[selected]) {
        event.preventDefault();
        onCommand(filtered[selected][0]);
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [filtered, onClose, onCommand, selected]);

  return (
    <div className="palette-backdrop" role="dialog" aria-modal="true" aria-label="Палитра команд">
      <section className="terminal-frame command-palette">
        <div className="frame-title">Команды</div>
        <label className="palette-search"><span>⌕ &gt;</span><input name="command-search" autoComplete="off" aria-label="Фильтр команд" autoFocus value={query} onChange={(event: ChangeEvent<HTMLInputElement>) => { setQuery(event.target.value); setSelected(0); }} /></label>
        <div className="palette-list" role="listbox">
          {filtered.map(([command, description], index) => (
            <button key={command} type="button" role="option" aria-selected={index === selected} className={index === selected ? "selected" : ""} onMouseEnter={() => setSelected(index)} onClick={() => onCommand(command)}>
              <span>{index === selected ? "❯" : " "} {command}</span><span>{description}</span><span>{index === selected ? "█" : "│"}</span>
            </button>
          ))}
          {!filtered.length ? <p className="empty-line">Команды не найдены</p> : null}
        </div>
        <div className="overlay-help">↑/↓ — выбрать · Enter — выполнить · Esc — закрыть</div>
      </section>
    </div>
  );
}
