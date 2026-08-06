import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type JSX } from "react";
import type { AppSettings, DiagnosticReport, OperationResult, RuntimeSnapshot } from "../../shared/contracts";
import { api, isElectron } from "../api";
import { modelRows, providerRows } from "../data";
import { TerminalSection } from "./OmpChrome";

export function ProjectsPage({ settings, onChoose }: { settings: AppSettings | null; onChoose(): void }): JSX.Element {
  const projects = settings?.recentProjects.length ? settings.recentProjects : [settings?.projectPath].filter(Boolean) as string[];
  return (
    <PageFrame title="Проекты" help="Tab — выбрать · Enter — открыть">
      <div className="page-toolbar"><span className="accent">▣</span> Недавние проекты <button className="text-action" onClick={onChoose}>+ Открыть проект</button></div>
      <div className="selector-list project-list">
        {(projects.length ? projects : ["Нет открытых проектов"]).map((path, index) => (
          <button key={path} className={index === 0 ? "selected" : ""} onClick={onChoose}>
            <span>{index === 0 ? "❯" : " "} {path === "Нет открытых проектов" ? "○" : "▣"}</span>
            <span className="selector-main">{path.split("/").filter(Boolean).pop()}</span>
            <span className="dim selector-detail">{path}</span>
            <span>{index === 0 ? "█" : "│"}</span>
          </button>
        ))}
      </div>
    </PageFrame>
  );
}

export function ModelsPage(): JSX.Element {
  const [provider, setProvider] = useState("Все модели");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const providers = [["Все модели", "90"], ["a6api", "67"], ["google-antigravity", "17"], ["llama.cpp", "0"], ["lm-studio", "0"], ["ollama", "0"], ["openai-codex", "6"]] as const;
  const visible = modelRows.filter(([rowProvider, model]) =>
    (provider === "Все модели" || rowProvider === provider) && `${rowProvider}/${model}`.toLowerCase().includes(query.toLowerCase()));
  const current = visible[selected] ?? visible[0];

  return (
    <PageFrame title="Модели" className="models-page" help="Tab — выбрать · Enter — назначить · Esc — вернуться в чат">
      <div className="models-grid">
        <div className="provider-pane">
          <div className="pane-heading"><span>✦ Роли</span><span className="dim">8/10</span></div>
          {providers.map(([name, count]) => (
            <button key={name} className={name === provider ? "selected" : ""} onClick={() => { setProvider(name); setSelected(0); }}>
              <span>{name === provider ? "❯" : " "} <i className={Number(count) ? "success" : "dim"}>{name === "Все модели" ? "⬢" : Number(count) ? "●" : "○"}</i> {name}</span>
              <span className="dim">{count}</span>
            </button>
          ))}
        </div>
        <div className="model-pane">
          <div className="pane-heading"><span className="muted">Доступные модели</span></div>
          <label className="inline-search"><span className="accent">⌕</span> &gt;<input name="model-search" autoComplete="off" aria-label="Поиск моделей" value={query} onChange={(event: ChangeEvent<HTMLInputElement>) => { setQuery(event.target.value); setSelected(0); }} /></label>
          <div className="model-rows">
            {visible.map(([rowProvider, model, context, price], index) => (
              <button key={`${rowProvider}/${model}`} className={index === selected ? "selected" : ""} onClick={() => setSelected(index)}>
                <span><span className="dim">{rowProvider}/</span>{model}</span><span className="dim">{context}</span><span className="dim">{price}</span><span>{index === selected ? "█" : "│"}</span>
              </button>
            ))}
          </div>
          {current ? (
            <div className="model-detail">
              <div>{current[1]} · контекст {current[2]} · {current[3]} за 1M токенов</div>
              <div><span className="success">●основная</span> <span className="dim">◕</span> · <span className="dim">○дизайнер ◕</span></div>
            </div>
          ) : <div className="empty-line">Подходящие модели не найдены</div>}
        </div>
      </div>
    </PageFrame>
  );
}

