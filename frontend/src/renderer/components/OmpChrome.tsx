import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type JSX, type KeyboardEvent } from "react";
import {
  ompThinkingOptions,
  type AppSettings,
  type RuntimeSnapshot,
  type ThinkingLevel,
  type ThinkingOption,
} from "../../shared/contracts";
import { modelRows, slashCommands } from "../data";

export type { ThinkingLevel } from "../../shared/contracts";

export function PiMark({ className = "", labelled = false }: { className?: string; labelled?: boolean }): JSX.Element {
  return (
    <span
      className={`pi-spectrum${className ? ` ${className}` : ""}`}
      role={labelled ? "img" : undefined}
      aria-label={labelled ? "Пи — ассистент ma-hi-ko" : undefined}
      aria-hidden={labelled ? undefined : true}
    >π</span>
  );
}

export function TerminalSection({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return <section className="terminal-section"><div className="terminal-section-title">{title}</div><div className="terminal-section-body">{children}</div></section>;
}

export function StartupTranscript({ runtime, projectName }: { runtime: RuntimeSnapshot | null; projectName: string }): JSX.Element {
  return (
    <section className="chat-start" aria-label="Сведения OMP">
      <PiMark className="start-mark" labelled />
      <h2>Чем помочь?</h2>
      <p>Рабочая сессия <strong>{projectName}</strong> готова.</p>
      <div className="start-runtime">
        <span><i className={runtime?.available ? "success" : "warning"}>●</i> OMP {runtime?.version ?? "поиск…"}</span>
        <span><i className={runtime?.rpc.ready ? "success" : "warning"}>●</i> RPC {runtime?.rpc.ready ? `v${runtime.rpc.protocolVersion}` : "подключение"}</span>
        <span><i className="accent">◕</i> reasoning из {runtime?.thinking.source === "omp-runtime" ? "OMP" : "fallback-схемы"}</span>
      </div>
      <p className="start-hint"><kbd>/</kbd> команды <kbd>@</kbd> файлы <kbd>!</kbd> shell</p>
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
      <PiMark className="assistant-mark" />
      <div className="assistant-block"><div className="assistant-message">{message.text}</div></div>
    </div>
  );
}

type CompactionPatch = Partial<Pick<AppSettings, "autoCompact" | "compactionThreshold" | "compactionStrategy">>;

interface ComposerProps {
  value: string;
  onChange(value: string): void;
  onSubmit(): void;
  working: boolean;
  projectName: string;
  runtime: RuntimeSnapshot | null;
  onCommand(command: string): void;
  selectedModel: string;
  selectedModelKey: string;
  modelPickerOpen: boolean;
  onToggleModelPicker(): void;
  onSelectModel(model: string, key: string): void;
  selectedThinking?: ThinkingLevel;
  onSelectThinking?(level: ThinkingLevel): void;
  contextCompact?: boolean;
  onContextCompactChange?(compact: boolean): void;
  autoCompact?: boolean;
  compactionThreshold?: number;
  compactionStrategy?: AppSettings["compactionStrategy"];
  onContextSettingsChange?(patch: CompactionPatch): void;
  onChooseProject?(): void;
  onRefreshRuntime?(): void;
}

export function Composer({
  value,
  onChange,
  onSubmit,
  working,
  projectName,
  runtime,
  onCommand,
  selectedModel,
  selectedModelKey,
  modelPickerOpen,
  onToggleModelPicker,
  onSelectModel,
  selectedThinking,
  onSelectThinking,
  contextCompact,
  onContextCompactChange,
  autoCompact,
  compactionThreshold,
  compactionStrategy,
  onContextSettingsChange,
  onChooseProject,
  onRefreshRuntime,
}: ComposerProps): JSX.Element {
  const [localThinking, setLocalThinking] = useState<ThinkingLevel>(selectedThinking ?? runtime?.thinking.defaultLevel ?? "xhigh");
  const [thinkingPickerOpen, setThinkingPickerOpen] = useState(false);
  const [contextPickerOpen, setContextPickerOpen] = useState(false);
  const [localContextCompact, setLocalContextCompact] = useState(false);
  const [localAutoCompact, setLocalAutoCompact] = useState(true);
  const [localThreshold, setLocalThreshold] = useState(82);
  const [localStrategy, setLocalStrategy] = useState<AppSettings["compactionStrategy"]>("balanced");
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const stackRef = useRef<HTMLDivElement>(null);
  const thinking = selectedThinking ?? localThinking;
  const compactContext = contextCompact ?? localContextCompact;
  const effectiveAutoCompact = autoCompact ?? localAutoCompact;
  const effectiveThreshold = compactionThreshold ?? localThreshold;
  const effectiveStrategy = compactionStrategy ?? localStrategy;
  const thinkingOptions = runtime?.thinking.levels.length ? runtime.thinking.levels : ompThinkingOptions;
  const suggestions = value.startsWith("/")
    ? slashCommands.filter(([command, description]) => `${command} ${description}`.toLowerCase().includes(value.slice(1).toLowerCase())).slice(0, 5)
    : [];

  const chooseCommand = (command: string) => {
    onCommand(command);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };

  const run = () => {
    const suggestion = suggestions[suggestionIndex] ?? suggestions[0];
    if (value.startsWith("/") && suggestion) {
      chooseCommand(suggestion[0]);
      return;
    }
    onSubmit();
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    run();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (suggestions.length && event.key === "ArrowDown") {
      event.preventDefault();
      setSuggestionIndex((current) => Math.min(suggestions.length - 1, current + 1));
      return;
    }
    if (suggestions.length && event.key === "ArrowUp") {
      event.preventDefault();
      setSuggestionIndex((current) => Math.max(0, current - 1));
      return;
    }
    if (suggestions.length && event.key === "Enter") {
      event.preventDefault();
      chooseCommand((suggestions[suggestionIndex] ?? suggestions[0])![0]);
      return;
    }
    if (event.key === "Escape" && value) {
      event.preventDefault();
      onChange("");
    }
  };

  useEffect(() => {
    const close = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (thinkingPickerOpen) {
        event.preventDefault();
        setThinkingPickerOpen(false);
        focusControl("thinking-picker-trigger");
      } else if (contextPickerOpen) {
        event.preventDefault();
        setContextPickerOpen(false);
        focusControl("context-settings-trigger");
      }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [contextPickerOpen, thinkingPickerOpen]);

  useEffect(() => {
    if (!modelPickerOpen && !thinkingPickerOpen && !contextPickerOpen) return undefined;
    const closeOutside = (event: PointerEvent) => {
      if (stackRef.current?.contains(event.target as Node)) return;
      if (modelPickerOpen) onToggleModelPicker();
      setThinkingPickerOpen(false);
      setContextPickerOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [contextPickerOpen, modelPickerOpen, onToggleModelPicker, thinkingPickerOpen]);

  const toggleModelPicker = () => {
    setThinkingPickerOpen(false);
    setContextPickerOpen(false);
    onToggleModelPicker();
  };

  const toggleThinkingPicker = () => {
    if (modelPickerOpen) onToggleModelPicker();
    setContextPickerOpen(false);
    setThinkingPickerOpen((open) => !open);
  };

  const toggleContextPicker = () => {
    if (modelPickerOpen) onToggleModelPicker();
    setThinkingPickerOpen(false);
    setContextPickerOpen((open) => !open);
  };

  const selectThinking = (level: ThinkingLevel) => {
    setLocalThinking(level);
    onSelectThinking?.(level);
    setThinkingPickerOpen(false);
    focusControl("thinking-picker-trigger");
  };

  const selectModel = (model: string, key: string) => {
    onSelectModel(model, key);
    focusControl("model-picker-trigger");
  };

  const updateContext = (patch: CompactionPatch) => {
    if (typeof patch.autoCompact === "boolean") setLocalAutoCompact(patch.autoCompact);
    if (typeof patch.compactionThreshold === "number") setLocalThreshold(patch.compactionThreshold);
    if (patch.compactionStrategy) setLocalStrategy(patch.compactionStrategy);
    onContextSettingsChange?.(patch);
  };

  const compactNow = () => {
    setLocalContextCompact(true);
    onContextCompactChange?.(true);
  };

  return (
    <div ref={stackRef} className="composer-stack">
      {modelPickerOpen ? <ModelPicker selectedModelKey={selectedModelKey} onSelect={selectModel} /> : null}
      {thinkingPickerOpen ? (
        <ThinkingPicker
          selected={thinking}
          options={thinkingOptions}
          source={runtime?.thinking.source === "omp-runtime" ? "OMP runtime" : "OMP fallback"}
          detail={runtime?.thinking.detail ?? "Ожидание runtime OMP"}
          onSelect={selectThinking}
        />
      ) : null}
      {contextPickerOpen ? (
        <ContextPopover
          autoCompact={effectiveAutoCompact}
          compacted={compactContext}
          threshold={effectiveThreshold}
          strategy={effectiveStrategy}
          onChange={updateContext}
          onCompactNow={compactNow}
        />
      ) : null}
      {suggestions.length ? (
        <div className="slash-menu" role="listbox" aria-label="Команды OMP">
          {suggestions.map(([command, description], index) => (
            <button
              key={command}
              type="button"
              role="option"
              aria-selected={index === suggestionIndex}
              className={index === suggestionIndex ? "selected" : ""}
              onMouseEnter={() => setSuggestionIndex(index)}
              onClick={() => chooseCommand(command)}
            >
              <span>{index === suggestionIndex ? "❯" : " "} {command}</span><span>{description}</span>
            </button>
          ))}
        </div>
      ) : null}
      <form className="omp-composer" onSubmit={submit}>
        <StatusSegments
          projectName={projectName}
          runtime={runtime}
          selectedModel={selectedModel}
          selectedThinking={thinking}
          contextCompact={compactContext}
          autoCompact={effectiveAutoCompact}
          modelPickerOpen={modelPickerOpen}
          thinkingPickerOpen={thinkingPickerOpen}
          contextPickerOpen={contextPickerOpen}
          onModelClick={toggleModelPicker}
          onThinkingClick={toggleThinkingPicker}
          onProjectClick={onChooseProject}
          onContextClick={toggleContextPicker}
          onRuntimeClick={onRefreshRuntime}
          onRunClick={run}
          canRun={!working && Boolean(value.trim())}
        />
        <div className="composer-input-row">
          <span className="composer-prompt">▍</span>
          <input
            ref={inputRef}
            name="message"
            autoComplete="off"
            value={value}
            onChange={(event: ChangeEvent<HTMLInputElement>) => { setSuggestionIndex(0); onChange(event.target.value); }}
            onKeyDown={onKeyDown}
            placeholder={working ? "Агент выполняет задачу…" : "Опишите задачу или введите / для команд…"}
            disabled={working}
            aria-label="Сообщение ma-hi-ko"
          />
        </div>
      </form>
    </div>
  );
}

function ThinkingPicker({ selected, options, source, detail, onSelect }: { selected: ThinkingLevel; options: ThinkingOption[]; source: string; detail: string; onSelect(level: ThinkingLevel): void }): JSX.Element {
  const initialIndex = Math.max(0, options.findIndex(({ id }) => id === selected));
  const [highlighted, setHighlighted] = useState(initialIndex);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => { pickerRef.current?.focus(); }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlighted((value) => Math.min(options.length - 1, value + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlighted((value) => Math.max(0, value - 1));
    } else if (event.key === "Enter" && options[highlighted]) {
      event.preventDefault();
      onSelect(options[highlighted].id);
    }
  };

  return (
    <div ref={pickerRef} className="thinking-picker" role="listbox" aria-label="Уровень рассуждения" aria-activedescendant={`thinking-option-${highlighted}`} tabIndex={-1} onKeyDown={onKeyDown}>
      <div className="thinking-picker-title"><span>УРОВЕНЬ REASONING</span><small>{source}</small><em>{detail}</em></div>
      {options.map(({ id, label, description }, index) => (
        <button
          key={id}
          id={`thinking-option-${index}`}
          type="button"
          role="option"
          aria-selected={id === selected}
          className={`${id === selected ? "selected " : ""}${index === highlighted ? "highlighted" : ""}`.trim()}
          onMouseEnter={() => setHighlighted(index)}
          onClick={() => onSelect(id)}
        >
          <span>{index === highlighted ? "❯" : " "}</span><strong>{label}</strong><small>{description}</small><em>{id}</em>
        </button>
      ))}
      <div className="model-picker-help">↑/↓ выбрать · Enter применить · Esc закрыть</div>
    </div>
  );
}

const strategyLabels: Record<AppSettings["compactionStrategy"], string> = {
  conservative: "Бережно",
  balanced: "Сбалансированно",
  aggressive: "Агрессивно",
};

function ContextPopover({ autoCompact, compacted, threshold, strategy, onChange, onCompactNow }: { autoCompact: boolean; compacted: boolean; threshold: number; strategy: AppSettings["compactionStrategy"]; onChange(patch: CompactionPatch): void; onCompactNow(): void }): JSX.Element {
  return (
    <section className="context-popover" role="dialog" aria-label="Настройки контекста">
      <header><div><span>КОНТЕКСТ OMP</span><strong>1,9% из 1,1M</strong></div><span className="context-health">● запас высокий</span></header>
      <button type="button" className="context-toggle" aria-pressed={autoCompact} onClick={() => onChange({ autoCompact: !autoCompact })}>
        <span><strong>Автосжатие</strong><small>OMP компактирует историю до переполнения</small></span><i aria-hidden="true">{autoCompact ? "● ВКЛ" : "○ ВЫКЛ"}</i>
      </button>
      <label className="context-threshold">
        <span><strong>Порог запуска</strong><output>{threshold}%</output></span>
        <input type="range" min="60" max="95" step="1" value={threshold} onChange={(event: ChangeEvent<HTMLInputElement>) => onChange({ compactionThreshold: Number(event.target.value) })} aria-label="Порог автосжатия" />
      </label>
      <fieldset className="context-strategy"><legend>Стратегия</legend><div>
        {(Object.keys(strategyLabels) as AppSettings["compactionStrategy"][]).map((value) => (
          <button key={value} type="button" aria-pressed={strategy === value} onClick={() => onChange({ compactionStrategy: value })}>{strategyLabels[value]}</button>
        ))}
      </div></fieldset>
      <div className="context-popover-footer"><span>{compacted ? "✓ Контекст сжат вручную" : "Последнее сжатие: не требовалось"}</span><button type="button" onClick={onCompactNow}>Сжать сейчас</button></div>
    </section>
  );
}

function ModelPicker({ selectedModelKey, onSelect }: { selectedModelKey: string; onSelect(model: string, key: string): void }): JSX.Element {
  const initialIndex = Math.max(0, modelRows.findIndex(([provider, model]) => `${provider}:${model}` === selectedModelKey));
  const [highlighted, setHighlighted] = useState(initialIndex);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => { pickerRef.current?.focus(); }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlighted((value) => Math.min(modelRows.length - 1, value + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlighted((value) => Math.max(0, value - 1));
    } else if (event.key === "Enter" && modelRows[highlighted]) {
      event.preventDefault();
      const [provider, model] = modelRows[highlighted];
      onSelect(formatModelName(model), `${provider}:${model}`);
    }
  };

  return (
    <div ref={pickerRef} className="model-picker" role="listbox" aria-label="Выбор модели" aria-activedescendant={`model-option-${highlighted}`} tabIndex={-1} onKeyDown={onKeyDown}>
      <div className="model-picker-title"><span>МОДЕЛЬ</span><span>ПРОВАЙДЕР · КОНТЕКСТ</span></div>
      {modelRows.map(([provider, model, context, price], index) => {
        const label = formatModelName(model);
        const key = `${provider}:${model}`;
        const selected = key === selectedModelKey;
        const active = index === highlighted;
        return (
          <button key={key} id={`model-option-${index}`} type="button" role="option" aria-selected={selected} className={`${selected ? "selected " : ""}${active ? "highlighted" : ""}`.trim()} onMouseEnter={() => setHighlighted(index)} onClick={() => onSelect(label, key)}>
            <span>{active ? "❯" : " "}</span><strong>{model}</strong><span>{provider} · {context}</span><em>{price}</em>
          </button>
        );
      })}
      <div className="model-picker-help">↑/↓ выбрать · Enter применить · Esc закрыть</div>
    </div>
  );
}

function formatModelName(model: string): string {
  const parts = model.split("-");
  if (parts[0]?.toLowerCase() === "gpt" && parts[1]) return `GPT-${parts[1]} ${parts.slice(2).map(capitalize).join(" ")}`.trim();
  return parts.map(capitalize).join(" ");
}

const capitalize = (part: string): string => part.charAt(0).toUpperCase() + part.slice(1);

export function StatusSegments({ projectName, runtime, selectedModel = "GPT-5.6 Sol", selectedThinking = "xhigh", contextCompact = false, autoCompact = true, modelPickerOpen = false, thinkingPickerOpen = false, contextPickerOpen = false, canRun = false, onModelClick, onThinkingClick, onProjectClick, onContextClick, onRuntimeClick, onRunClick }: { projectName: string; runtime: RuntimeSnapshot | null; selectedModel?: string; selectedThinking?: ThinkingLevel; contextCompact?: boolean; autoCompact?: boolean; modelPickerOpen?: boolean; thinkingPickerOpen?: boolean; contextPickerOpen?: boolean; canRun?: boolean; onModelClick?(): void; onThinkingClick?(): void; onProjectClick?(): void; onContextClick?(): void; onRuntimeClick?(): void; onRunClick?(): void }): JSX.Element {
  const projectLabel = projectName === "проект не выбран" ? "выбрать проект" : projectName;
  const thinkingSource = runtime?.thinking.source === "omp-runtime" ? "OMP" : "fallback";
  return (
    <div className="status-segments" aria-label="Строка состояния OMP">
      <span className="status-cluster">
        <span className="status-frame-start" aria-hidden="true">╭─</span><PiMark className="status-mark" /><i aria-hidden="true">›</i>
        {onModelClick ? <button id="model-picker-trigger" type="button" className="status-model status-action" aria-label={`Выбрать модель: ${selectedModel}`} aria-haspopup="listbox" aria-expanded={modelPickerOpen} onClick={onModelClick}>⬢ {selectedModel}</button> : <span className="status-model">⬢ {selectedModel}</span>}<span className="status-dot">·</span>
        {onThinkingClick ? <button id="thinking-picker-trigger" type="button" className="status-thinking status-action" aria-label={`Выбрать уровень рассуждения: ${selectedThinking}`} aria-haspopup="listbox" aria-expanded={thinkingPickerOpen} onClick={onThinkingClick}>◕ {thinkingSource}:{selectedThinking}</button> : <span className="status-thinking">◕ {thinkingSource}:{selectedThinking}</span>}<i aria-hidden="true">›</i>
        {onProjectClick ? <button type="button" className="status-path status-action" aria-label={`Выбрать проект. Текущий: ${projectName}`} onClick={onProjectClick}>▱ {projectLabel}</button> : <span className="status-path">▱ {projectLabel}</span>}<i aria-hidden="true">›</i>
        {onContextClick ? <button id="context-settings-trigger" type="button" className="status-context status-action" aria-label="Настроить контекст и автосжатие" aria-haspopup="dialog" aria-expanded={contextPickerOpen} data-compacted={contextCompact || undefined} onClick={onContextClick}><span>◒ Контекст</span><b>1,9%</b>{autoCompact ? <em>auto</em> : null}</button> : <span className="status-context"><span>◒ Контекст</span><b>1,9%</b></span>}
        {onRuntimeClick ? <button type="button" className={`${runtime?.rpc.ready ? "status-ready" : "status-warn"} status-action`} aria-label="Обновить состояние OMP" onClick={onRuntimeClick}>⟲</button> : <span className={runtime?.rpc.ready ? "status-ready" : "status-warn"}>⟲</span>}
        {onRunClick ? <button type="button" className="status-run status-action" aria-label="Отправить сообщение" disabled={!canRun} onClick={onRunClick}>▶</button> : <span className="status-run">▶</span>}
      </span>
      <span className="status-rule" aria-hidden="true" /><span className="status-frame-end" aria-hidden="true">╮</span>
    </div>
  );
}

function focusControl(id: string): void {
  window.requestAnimationFrame(() => document.getElementById(id)?.focus());
}
