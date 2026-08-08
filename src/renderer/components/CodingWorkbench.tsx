import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent, type JSX, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { EmbeddedBrowserBounds, EmbeddedBrowserState, ProjectFileEntry, RuntimeSnapshot, TerminalResult } from "../../shared/contracts";
import { api, isElectron } from "../api";
import { TuiEscapeButton } from "./TuiControls";

export type WorkbenchTool = "terminal" | "browser" | "files";

const TOOL_TABS: ReadonlyArray<{ id: WorkbenchTool; label: string; icon: string }> = [
  { id: "terminal", label: "Terminal", icon: ">_" },
  { id: "browser", label: "Browser", icon: "◎" },
  { id: "files", label: "Files", icon: "▱" },
];
const MIN_WIDTH = 360;
const MAX_WIDTH = 720;

export function CodingWorkbench({ activeTool, onToolChange, onClose, projectName, runtime, files, onOpenFile, width, onWidthChange, browserSuspended = false }: {
  activeTool: WorkbenchTool;
  onToolChange(tool: WorkbenchTool): void;
  onClose(): void;
  projectName: string;
  runtime: RuntimeSnapshot | null;
  files: ProjectFileEntry[];
  onOpenFile(path: string): void;
  width: number;
  onWidthChange(width: number): void;
  browserSuspended?: boolean;
}): JSX.Element {
  const tabIndex = TOOL_TABS.findIndex((tab) => tab.id === activeTool);
  const resizeRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const resize = resizeRef.current;
      if (!resize || resize.pointerId !== event.pointerId) return;
      const viewportMax = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, window.innerWidth - 420));
      onWidthChange(Math.round(Math.min(viewportMax, Math.max(MIN_WIDTH, resize.startWidth + resize.startX - event.clientX))));
    };
    const stop = (event: PointerEvent) => { if (resizeRef.current?.pointerId === event.pointerId) resizeRef.current = null; };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, [onWidthChange]);

  const moveTab = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const next = TOOL_TABS[(tabIndex + direction + TOOL_TABS.length) % TOOL_TABS.length];
    if (next) onToolChange(next.id);
  };

  return (
    <aside id="coding-workbench" className="coding-workbench" aria-label="Coding Workbench" style={{ width }}>
      <div
        className="workbench-resize-handle"
        role="separator"
        aria-label="Изменить ширину Coding Workbench"
        aria-orientation="vertical"
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={MAX_WIDTH}
        aria-valuenow={width}
        tabIndex={0}
        onPointerDown={(event: ReactPointerEvent<HTMLDivElement>) => {
          if (event.button !== 0) return;
          resizeRef.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: width };
          event.preventDefault();
        }}
        onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          const delta = event.key === "ArrowLeft" ? 20 : -20;
          onWidthChange(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width + delta)));
        }}
      />
      <header className="workbench-header">
        <div className="workbench-project"><strong>{projectName}</strong><span className={runtime?.rpc.ready ? "success" : "dim"}>{runtime?.rpc.ready ? "● OMP" : "○ OMP"}</span></div>
        <TuiEscapeButton className="workbench-escape" label="Скрыть Coding Workbench" onClick={onClose} />
      </header>
      <div className="workbench-tabs" role="tablist" aria-label="Инструменты Coding Workbench" onKeyDown={moveTab}>
        {TOOL_TABS.map((tab) => <button key={tab.id} type="button" role="tab" aria-selected={activeTool === tab.id} tabIndex={activeTool === tab.id ? 0 : -1} onClick={() => onToolChange(tab.id)}><span>{tab.icon}</span>{tab.label}</button>)}
      </div>
      <div className="workbench-body">
        <div className="workbench-tool-panel" hidden={activeTool !== "terminal"}><TerminalPane /></div>
        <div className="workbench-tool-panel" hidden={activeTool !== "browser"}><BrowserPane active={activeTool === "browser"} suspended={browserSuspended} /></div>
        <div className="workbench-tool-panel" hidden={activeTool !== "files"}><FilesPane files={files} onOpenFile={onOpenFile} /></div>
      </div>
    </aside>
  );
}

interface TerminalLine { id: number; text: string; kind: "command" | "stdout" | "stderr" }

function TerminalPane(): JSX.Element {
  const [command, setCommand] = useState("");
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState<TerminalLine[]>([]);
  const nextId = useRef(1);
  const outputRef = useRef<HTMLDivElement>(null);

  useEffect(() => { outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight, behavior: "auto" }); }, [lines]);

  const appendResult = (result: TerminalResult) => {
    const additions: TerminalLine[] = [];
    for (const text of result.stdout.replace(/\n$/, "").split("\n")) if (text) additions.push({ id: nextId.current++, text, kind: "stdout" });
    for (const text of result.stderr.replace(/\n$/, "").split("\n")) if (text) additions.push({ id: nextId.current++, text, kind: "stderr" });
    if (result.exitCode !== 0 && !result.stderr.trim()) additions.push({ id: nextId.current++, text: `exit ${result.exitCode}`, kind: "stderr" });
    setLines((current) => [...current, ...additions]);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next = command.trim();
    if (!next || busy) return;
    setCommand("");
    if (next === "clear") { setLines([]); return; }
    setLines((current) => [...current, { id: nextId.current++, text: `$ ${next}`, kind: "command" }]);
    setBusy(true);
    try { appendResult(await api.terminal.run(next)); }
    catch (error) { setLines((current) => [...current, { id: nextId.current++, text: error instanceof Error ? error.message : String(error), kind: "stderr" }]); }
    finally { setBusy(false); }
  };

  return (
    <section className="terminal-pane" aria-label="Terminal">
      <div ref={outputRef} className="terminal-output" aria-live="polite">{lines.map((line) => <div className={`terminal-line terminal-line-${line.kind}`} key={line.id}><code>{line.text || " "}</code></div>)}</div>
      <form className="terminal-command" onSubmit={(event: FormEvent<HTMLFormElement>) => void submit(event)}><span>$</span><input value={command} onChange={(event: ChangeEvent<HTMLInputElement>) => setCommand(event.target.value)} aria-label="Команда терминала" autoComplete="off" spellCheck={false} disabled={busy} /><button type="submit" aria-label="Выполнить команду" disabled={busy}>↵</button></form>
    </section>
  );
}

