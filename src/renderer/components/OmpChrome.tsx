import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type JSX, type KeyboardEvent } from "react";
import type { OmpModel, OmpSessionState, RuntimeSnapshot } from "../../shared/contracts";
import { slashCommands } from "../data";
import { TuiEscapeButton } from "./TuiControls";

export type ThinkingLevel = "off" | "auto" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export type ComposerOverlay = "model" | "reasoning" | "context" | null;

const THINKING_LEVELS: ReadonlyArray<{ value: ThinkingLevel; label: string; hint: string }> = [
  { value: "off", label: "off", hint: "без reasoning" },
  { value: "auto", label: "auto", hint: "OMP выбирает effort" },
  { value: "minimal", label: "minimal", hint: "минимум модели" },
  { value: "low", label: "low", hint: "низкий effort" },
  { value: "medium", label: "medium", hint: "средний effort" },
  { value: "high", label: "high", hint: "высокий effort" },
  { value: "xhigh", label: "xhigh", hint: "расширенный effort" },
  { value: "max", label: "max", hint: "верхняя ступень модели" },
];

export function TerminalSection({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return <section className="terminal-section"><div className="terminal-section-title">{title}</div><div className="terminal-section-body">{children}</div></section>;
}

export function StartupTranscript({ runtime, projectName }: { runtime: RuntimeSnapshot | null; projectName: string }): JSX.Element {
  return (
    <section className="chat-start" aria-label="Начало сессии">
      <div className="start-card">
        <div className="start-mark" aria-hidden="true">π</div>
        <h2>Чем помочь?</h2>
        <p className="start-project">{projectName}</p>
        <div className="start-shortcuts" aria-label="Быстрые команды">
          <span><kbd>/</kbd> команды</span>
          <span><kbd>@</kbd> файлы</span>
          <span><kbd>!</kbd> терминал</span>
        </div>
        <div className="start-runtime"><span className={runtime?.rpc.ready ? "success" : "dim"}>{runtime?.rpc.ready ? "● OMP" : "○ OMP"}</span></div>
      </div>
    </section>
  );
}


export interface TranscriptMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
}

export function MessageBlock({ message }: { message: TranscriptMessage }): JSX.Element {
  if (message.role === "user") return <div className="message-row user-row"><div className="user-message">{message.text}</div></div>;
  return (
    <div className="message-row assistant-row">
      <span className="assistant-mark" aria-hidden="true">π</span>
      <div className="assistant-block"><div className="assistant-message">{message.text}</div></div>
    </div>
  );
}

interface ComposerProps {
  value: string;
  onChange(value: string): void;
  onSubmit(): void;
  working: boolean;
  projectName: string;
  runtime: RuntimeSnapshot | null;
  sessionState: OmpSessionState | null;
  models: OmpModel[];
  onCommand(command: string): void;
  overlay: ComposerOverlay;
  onOverlayChange(overlay: ComposerOverlay): void;
  onSelectModel(model: OmpModel): Promise<void> | void;
  onSelectThinking(level: ThinkingLevel): Promise<void> | void;
  onToggleAutoCompact(enabled: boolean): Promise<void> | void;
  onCompactNow(): Promise<void> | void;
  onChooseProject?(): void;
  onRefreshRuntime?(): void;
}