export function AccountsPage(): JSX.Element {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [notice, setNotice] = useState("");
  const rows = providerRows.filter(([name]) => name.toLowerCase().includes(query.toLowerCase()));
  const chooseProvider = (index: number) => {
    setSelected(index);
    const provider = rows[index]?.[0];
    if (provider) setNotice(`${provider} выбран. Авторизация будет передана локальному OMP после подключения.`);
  };
  return (
    <PageFrame title="Аккаунты" help="Tab — выбрать · Enter — подготовить вход · Esc — вернуться в чат">
      <div className="inline-title">Выберите провайдера для входа:</div>
      <div className="selector-list account-list">
        {rows.map(([name, state, kind], index) => (
          <button type="button" key={name} className={index === selected ? "selected" : ""} aria-pressed={index === selected} onClick={() => chooseProvider(index)}>
            <span>{index === selected ? "❯" : " "} {name}</span>
            <span>{state ? <><i className="success">● {state}</i> <i className="dim">({kind})</i></> : <i className="dim">не настроен</i>}</span>
            <span>{index === selected ? "█" : "│"}</span>
          </button>
        ))}
        {!rows.length ? <p className="empty-line">Провайдеры не найдены</p> : null}
      </div>
      <label className="type-search"><span className="dim">Начните вводить название</span><input name="provider-search" autoComplete="off" value={query} onChange={(event: ChangeEvent<HTMLInputElement>) => { setQuery(event.target.value); setSelected(0); setNotice(""); }} aria-label="Поиск провайдеров" /></label>
      {notice ? <p className="toast-line" aria-live="polite">{notice}</p> : null}
    </PageFrame>
  );
}

export function McpPage(): JSX.Element {
  return (
    <PageFrame title="/MCP" help="Статус доступен только для чтения · Esc — вернуться в чат">
      <div className="page-toolbar"><span className="accent">⌘</span> Подключения /MCP <button type="button" className="text-action" disabled title="Добавление сервера станет доступно после подключения OMP">+ Добавить сервер</button></div>
      <McpGroup title="Claude Code" source="~/.claude.json" rows={[["codebase-memory-mcp", "14 tools"], ["codegraph", "1 tool"]]} />
      <McpGroup title="OpenAI Codex" source="~/.codex/config.toml" rows={[["node_repl", "2 tools"], ["openaiDeveloperDocs", "5 tools"]]} />
      <section className="permission-preview">
        <div className="inner-rule" />
        <div className="terminal-section-title">Разрешения выбранного сервера</div>
        <div><span className="success">●</span><span>Инструменты</span><span className="dim">доступно: 14</span></div>
        <div><span className="success">●</span><span>Файлы</span><span className="dim">только проект</span></div>
        <div><span className="warning">●</span><span>Сеть</span><span className="dim">управляет сервер</span></div>
      </section>
    </PageFrame>
  );
}

function McpGroup({ title, source, rows }: { title: string; source: string; rows: string[][] }): JSX.Element {
  return (
    <section className="mcp-group">
      <h3>{title} <span className="muted">({source}):</span></h3>
      {rows.map(([name, tools], index) => <div key={name} className={`mcp-row${index === 0 ? " selected" : ""}`}><span>{index === 0 ? "❯" : " "} <i className="accent">{name}</i></span><span className="success">● подключён</span><span className="dim">({tools?.replace("tools", "инструментов").replace("tool", "инструмент") ?? "0 инструментов"})</span><span>{index === 0 ? "█" : "│"}</span></div>)}
    </section>
  );
}

const skills = [
  ["find-skills", "Поиск и установка повторно используемых навыков", "vercel-labs/skills", "installed"],
  ["frontend-design", "Целенаправленная визуальная система интерфейса", "локальный", "installed"],
  ["systematic-debugging", "Диагностика ошибок на основе фактов", "локальный", "installed"],
  ["react-best-practices", "Производительные паттерны React и Next.js", "vercel", "available"],
  ["pdf", "Чтение, создание и проверка PDF", "openai", "available"],
] as const;