const BROWSER_HOME = "https://example.com/";
const initialBrowserState: EmbeddedBrowserState = { url: BROWSER_HOME, title: "Browser", loading: false, canGoBack: false, canGoForward: false, error: null };

function BrowserPane({ active, suspended }: { active: boolean; suspended: boolean }): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const [draftUrl, setDraftUrl] = useState(BROWSER_HOME);
  const [state, setState] = useState<EmbeddedBrowserState>(initialBrowserState);
  const urlRef = useRef(BROWSER_HOME);
  const live = active && !suspended;

  const bounds = useCallback((): EmbeddedBrowserBounds | null => {
    const element = hostRef.current;
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { visible: live, x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }, [live]);

  useEffect(() => api.browser.onState((next) => {
    setState(next);
    if (next.url) {
      urlRef.current = next.url;
      setDraftUrl(next.url);
    }
  }), []);

  useEffect(() => {
    const element = hostRef.current;
    if (!element || !live) {
      void api.browser.hide();
      return undefined;
    }
    const sync = () => {
      const nextBounds = bounds();
      if (nextBounds) void api.browser.setBounds(nextBounds);
    };
    const firstBounds = bounds();
    if (firstBounds) void api.browser.show(firstBounds, urlRef.current).then((next) => { urlRef.current = next.url; setState(next); }).catch((error) => setState((current) => ({ ...current, error: error instanceof Error ? error.message : String(error) })));
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(sync);
    observer?.observe(element);
    window.addEventListener("resize", sync);
    window.addEventListener("scroll", sync, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", sync);
      window.removeEventListener("scroll", sync, true);
      void api.browser.hide();
    };
  }, [bounds, live]);

  const navigate = async (event: FormEvent) => {
    event.preventDefault();
    const next = normalizeBrowserUrl(draftUrl);
    setDraftUrl(next);
    urlRef.current = next;
    try { setState(await api.browser.navigate(next)); }
    catch (error) { setState((current) => ({ ...current, error: error instanceof Error ? error.message : String(error) })); }
  };

  return (
    <section className="browser-pane" aria-label="Browser">
      <div className="browser-tabbar"><div className="browser-tab"><span>{state.loading ? "◌" : "◎"}</span><strong>{state.title || "Browser"}</strong></div></div>
      <form className="browser-toolbar" onSubmit={(event: FormEvent<HTMLFormElement>) => void navigate(event)}>
        <button type="button" aria-label="Назад" disabled={!state.canGoBack} onClick={() => void api.browser.back().then(setState)}>‹</button>
        <button type="button" aria-label="Вперёд" disabled={!state.canGoForward} onClick={() => void api.browser.forward().then(setState)}>›</button>
        <button type="button" aria-label="Обновить страницу" onClick={() => void api.browser.reload().then(setState)}>↻</button>
        <input aria-label="Адрес браузера" value={draftUrl} onChange={(event: ChangeEvent<HTMLInputElement>) => setDraftUrl(event.target.value)} autoComplete="off" spellCheck={false} />
      </form>
      <div ref={hostRef} className="browser-content" aria-label="Область страницы">
        {!isElectron ? <div className="browser-new-tab"><span className="browser-new-tab-mark">◎</span><strong>Chromium</strong><small>доступен в Electron-сборке</small></div> : null}
        {state.error ? <div className="browser-error" role="status">{state.error}</div> : null}
      </div>
    </section>
  );
}

function normalizeBrowserUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return BROWSER_HOME;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.includes(" ")) return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
  return `https://${trimmed}`;
}

function FilesPane({ files, onOpenFile }: { files: ProjectFileEntry[]; onOpenFile(path: string): void }): JSX.Element {
  const paths = files.filter((entry) => entry.kind === "file");
  return (
    <section className="files-pane">
      <nav aria-label="Файлы проекта">
        {paths.map((entry) => <button type="button" key={entry.path} aria-label={entry.path} onClick={() => onOpenFile(entry.path)}><span>{entry.path.endsWith(".md") ? "◇" : "□"}</span><span>{entry.path}</span></button>)}
        {!paths.length ? <p className="dim">Выберите проект, чтобы увидеть файлы.</p> : null}
      </nav>
      <section className="workbench-file" aria-label="Подсказка файлов"><header><span>Файлы проекта</span></header><p className="dim">Выберите файл слева — содержимое откроется в отдельном окне из реальной папки проекта.</p></section>
    </section>
  );
}