export function Composer({ value, onChange, onSubmit, working, projectName, runtime, sessionState, models, onCommand, overlay, onOverlayChange, onSelectModel, onSelectThinking, onToggleAutoCompact, onCompactNow, onChooseProject, onRefreshRuntime }: ComposerProps): JSX.Element {
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestions = useMemo(() => value.startsWith("/")
    ? slashCommands.filter(([command, description]) => `${command} ${description}`.toLowerCase().includes(value.slice(1).toLowerCase())).slice(0, 5)
    : [], [value]);

  const chooseCommand = (command: string) => {
    onCommand(command);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };
  const run = () => {
    const suggestion = suggestions[suggestionIndex] ?? suggestions[0];
    if (value.startsWith("/") && suggestion) { chooseCommand(suggestion[0]); return; }
    onSubmit();
  };
  const submit = (event: FormEvent) => { event.preventDefault(); run(); };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (suggestions.length && event.key === "ArrowDown") { event.preventDefault(); setSuggestionIndex((current) => Math.min(suggestions.length - 1, current + 1)); return; }
    if (suggestions.length && event.key === "ArrowUp") { event.preventDefault(); setSuggestionIndex((current) => Math.max(0, current - 1)); return; }
    if (suggestions.length && event.key === "Enter") { event.preventDefault(); chooseCommand((suggestions[suggestionIndex] ?? suggestions[0])![0]); return; }
    if (event.key === "Escape" && value) { event.preventDefault(); onChange(""); }
  };

  const closeOverlay = (kind: Exclude<ComposerOverlay, null>, restoreFocus = true) => {
    onOverlayChange(null);
    if (restoreFocus) focusControl(triggerId(kind));
  };
  const toggleOverlay = (kind: Exclude<ComposerOverlay, null>) => onOverlayChange(overlay === kind ? null : kind);

  useEffect(() => {
    if (!overlay) return undefined;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && rootRef.current?.contains(target)) return;
      onOverlayChange(null);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [onOverlayChange, overlay]);

  return (
    <div ref={rootRef} className="composer-stack">
      {overlay === "model" ? <ModelPicker models={models} selected={sessionState?.model} onSelect={(model) => { closeOverlay("model"); void Promise.resolve(onSelectModel(model)).catch(() => undefined); }} onClose={() => closeOverlay("model")} runtime={runtime} /> : null}
      {overlay === "reasoning" ? <ThinkingPicker model={sessionState?.model} selected={normalizeThinking(sessionState?.thinkingLevel)} onSelect={(level) => { void Promise.resolve(onSelectThinking(level)).then(() => closeOverlay("reasoning")); }} onClose={() => closeOverlay("reasoning")} /> : null}
      {overlay === "context" ? <CompactPicker state={sessionState} runtime={runtime} onToggleAuto={onToggleAutoCompact} onCompact={onCompactNow} onClose={() => closeOverlay("context")} /> : null}
      {suggestions.length ? (
        <div className="slash-menu" role="listbox" aria-label="Команды OMP">
          {suggestions.map(([command, description], index) => (
            <button key={command} type="button" role="option" aria-selected={index === suggestionIndex} className={index === suggestionIndex ? "selected" : ""} onMouseEnter={() => setSuggestionIndex(index)} onClick={() => chooseCommand(command)}>
              <span>{index === suggestionIndex ? "❯" : " "} {command}</span><span>{description}</span>
            </button>
          ))}
        </div>
      ) : null}
      <form className="omp-composer" onSubmit={submit}>
        <StatusSegments
          projectName={projectName}
          runtime={runtime}
          sessionState={sessionState}
          onModelClick={() => toggleOverlay("model")}
          onThinkingClick={() => toggleOverlay("reasoning")}
          onProjectClick={onChooseProject}
          onContextClick={() => toggleOverlay("context")}
          onRuntimeClick={onRefreshRuntime}
          onRunClick={run}
          working={working}
          canRun={!working && Boolean(value.trim()) && Boolean(runtime?.rpc.ready)}
        />
        <div className="composer-input-row">
          <span className="composer-prompt">▍</span>
          <input ref={inputRef} name="message" autoComplete="off" value={value} onChange={(event: ChangeEvent<HTMLInputElement>) => { setSuggestionIndex(0); onChange(event.target.value); }} onKeyDown={onKeyDown} placeholder={working ? "OMP выполняет задачу…" : runtime?.rpc.ready ? "Опишите задачу или введите / для команд…" : "Опишите задачу…"} disabled={working} aria-label="Сообщение mahiko" />
        </div>
      </form>
    </div>
  );
}

function ModelPicker({ models, selected, onSelect, onClose, runtime }: { models: OmpModel[]; selected?: OmpModel; onSelect(model: OmpModel): void; onClose(): void; runtime: RuntimeSnapshot | null }): JSX.Element {
  const selectedIndex = Math.max(0, models.findIndex((model) => model.provider === selected?.provider && model.id === selected?.id));
  const [highlighted, setHighlighted] = useState(selectedIndex);
  const pickerRef = useRef<HTMLDivElement>(null);
  useEffect(() => { pickerRef.current?.focus(); }, []);
  useEffect(() => { setHighlighted(Math.min(selectedIndex, Math.max(0, models.length - 1))); }, [models.length, selectedIndex]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); return; }
    if (event.key === "ArrowDown") { event.preventDefault(); setHighlighted((current) => Math.min(Math.max(0, models.length - 1), current + 1)); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setHighlighted((current) => Math.max(0, current - 1)); }
    else if (event.key === "Home") { event.preventDefault(); setHighlighted(0); }
    else if (event.key === "End") { event.preventDefault(); setHighlighted(Math.max(0, models.length - 1)); }
    else if (event.key === "Enter" && models[highlighted]) { event.preventDefault(); onSelect(models[highlighted]); }
  };

  return (
    <div ref={pickerRef} className="composer-popover model-popover compact-model-picker" role="listbox" aria-label="Выбор модели OMP" aria-activedescendant={models.length ? `model-option-${highlighted}` : undefined} tabIndex={-1} onKeyDown={onKeyDown}>
      <TuiEscapeButton className="window-corner" label="Закрыть выбор модели" onClick={onClose} />
      <div className="model-picker-title"><span>МОДЕЛЬ</span><span>{runtime?.rpc.ready ? "OMP" : "offline"}</span></div>
      {!models.length ? <div className="picker-empty">Модели не найдены</div> : null}
      {models.map((model, index) => {
        const isSelected = model.provider === selected?.provider && model.id === selected?.id;
        const active = index === highlighted;
        return <button key={`${model.provider}/${model.id}`} id={`model-option-${index}`} type="button" role="option" aria-selected={isSelected} className={`${isSelected ? "selected " : ""}${active ? "highlighted" : ""}`.trim()} onMouseEnter={() => setHighlighted(index)} onClick={() => onSelect(model)}><span>{active ? "❯" : " "}</span><strong>{model.name}</strong><span>{model.provider} · {formatTokens(model.contextWindow)}</span><em>{model.reasoning ? "◕" : ""}</em></button>;
      })}
    </div>
  );
}