export function SkillsPage({ projectPath }: { projectPath: string }): JSX.Element {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [installing, setInstalling] = useState(false);
  const [result, setResult] = useState<OperationResult | null>(null);
  const catalogRef = useRef<HTMLDivElement>(null);
  const visible = skills.filter(([name, description]) => `${name} ${description}`.toLowerCase().includes(query.toLowerCase()));
  const current = visible[selected] ?? visible[0];

  useEffect(() => {
    if (!isElectron || !catalogRef.current) return;
    const element = catalogRef.current;
    const update = () => {
      const bounds = element.getBoundingClientRect();
      void api.marketplace.setBounds({ visible: true, x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height });
    };
    update();
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("resize", update);
      void api.marketplace.setBounds({ visible: false, x: 0, y: 0, width: 40, height: 40 });
    };
  }, []);

  return (
    <PageFrame title="Скиллы" className="skills-page" help="Enter — сведения · i — установить · Tab — каталог · Esc — закрыть">
      <div className="skills-grid">
        <div className="skill-list-pane">
          <div className="pane-heading"><span>✦ Установленные + каталог</span><span className="dim">показано: 5</span></div>
          <label className="inline-search"><span className="accent">⌕</span> &gt;<input name="skill-search" autoComplete="off" aria-label="Поиск навыков" value={query} onChange={(event: ChangeEvent<HTMLInputElement>) => { setQuery(event.target.value); setSelected(0); }} /></label>
          {visible.map(([name, description, source, state], index) => (
            <button key={name} className={index === selected ? "selected skill-row" : "skill-row"} onClick={() => setSelected(index)}>
              <span>{index === selected ? "❯" : " "} <i className={state === "installed" ? "success" : "accent"}>{state === "installed" ? "●" : "✦"}</i> {name}</span>
              <span className="dim">{description}</span>
              <span className="muted">{source}</span>
              <span>{index === selected ? "█" : "│"}</span>
            </button>
          ))}
        </div>
        <div className="skill-detail-pane">
          {current ? <>
            <div className="pane-heading"><span>{current[0]}</span><span className={current[3] === "installed" ? "success" : "accent"}>● {current[3] === "installed" ? "установлен" : "доступен"}</span></div>
            <p>{current[1]}</p>
            <dl className="terminal-dl"><dt>Источник</dt><dd>{current[2]}</dd><dt>Область</dt><dd>{current[3] === "installed" ? "пользователь" : "не установлен"}</dd><dt>Формат</dt><dd>SKILL.md</dd><dt>Активация</dt><dd>автоматическая + явная</dd></dl>
            <button className="terminal-action" onClick={() => setInstalling(true)}>{current[3] === "installed" ? "↻ Переустановить…" : "↓ Установить…"}</button>
          </> : null}
          <div ref={catalogRef} className="catalog-host">
            {!isElectron ? <><div className="terminal-section-title">Каталог AgenticSkills</div><div className="catalog-placeholder"><span className="accent">↗</span> В Electron здесь открывается изолированный веб-каталог</div></> : null}
          </div>
        </div>
      </div>
      {installing && current ? <InstallDialog slug={current[0]} projectPath={projectPath} onClose={() => setInstalling(false)} onResult={setResult} /> : null}
      {result ? <div className={`toast-line ${result.ok ? "success" : "error"}`}>{result.ok ? "✓" : "×"} {result.message}</div> : null}
    </PageFrame>
  );
}

function InstallDialog({ slug, projectPath, onClose, onResult }: { slug: string; projectPath: string; onClose(): void; onResult(result: OperationResult): void }): JSX.Element {
  const [scope, setScope] = useState<"user" | "project">("user");
  const [busy, setBusy] = useState(false);
  const previousFocus = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const dialogRef = useRef<HTMLElement>(null);
  const command = `npx --yes skills add ${slug}${scope === "user" ? " -g" : ""}`;

  useLayoutEffect(() => { dialogRef.current?.focus(); }, []);

  useEffect(() => {
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      const target = previousFocus.current;
      window.requestAnimationFrame(() => { if (target?.isConnected) target.focus(); });
    };
  }, [onClose]);

  const install = async () => {
    if (busy || (scope === "project" && !projectPath)) return;
    setBusy(true);
    try {
      onResult(await api.skills.install({ slug, scope, projectPath, dryRun: true }));
    } catch (error) {
      onResult({ ok: false, message: error instanceof Error ? error.message : "Не удалось проверить установку" });
    } finally {
      setBusy(false);
      onClose();
    }
  };
  return (
    <div className="dialog-backdrop">
      <section ref={dialogRef} className="terminal-frame install-dialog" role="dialog" aria-modal="true" aria-label={`Установка ${slug}`} tabIndex={-1}>
        <div className="frame-title">Установка «{slug}»</div>
        <div className="dialog-content">
          <div className="settings-section">Область установки</div>
          <button type="button" className={scope === "user" ? "radio-row selected" : "radio-row"} aria-pressed={scope === "user"} onClick={() => setScope("user")}><span>{scope === "user" ? "◉" : "○"} Пользователь</span><span className="dim">доступно во всех проектах</span></button>
          <button type="button" className={scope === "project" ? "radio-row selected" : "radio-row"} aria-pressed={scope === "project"} onClick={() => setScope("project")} disabled={!projectPath} title={!projectPath ? "Сначала выберите проект" : undefined}><span>{scope === "project" ? "◉" : "○"} Проект</span><span className="dim">{projectPath || "сначала выберите проект"}</span></button>
          <div className="settings-section">Предпросмотр команды</div>
          <pre className="command-preview">$ {command}</pre>
          <div className="settings-section">Разрешения</div>
          <p><span className="success">●</span> Чтение файлов навыка</p><p><span className="warning">●</span> Запись в выбранную область</p><p><span className="dim">○</span> Без доступа к учётным данным</p>
        </div>
        <div className="dialog-actions"><button type="button" onClick={onClose}>Отмена</button><button type="button" className="primary" onClick={() => void install()} disabled={busy || (scope === "project" && !projectPath)}>{busy ? "Проверка…" : "Проверить установку"}</button></div>
      </section>
    </div>
  );
}