function ThinkingPicker({ model, selected, onSelect, onClose }: { model?: OmpModel; selected: ThinkingLevel; onSelect(level: ThinkingLevel): void; onClose(): void }): JSX.Element {
  const levels = thinkingOptions(model);
  const initialIndex = Math.max(0, levels.findIndex((level) => level.value === selected));
  const [highlighted, setHighlighted] = useState(initialIndex);
  const pickerRef = useRef<HTMLDivElement>(null);
  useEffect(() => { pickerRef.current?.focus(); }, []);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); return; }
    if (event.key === "ArrowDown") { event.preventDefault(); setHighlighted((current) => Math.min(levels.length - 1, current + 1)); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setHighlighted((current) => Math.max(0, current - 1)); }
    else if (event.key === "Home") { event.preventDefault(); setHighlighted(0); }
    else if (event.key === "End") { event.preventDefault(); setHighlighted(levels.length - 1); }
    else if (event.key === "Enter") { const next = levels[highlighted]; if (next) { event.preventDefault(); onSelect(next.value); } }
  };
  return (
    <div ref={pickerRef} className="composer-popover reasoning-popover" role="listbox" aria-label="Уровень рассуждения OMP" aria-activedescendant={`thinking-option-${highlighted}`} tabIndex={-1} onKeyDown={onKeyDown}>
      <TuiEscapeButton className="window-corner" label="Закрыть выбор reasoning" onClick={onClose} />
      <div className="model-picker-title"><span>REASONING</span></div>
      {levels.map((level, index) => <button key={level.value} id={`thinking-option-${index}`} type="button" role="option" aria-label={`${level.label} — ${level.hint}`} aria-selected={level.value === selected} className={`${level.value === selected ? "selected " : ""}${index === highlighted ? "highlighted" : ""}`.trim()} onMouseEnter={() => setHighlighted(index)} onClick={() => onSelect(level.value)}><span>{index === highlighted ? "❯" : " "}</span><strong>{level.label}</strong><span>{level.hint}</span><em>{level.value === selected ? "●" : ""}</em></button>)}
    </div>
  );
}

function CompactPicker({ state, runtime, onToggleAuto, onCompact, onClose }: { state: OmpSessionState | null; runtime: RuntimeSnapshot | null; onToggleAuto(enabled: boolean): Promise<void> | void; onCompact(): Promise<void> | void; onClose(): void }): JSX.Element {
  const ref = useRef<HTMLElement>(null);
  const [busy, setBusy] = useState<"auto" | "compact" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const invoke = async (kind: "auto" | "compact", operation: () => Promise<void> | void) => {
    setBusy(kind);
    setNotice(null);
    try {
      await operation();
      setNotice(kind === "auto" ? "Автосжатие обновлено." : "Контекст сжат.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };
  return (
    <section ref={ref} className="composer-popover context-popover compact-picker" aria-label="Контекст OMP" tabIndex={-1} onKeyDown={(event: KeyboardEvent<HTMLElement>) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); } }}>
      <TuiEscapeButton className="window-corner" label="Закрыть контекст" onClick={onClose} />
      <header><span>КОНТЕКСТ</span><strong>{contextLabel(state)}</strong></header>
      <button type="button" className="context-setting-row" disabled={busy !== null} aria-pressed={state?.autoCompactionEnabled ?? false} aria-label="Автосжатие" onClick={() => void invoke("auto", () => onToggleAuto(!(state?.autoCompactionEnabled ?? false)))}><span><strong>Автосжатие</strong></span><em>{state?.autoCompactionEnabled ? "● ВКЛ" : "○ ВЫКЛ"}</em></button>
      <button type="button" className="manual-compact-row" disabled={busy !== null || !runtime?.rpc.ready} aria-label="Сжать сейчас" onClick={() => void invoke("compact", onCompact)}><span><strong>{busy === "compact" ? "Сжатие…" : "Сжать сейчас"}</strong></span><em>↵</em></button>
      {notice ? <div className="compact-notice" role="status">{notice}</div> : null}
    </section>
  );
}

export function StatusSegments({ projectName, runtime, sessionState, canRun = false, working = false, onModelClick, onThinkingClick, onProjectClick, onContextClick, onRuntimeClick, onRunClick }: { projectName: string; runtime: RuntimeSnapshot | null; sessionState?: OmpSessionState | null; canRun?: boolean; working?: boolean; onModelClick?(): void; onThinkingClick?(): void; onProjectClick?(): void; onContextClick?(): void; onRuntimeClick?(): void; onRunClick?(): void }): JSX.Element {
  const projectLabel = projectName === "проект не выбран" ? "выбрать проект" : projectName;
  const modelLabel = sessionState?.model?.name ?? "модель";
  const thinking = normalizeThinking(sessionState?.thinkingLevel);
  return (
    <div className="status-segments" aria-label="Строка состояния OMP">
      <span className="status-cluster">
        <span className="status-frame-start" aria-hidden="true">╭─</span><span className="status-mark">π</span><i>›</i>
        {onModelClick ? <button id="model-picker-trigger" type="button" className="status-model status-action" aria-label={`Выбрать модель: ${modelLabel}`} onClick={onModelClick}>⬢ {modelLabel}</button> : <span className="status-model">⬢ {modelLabel}</span>}<span className="status-dot">·</span>
        {onThinkingClick ? <button id="reasoning-picker-trigger" type="button" className="status-thinking status-action" aria-label={`Выбрать уровень рассуждения: ${thinking}`} onClick={onThinkingClick}>◕ {thinking}</button> : <span className="status-thinking">◕ {thinking}</span>}<i>›</i>
        {onProjectClick ? <button type="button" className="status-path status-action" aria-label={`Выбрать проект. Текущий: ${projectName}`} onClick={onProjectClick}>▱ {projectLabel}</button> : <span className="status-path">▱ {projectLabel}</span>}<i>›</i>
        {onContextClick ? <button id="compact-picker-trigger" type="button" className="status-context status-action" aria-label={`Открыть контекст. ${contextLabel(sessionState)}`} onClick={onContextClick}>{contextShort(sessionState)}</button> : <span className="status-context">{contextShort(sessionState)}</span>}
        {onRuntimeClick ? <button type="button" className={`${runtime?.rpc.ready ? "status-ready" : "status-warn"} status-action`} aria-label="Обновить read-only состояние OMP" onClick={onRuntimeClick}>⟲</button> : null}
        {!working && onRunClick ? <button type="button" className="status-run status-action" aria-label="Отправить сообщение" disabled={!canRun} onClick={onRunClick}>▶</button> : null}
      </span>
      <span className="status-rule" aria-hidden="true" /><span className="status-frame-end" aria-hidden="true">╮</span>
    </div>
  );
}

function contextShort(state?: OmpSessionState | null): string {
  const usage = state?.contextUsage;
  const percent = typeof usage?.percent === "number" ? usage.percent : usage && typeof usage.tokens === "number" && typeof usage.contextWindow === "number" && usage.contextWindow > 0 ? (usage.tokens / usage.contextWindow) * 100 : null;
  const windowLabel = typeof usage?.contextWindow === "number" ? formatTokens(usage.contextWindow) : "—";
  return percent === null ? "◫ —/—" : `◫ ${percent.toFixed(percent < 10 ? 1 : 0)}%/${windowLabel}`;
}
function contextLabel(state?: OmpSessionState | null): string {
  const usage = state?.contextUsage;
  const short = contextShort(state);
  if (typeof usage?.tokens === "number" && typeof usage.contextWindow === "number") return `${short} · ${formatTokens(usage.tokens)} used`;
  return short;
}
function formatTokens(value: number | null | undefined): string {
  if (typeof value !== "number") return "—";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 ? 1 : 0)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return String(value);
}
function normalizeThinking(value: string | undefined): ThinkingLevel {
  return THINKING_LEVELS.some((level) => level.value === value) ? value as ThinkingLevel : "xhigh";
}
function thinkingOptions(model?: OmpModel): ReadonlyArray<(typeof THINKING_LEVELS)[number]> {
  if (!model?.reasoning) return [];
  const supported = new Set<ThinkingLevel>(["auto", ...model.thinkingLevels]);
  if (model.supportsThinkingOff) supported.add("off");
  return THINKING_LEVELS.filter((level) => supported.has(level.value));
}
function triggerId(kind: Exclude<ComposerOverlay, null>): string {
  return kind === "model" ? "model-picker-trigger" : kind === "reasoning" ? "reasoning-picker-trigger" : "compact-picker-trigger";
}
function focusControl(id: string): void { window.requestAnimationFrame(() => document.getElementById(id)?.focus()); }