export function ToolsPage(): JSX.Element {
  const toolGroups = [
    ["Файлы", [["read", "enabled"], ["edit", "enabled"], ["write", "enabled"], ["glob", "enabled"], ["grep", "enabled"]]],
    ["Выполнение", [["bash", "enabled"], ["eval", "enabled"], ["debug", "enabled"], ["task", "enabled"]]],
    ["Внешние", [["browser", "available"], ["web_search", "enabled"], ["github", "enabled"], ["computer", "disabled"]]],
  ] as const;
  return <PageFrame title="Инструменты" help="Состояния доступны только для чтения · Esc — вернуться в чат"><div className="tools-grid">{toolGroups.map(([group, rows]) => <TerminalSection key={group} title={group}>{rows.map(([name, state]) => <div className="tool-row" key={name}><span className={state === "enabled" ? "success" : state === "disabled" ? "dim" : "accent"}>{state === "enabled" ? "●" : "○"}</span><span>{name}</span><span className="dim">{state === "enabled" ? "включён" : state === "disabled" ? "выключен" : "доступен"}</span></div>)}</TerminalSection>)}</div></PageFrame>;
}

export function MemoryPage(): JSX.Element {
  return <PageFrame title="Память" help="Настройка появится после подключения OMP · Esc — вернуться в чат"><div className="memory-empty"><div className="big-glyph">◆</div><h3>Хранилище памяти: выключено</h3><p className="muted">Доступны локальные сводки, Mnemopi SQLite или удалённая память Hindsight</p><div className="inner-rule"/><p><span className="dim">Автообучение (эксперимент)</span> <span>нет</span></p><p><span className="dim">Сохранено записей</span> <span>0</span></p></div></PageFrame>;
}

export function AppSettingsPage({ runtime, settings }: { runtime: RuntimeSnapshot | null; settings: AppSettings | null }): JSX.Element {
  const [diagnostics, setDiagnostics] = useState<DiagnosticReport | null>(null);
  const [copyState, setCopyState] = useState("");
  useEffect(() => { void api.diagnostics.get().then(setDiagnostics); }, []);
  const rows = useMemo(() => [
    ["Исполняемый файл OMP", runtime?.executable ?? "не найден", runtime?.available],
    ["Версия OMP", runtime?.version ?? "неизвестна", runtime?.available],
    ["Протокол RPC", runtime?.rpc.ready ? `v${runtime.rpc.protocolVersion}` : runtime?.rpc.detail ?? "проверка", runtime?.rpc.ready],
    ["Изоляция Renderer / Main", "contextIsolation + sandbox", true],
    ["Интеграция Node", "выключена", true],
    ["Рекурсивная очистка", "включена", true],
    ["Шлюз", "Безопасный предпросмотр", true],
  ] as const, [runtime]);
  const copy = async () => { const result = await api.diagnostics.copy(); setCopyState(result.message); };
  return (
    <PageFrame title="Настройки приложения" help="Копирование доступно кнопкой · Esc — вернуться в чат">
      <div className="diagnostic-grid">
        <section><div className="pane-heading"><span>Диагностика</span><span className="dim">{diagnostics?.generatedAt.slice(11, 19) ?? "загрузка"}</span></div>{rows.map(([label, value, ok], index) => <div key={label} className={index === 0 ? "selected diagnostic-row" : "diagnostic-row"}><span>{index === 0 ? "❯" : " "} {label}</span><span className={ok ? "success" : "warning"}>{value}</span><span>{index === 0 ? "█" : "│"}</span></div>)}<button className="terminal-action copy-action" onClick={copy}>▣ Копировать очищенную диагностику</button>{copyState ? <p className="success" aria-live="polite">✓ {copyState}</p> : null}</section>
        <section><div className="pane-heading"><span>Состояние приложения</span></div><dl className="terminal-dl"><dt>Тема</dt><dd>Titanium / OMP</dd><dt>Проект</dt><dd>{settings?.projectPath || "нет"}</dd><dt>Навигация</dt><dd>{settings?.navVisible ? "видна" : "скрыта"}</dd><dt>Инспектор</dt><dd>{settings?.inspectorVisible ? "виден" : "скрыт"}</dd><dt>Каталог навыков</dt><dd>изолированный раздел</dd><dt>Сырые данные RPC</dt><dd>не передаются в renderer</dd></dl></section>
      </div>
    </PageFrame>
  );
}

export function PageFrame({ title, help, children, className = "" }: { title: string; help: string; children: React.ReactNode; className?: string }): JSX.Element {
  return (
    <section className={`terminal-frame page-frame ${className}`}>
      <h1 className="frame-title">{title}</h1>
      <div className="page-content">{children}</div>
      <div className="overlay-help">{help}</div>
    </section>
  );
}
