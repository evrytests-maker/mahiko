import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type MouseEvent as ReactMouseEvent } from "react";
import type { ActivityRun, AgentStreamEvent, AppSettings, OmpInstallationSnapshot, OmpModel, OmpSessionState, OmpUiRequest, OmpUiResponse, ProjectFileEntry, ProjectFilePreview, RuntimeSnapshot } from "../shared/contracts";
import { api } from "./api";
import { applyAgentStreamEvent, createPreparingRun, nextActivityRunId } from "./activity";
import { ActivityStream } from "./components/ActivityStream";
import { FloatingWindow } from "./components/FloatingWindow";
import { Composer, MessageBlock, StartupTranscript, type ComposerOverlay, type ThinkingLevel, type TranscriptMessage } from "./components/OmpChrome";
import { OmpBootstrapOverlay, OmpSetupOverlay } from "./components/OmpPanels";
import { CommandPalette, SettingsOverlay } from "./components/Overlays";
import { CodingWorkbench, type WorkbenchTool } from "./components/CodingWorkbench";
import { ProjectsPage } from "./components/Pages";
import { TuiEscapeButton } from "./components/TuiControls";
import { OmpUiDialog, type InteractiveOmpUiRequest } from "./components/OmpUiDialog";

type TranscriptEntry = { type: "message"; message: TranscriptMessage } | { type: "activity"; run: ActivityRun };
type WindowKind = "projects" | "main" | "tree" | "file";

interface FloatingRecord { id: string; kind: WindowKind; title: string }

const NEAR_BOTTOM_THRESHOLD = 96;
const INTERACTIVE_CHAT_FOCUS_SELECTOR = [
  "button", "a", "input", "textarea", "select", "summary", "[contenteditable='true']",
  "[role='button']", "[role='dialog']", "[role='tab']", "[role='option']", "[role='treeitem']",
  ".composer-stack", ".workspace-header", ".environment-sidebar", ".coding-workbench", ".floating-window",
  ".omp-notice", ".new-events-button", "[data-no-chat-focus]",
].join(",");

export function isChatFocusBackground(target: EventTarget | null): target is HTMLElement {
  return target instanceof HTMLElement && !target.closest(INTERACTIVE_CHAT_FOCUS_SELECTOR);
}
function focusAfterFrame(selector: string): void {
  window.requestAnimationFrame(() => {
    if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
    document.querySelector<HTMLElement>(selector)?.focus();
  });
}

export function App(): JSX.Element {
  const [runtime, setRuntime] = useState<RuntimeSnapshot | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [files, setFiles] = useState<ProjectFileEntry[]>([]);
  const [activeFile, setActiveFile] = useState<ProjectFilePreview | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsDestination, setSettingsDestination] = useState<{ tab: string; section?: string }>({ tab: "Appearance" });
  const [runtimeSetupOpen, setRuntimeSetupOpen] = useState(false);
  const [installation, setInstallation] = useState<OmpInstallationSnapshot | null>(null);
  const [installationBusy, setInstallationBusy] = useState(false);
  const [installationError, setInstallationError] = useState("");
  const [setupOpen, setSetupOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [composerOverlay, setComposerOverlay] = useState<ComposerOverlay>(null);
  const [workbenchTool, setWorkbenchTool] = useState<WorkbenchTool>("terminal");
  const [workbenchVisible, setWorkbenchVisible] = useState(false);
  const [workbenchWidth, setWorkbenchWidth] = useState(600);
  const [models, setModels] = useState<OmpModel[]>([]);
  const [sessionState, setSessionState] = useState<OmpSessionState | null>(null);
  const [composer, setComposer] = useState("");
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [unseenEvents, setUnseenEvents] = useState(0);
  const [windows, setWindows] = useState<FloatingRecord[]>([]);
  const [uiNotice, setUiNotice] = useState<string | null>(null);
  const [ompUiRequest, setOmpUiRequest] = useState<InteractiveOmpUiRequest | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const mountedRef = useRef(true);
  const activeControllerRef = useRef<{ runId: string; controller: AbortController } | null>(null);
  const floatingOpenersRef = useRef<Map<string, HTMLElement>>(new Map());
  const working = activeRunId !== null;

  const openSettings = useCallback((tab = "Appearance", section?: string) => {
    setSettingsDestination({ tab, section });
    setSettingsOpen(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([api.settings.get(), api.runtime.getSnapshot(), api.project.listFiles()])
      .then(async ([nextSettings, nextRuntime, nextFiles]) => {
        if (cancelled) return;
        setSettings(nextSettings); setRuntime(nextRuntime); setFiles(nextFiles);
        setWorkbenchWidth(nextSettings.inspectorWidth === 460 ? 600 : nextSettings.inspectorWidth);
        document.documentElement.dataset.theme = nextSettings.theme;
        if (!nextSettings.runtimeSetupComplete) {
          const nextInstallation = await api.runtime.getInstallation();
          if (cancelled) return;
          setInstallation(nextInstallation);
          setRuntimeSetupOpen(true);
        } else if (!nextSettings.onboardingComplete) {
          setSetupOpen(true);
        }
      })
      .catch((error) => { if (!cancelled) setUiNotice(messageOf(error)); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!runtime?.rpc.ready || !runtime.compatible) { setModels([]); setSessionState(null); return undefined; }
    let cancelled = false;
    void Promise.all([api.omp.getModels(), api.omp.getState()])
      .then(([nextModels, nextState]) => { if (!cancelled) { setModels(nextModels); setSessionState(nextState); } })
      .catch((error) => { if (!cancelled) setUiNotice(messageOf(error)); });
    return () => { cancelled = true; };
  }, [runtime]);

  useEffect(() => api.omp.onUiRequest((request: OmpUiRequest) => {
    if (request.type === "select" || request.type === "input" || request.type === "editor" || request.type === "confirm") {
      setOmpUiRequest(request);
      return;
    }
    if (request.type === "cancel") {
      setOmpUiRequest((current) => current?.id === request.targetId ? null : current);
      return;
    }
    if (request.type === "editor_text") { setComposer(request.text); return; }
    if (request.type === "title") { document.title = request.title || "mahiko"; return; }
    if (request.type === "notify") { setUiNotice(request.message); return; }
    if (request.type === "status" && request.text) { setUiNotice(request.text); return; }
    if (request.type === "widget" && request.lines?.length) { setUiNotice(request.lines.join(" · ")); return; }
    if (request.type === "open_url") setUiNotice(request.instructions || "OMP открыл защищённую страницу входа в системном браузере.");
  }), []);

  const respondToOmpUi = useCallback((response: OmpUiResponse) => {
    setOmpUiRequest(null);
    void api.omp.respondUi(response).catch((error) => setUiNotice(messageOf(error)));
  }, []);

  useEffect(() => {
    if (!settings || settings.inspectorWidth === workbenchWidth) return undefined;
    const timer = window.setTimeout(() => {
      void api.settings.update({ inspectorWidth: workbenchWidth }).then(setSettings);
    }, 240);
    return () => window.clearTimeout(timer);
  }, [settings, workbenchWidth]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; activeControllerRef.current?.controller.abort(); };
  }, []);

  useEffect(() => {
    if (!entries.length) return undefined;
    const transcript = transcriptRef.current;
    if (!transcript) return undefined;
    if (!nearBottomRef.current) { setUnseenEvents((count) => Math.min(99, count + 1)); return undefined; }
    const frame = window.requestAnimationFrame(() => { transcript.scrollTo({ top: transcript.scrollHeight, behavior: "auto" }); setUnseenEvents(0); });
    return () => window.cancelAnimationFrame(frame);
  }, [entries]);

  const updateScrollPosition = useCallback(() => {
    const transcript = transcriptRef.current; if (!transcript) return;
    const nearBottom = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight <= NEAR_BOTTOM_THRESHOLD;
    nearBottomRef.current = nearBottom; if (nearBottom) setUnseenEvents(0);
  }, []);
  const scrollToLatest = useCallback(() => { const transcript = transcriptRef.current; if (!transcript) return; nearBottomRef.current = true; transcript.scrollTo({ top: transcript.scrollHeight, behavior: "auto" }); setUnseenEvents(0); }, []);

  const updateSettings = useCallback(async (patch: Partial<AppSettings>) => {
    setSettings((current) => current ? { ...current, ...patch } : current);
    const next = await api.settings.update(patch);
    setSettings(next);
    document.documentElement.dataset.theme = next.theme;
  }, []);

  const closeSetup = useCallback(() => {
    if (settings?.onboardingComplete !== false) {
      setSetupOpen(false);
      return;
    }
    void updateSettings({ onboardingComplete: true })
      .then(() => setSetupOpen(false))
      .catch((error) => setUiNotice(`Не удалось сохранить первоначальную настройку: ${messageOf(error)}`));
  }, [settings?.onboardingComplete, updateSettings]);

  const installBundledOmp = useCallback(() => {
    if (installationBusy) return;
    setInstallationBusy(true);
    setInstallationError("");
    void api.runtime.installBundled()
      .then(async (nextInstallation) => {
        const [nextSettings, nextRuntime] = await Promise.all([api.settings.get(), api.runtime.refresh()]);
        setInstallation(nextInstallation);
        setSettings(nextSettings);
        setRuntime(nextRuntime);
        setRuntimeSetupOpen(false);
        setSetupOpen(true);
      })
      .catch((error) => setInstallationError(messageOf(error)))
      .finally(() => setInstallationBusy(false));
  }, [installationBusy]);

  const refreshRuntime = useCallback(async () => {
    const next = await api.runtime.refresh();
    setRuntime(next);
    setUiNotice("Состояние OMP обновлено.");
  }, []);

  const selectModel = useCallback(async (model: OmpModel) => {
    setSessionState((current) => current ? { ...current, model } : current);
    setUiNotice(`Переключение на ${model.name}…`);
    try {
      const selected = await api.omp.setModel(model.provider, model.id);
      setSessionState((current) => current ? { ...current, model: selected } : current);
      setUiNotice(`Модель: ${selected.name}`);
    } catch (error) {
      try { setSessionState(await api.omp.getState()); } catch { /* Keep the last observed state when OMP is unavailable. */ }
      setUiNotice(`Не удалось переключить модель: ${messageOf(error)}`);
      throw error;
    }
  }, []);

  const selectThinking = useCallback(async (level: ThinkingLevel) => {
    await api.omp.setThinkingLevel(level);
    const observed = await api.omp.getState();
    // OMP get_state exposes auto's concrete provisional effort. Preserve the
    // successfully selected `auto` label in this renderer until the next
    // external refresh while OMP continues to resolve each turn itself.
    setSessionState(observed && level === "auto" ? { ...observed, thinkingLevel: "auto" } : observed);
  }, []);

  const toggleAutoCompact = useCallback(async (enabled: boolean) => {
    await api.omp.setAutoCompaction(enabled);
    setSessionState(await api.omp.getState());
  }, []);

  const compactNow = useCallback(async () => {
    const result = await api.omp.compact();
    setUiNotice(result.message);
    setSessionState(await api.omp.getState());
  }, []);

  const chooseProject = useCallback(async () => {
    const path = await api.project.choose(); if (!path) return;
    const [nextSettings, nextRuntime, nextFiles] = await Promise.all([api.settings.get(), api.runtime.refresh(), api.project.listFiles()]);
    setSettings(nextSettings); setRuntime(nextRuntime); setFiles(nextFiles); setActiveFile(null);
  }, []);

  const openFloating = useCallback((kind: WindowKind, title?: string) => {
    const id = kind === "file" ? `file:${title ?? "preview"}` : kind;
    const opener = document.activeElement;
    if (opener instanceof HTMLElement) floatingOpenersRef.current.set(id, opener);
    setWindows((current) => {
      const existing = current.find((item) => item.id === id);
      const next = current.filter((item) => item.id !== id);
      return [...next, existing ?? { id, kind, title: title ?? floatingTitle(kind) }];
    });
  }, []);
  const closeFloating = useCallback((id: string) => {
    setWindows((current) => current.filter((item) => item.id !== id));
    const opener = floatingOpenersRef.current.get(id);
    floatingOpenersRef.current.delete(id);
    window.requestAnimationFrame(() => {
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      if (opener?.isConnected) opener.focus();
      else document.querySelector<HTMLElement>('[aria-label="Сообщение mahiko"]')?.focus();
    });
  }, []);
  const activateFloating = useCallback((id: string) => setWindows((current) => {
    const item = current.find((record) => record.id === id); if (!item || current[current.length - 1]?.id === id) return current;
    return [...current.filter((record) => record.id !== id), item];
  }), []);

  const openFile = useCallback(async (path: string) => {
    setFileLoading(true);
    try { const file = await api.project.readFile(path); setActiveFile(file); openFloating("file", path); }
    catch (error) { const file = { path, content: messageOf(error), truncated: false }; setActiveFile(file); openFloating("file", path); }
    finally { setFileLoading(false); }
  }, [openFloating]);

  const executePrompt = useCallback(async (prompt: string, attempt = 0, retryRunId?: string) => {
    if (activeControllerRef.current) return;
    const runId = retryRunId ?? nextActivityRunId(); const controller = new AbortController(); const startedAt = Date.now();
    const preparingRun = createPreparingRun(runId, prompt, attempt, startedAt);
    activeControllerRef.current = { runId, controller }; setActiveRunId(runId);
    setEntries((current) => retryRunId
      ? current.map((entry) => entry.type === "activity" && entry.run.id === runId ? { type: "activity", run: preparingRun } : entry)
      : [...current, { type: "message", message: { id: `${runId}:user`, role: "user", text: prompt } }, { type: "activity", run: preparingRun }]);
    const answerId = `${runId}:assistant:${attempt}`;
    const onStreamEvent = (event: AgentStreamEvent) => {
      if (!mountedRef.current || event.runId !== runId) return;
      if (controller.signal.aborted && (event.type === "text_delta" || event.type === "thinking_start" || event.type === "thinking_delta" || event.type === "thinking_end" || event.type === "completed")) return;
      setEntries((current) => {
        let next = current.map((entry) => entry.type === "activity" && entry.run.id === runId
          ? { type: "activity" as const, run: applyAgentStreamEvent(entry.run, event) }
          : entry);
        if (event.type === "text_delta") {
          const existing = next.some((entry) => entry.type === "message" && entry.message.id === answerId);
          next = existing
            ? next.map((entry) => entry.type === "message" && entry.message.id === answerId ? { type: "message" as const, message: { ...entry.message, text: entry.message.text + event.delta } } : entry)
            : [...next, { type: "message" as const, message: { id: answerId, role: "assistant", text: event.delta } }];
        } else if (event.type === "completed") {
          const existing = next.some((entry) => entry.type === "message" && entry.message.id === answerId);
          next = existing
            ? next.map((entry) => entry.type === "message" && entry.message.id === answerId ? { type: "message" as const, message: { ...entry.message, text: event.text } } : entry)
            : [...next, { type: "message" as const, message: { id: answerId, role: "assistant", text: event.text } }];
        }
        return next;
      });
      if (event.type === "notice" && event.level !== "info") setUiNotice(event.message);
    };
    const removeStreamListener = api.agent.onEvent(onStreamEvent);
    const requestCancel = () => {
      void api.agent.cancel(runId).then((result) => { if (!result.ok && mountedRef.current) setUiNotice(result.message); }).catch((error) => { if (mountedRef.current) setUiNotice(messageOf(error)); });
    };
    controller.signal.addEventListener("abort", requestCancel, { once: true });
    try {
      const result = await api.agent.run(prompt, runId);
      if (controller.signal.aborted || result.cancelled) onStreamEvent({ runId, type: "cancelled" });
      else onStreamEvent({ runId, type: "completed", text: result.text, observedEventTypes: result.observedEventTypes });
    } catch (error) {
      onStreamEvent(controller.signal.aborted ? { runId, type: "cancelled" } : { runId, type: "error", message: messageOf(error) });
      if (!controller.signal.aborted) setUiNotice(messageOf(error));
    } finally {
      controller.signal.removeEventListener("abort", requestCancel);
      removeStreamListener();
      if (activeControllerRef.current?.controller === controller) { activeControllerRef.current = null; if (mountedRef.current) setActiveRunId(null); }
    }
  }, []);

  const submitPrompt = useCallback(() => { const prompt = composer.trim(); if (!prompt || activeControllerRef.current || !runtime?.rpc.ready || !runtime.compatible) return; setComposer(""); setComposerOverlay(null); void executePrompt(prompt); }, [composer, executePrompt, runtime]);
  const retryRun = useCallback((run: ActivityRun) => { if (!activeControllerRef.current) void executePrompt(run.prompt, run.attempt + 1, run.id); }, [executePrompt]);

  const openWorkbench = useCallback((tool: WorkbenchTool = "terminal") => {
    setWorkbenchTool(tool);
    setWorkbenchVisible(true);
  }, []);

  const handleCommand = useCallback((command: string) => {
    setPaletteOpen(false); setComposer("");
    if (command.startsWith("/models")) setComposerOverlay("model");
    else if (command.startsWith("/settings")) openSettings();
    else if (command.startsWith("/session") || command.startsWith("/context")) openWorkbench("files");
    else if (command.startsWith("/compact")) setComposerOverlay("context");
    else if (command.startsWith("/login")) setSetupOpen(true);
    else if (command.startsWith("/tools")) openWorkbench("terminal");
  }, [openFloating, openSettings, openWorkbench]);

  useEffect(() => {
    const listener = (event: globalThis.KeyboardEvent) => {
      if (runtimeSetupOpen && event.key === "Escape") { event.preventDefault(); void api.application.quit(); return; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setPaletteOpen(true); return; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "b" && !event.shiftKey) { event.preventDefault(); if (settings) void updateSettings({ navVisible: !settings.navVisible }); return; }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "b") { event.preventDefault(); setWorkbenchVisible((visible) => !visible); return; }
      if ((event.ctrlKey || event.metaKey) && event.key === ",") { event.preventDefault(); openSettings(); return; }
      if (event.defaultPrevented || event.key !== "Escape" || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      if (paletteOpen) { event.preventDefault(); setPaletteOpen(false); focusAfterFrame('[aria-label="Открыть команды"]'); return; }
      if (setupOpen) { event.preventDefault(); closeSetup(); focusAfterFrame("#environment-trigger"); return; }
      if (activeControllerRef.current) { event.preventDefault(); activeControllerRef.current.controller.abort(); return; }
      if (composerOverlay) { event.preventDefault(); const trigger = composerOverlay === "model" ? "#model-picker-trigger" : composerOverlay === "reasoning" ? "#reasoning-picker-trigger" : "#compact-picker-trigger"; setComposerOverlay(null); focusAfterFrame(trigger); return; }
      if (settings?.navVisible) { event.preventDefault(); void updateSettings({ navVisible: false }); focusAfterFrame("#environment-trigger"); return; }
      const top = windows[windows.length - 1]; if (top) { event.preventDefault(); closeFloating(top.id); return; }
      if (workbenchVisible) { event.preventDefault(); setWorkbenchVisible(false); focusAfterFrame('[aria-label="Показать Coding Workbench"]'); }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [closeFloating, closeSetup, composerOverlay, openSettings, paletteOpen, runtimeSetupOpen, settings, setupOpen, updateSettings, windows, workbenchVisible]);

  const showNav = settings?.navVisible ?? false;
  const showWorkbench = workbenchVisible;
  const projectName = settings?.projectPath.split(/[\\/]/).filter(Boolean).pop() ?? "проект не выбран";

  useEffect(() => {
    if (!showNav) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (document.getElementById("environment-panel")?.contains(target) || document.getElementById("environment-trigger")?.contains(target)) return;
      void updateSettings({ navVisible: false });
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [showNav, updateSettings]);

  const focusComposerFromBackground = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.button !== 0 || settingsOpen || runtimeSetupOpen || setupOpen || paletteOpen || composerOverlay || windows.length) return;
    if (!isChatFocusBackground(event.target)) return;
    if (window.getSelection()?.toString()) return;
    window.requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[aria-label="Сообщение mahiko"]')?.focus({ preventScroll: true }));
  }, [composerOverlay, paletteOpen, runtimeSetupOpen, settingsOpen, setupOpen, windows.length]);


  return (
    <div className="app-shell minimal-shell" onClick={focusComposerFromBackground}>
      <a className="skip-link" href="#main-workspace">Перейти к чату</a>
      <main id="main-workspace" className={`desktop-layout${showWorkbench ? " has-workbench" : ""}`}>
        {showNav ? <EnvironmentSidebar files={files} projectName={projectName} runtime={runtime} onClose={() => void updateSettings({ navVisible: false })} onChooseProject={chooseProject} onOpenFile={openFile} onOpenSettings={openSettings} onOpenSetup={() => setSetupOpen(true)} onOpenWindow={openFloating} onOpenWorkbench={openWorkbench} /> : null}
        <section className="workspace-main minimal-workspace">
          <header className="workspace-header">
            <div className="workspace-leading">
              <button id="environment-trigger" className="topbar-icon-button" aria-label="Показать боковую панель" aria-controls="environment-panel" aria-expanded={showNav} title="Среда" onClick={() => void updateSettings({ navVisible: !showNav })}><UiIcon name="menu" /></button>
              <button className="workspace-project" aria-label={`Выбрать проект. Текущий: ${projectName}`} onClick={chooseProject}><UiIcon name="folder" /><span>{projectName}</span></button>
            </div>
            <div className="workspace-actions">
              <button className={`runtime-state ${runtime?.rpc.ready ? "success" : "warning"}`} aria-label="Обновить состояние OMP" title="Обновить OMP" onClick={() => void refreshRuntime()}><span aria-hidden="true">{runtime?.rpc.ready ? "●" : "○"}</span><span>OMP</span></button>
              <span className="topbar-divider" aria-hidden="true" />
              <button className="topbar-icon-button" aria-label="Открыть команды" title="Команды · Ctrl+K" onClick={() => setPaletteOpen(true)}><UiIcon name="command" /></button>
              <button className="topbar-icon-button" aria-label="Показать Coding Workbench" aria-controls="coding-workbench" aria-expanded={showWorkbench} title="Рабочая панель · Ctrl+Shift+B" onClick={() => setWorkbenchVisible((visible) => !visible)}><UiIcon name="panel" /></button>
            </div>
          </header>
          <div className="workspace-content chat-only-workspace">
            <div className="session-workspace minimal-session">
              <div className="transcript" ref={transcriptRef} onScroll={updateScrollPosition} aria-busy={working} aria-label="Транскрипт сессии"><div className="transcript-inner">{entries.length ? null : <StartupTranscript runtime={runtime} projectName={projectName} />}{entries.map((entry) => entry.type === "message" ? <MessageBlock key={entry.message.id} message={entry.message} /> : <ActivityStream key={entry.run.id} run={entry.run} onStop={() => activeControllerRef.current?.controller.abort()} onRetry={retryRun} />)}</div></div>
              {unseenEvents ? <button type="button" className="new-events-button" onClick={scrollToLatest}>↓ К новым событиям · {unseenEvents}</button> : null}
              {uiNotice ? <button type="button" className="omp-notice" aria-label="Закрыть уведомление" onClick={() => setUiNotice(null)}><span>OMP</span>{uiNotice}<em>×</em></button> : null}
              <Composer value={composer} onChange={setComposer} onSubmit={submitPrompt} working={working} projectName={projectName} runtime={runtime} sessionState={sessionState} models={models} onCommand={handleCommand} overlay={composerOverlay} onOverlayChange={setComposerOverlay} onSelectModel={selectModel} onSelectThinking={selectThinking} onToggleAutoCompact={toggleAutoCompact} onCompactNow={compactNow} onChooseProject={chooseProject} onRefreshRuntime={refreshRuntime} />
            </div>
          </div>
        </section>
        {showWorkbench ? <CodingWorkbench activeTool={workbenchTool} onToolChange={setWorkbenchTool} onClose={() => setWorkbenchVisible(false)} projectName={projectName} runtime={runtime} files={files} onOpenFile={openFile} width={workbenchWidth} onWidthChange={setWorkbenchWidth} browserSuspended={settingsOpen || runtimeSetupOpen || setupOpen || paletteOpen || Boolean(composerOverlay) || Boolean(ompUiRequest) || windows.length > 0} /> : null}
        <div className="floating-layer" aria-label="Рабочие окна">
          {windows.map((record, index) => { const size = floatingSize(record.kind); return <FloatingWindow key={record.id} id={record.id.replace(/[^a-z0-9_-]/gi, "-")} title={record.title} zIndex={50 + index} initialPosition={initialPosition(record.kind, index)} width={size.width} height={size.height} onActivate={() => activateFloating(record.id)} onClose={() => closeFloating(record.id)}>{renderFloatingBody(record, { settings, runtime, files, activeFile, fileLoading, chooseProject, openFile })}</FloatingWindow>; })}
        </div>
      </main>
      {runtimeSetupOpen ? <OmpBootstrapOverlay snapshot={installation} busy={installationBusy} error={installationError} onInstall={installBundledOmp} onExit={() => void api.application.quit()} /> : null}
      {settingsOpen ? <SettingsOverlay settings={settings} initialTab={settingsDestination.tab} initialSection={settingsDestination.section} onUpdate={updateSettings} onClose={() => setSettingsOpen(false)} /> : null}
      {setupOpen ? <OmpSetupOverlay runtime={runtime} onClose={closeSetup} onComplete={closeSetup} /> : null}
      {paletteOpen ? <CommandPalette onClose={() => setPaletteOpen(false)} onCommand={handleCommand} /> : null}
      {ompUiRequest ? <OmpUiDialog request={ompUiRequest} onRespond={respondToOmpUi} onEscape={() => activeControllerRef.current?.controller.abort()} /> : null}
    </div>
  );
}

function EnvironmentSidebar({ files, projectName, runtime, onClose, onChooseProject, onOpenFile, onOpenSettings, onOpenSetup, onOpenWindow, onOpenWorkbench }: { files: ProjectFileEntry[]; projectName: string; runtime: RuntimeSnapshot | null; onClose(): void; onChooseProject(): void; onOpenFile(path: string): void; onOpenSettings(tab?: string, section?: string): void; onOpenSetup(): void; onOpenWindow(kind: WindowKind, title?: string): void; onOpenWorkbench(tool: WorkbenchTool): void }): JSX.Element {
  const [showFiles, setShowFiles] = useState(false);
  const openWindow = (kind: WindowKind, title?: string) => { onOpenWindow(kind, title); onClose(); };
  const openSettings = (tab = "Appearance", section?: string) => { onOpenSettings(tab, section); onClose(); };
  const fileRows = files.filter((entry) => entry.kind === "file").slice(0, 8);
  return (
    <aside id="environment-panel" className="app-sidebar environment-sidebar environment-sidebar-tall" aria-label="Панель среды">
      <div className="environment-title">
        <div><strong>Среда</strong><span className={runtime?.rpc.ready ? "success" : "dim"}>{runtime?.rpc.ready ? "● OMP" : "○ offline"}</span></div>
        <TuiEscapeButton label="Скрыть панель среды" onClick={onClose} />
      </div>
      <nav className="environment-nav" aria-label="Основная навигация">
        <button type="button" className="environment-nav-row active" onClick={onClose}><UiIcon name="chat" /><span>Чат</span><kbd>1</kbd></button>
        <button type="button" className="environment-nav-row" onClick={() => openWindow("projects")}><UiIcon name="projects" /><span>Проекты</span></button>
        <button type="button" className="environment-nav-row" disabled title="Git diff не предоставляется OMP RPC 17.2.9"><UiIcon name="diff" /><span>Изменения</span></button>
        <button type="button" className="environment-nav-row" disabled title="Управление MCP не предоставляется OMP RPC 17.2.9"><UiIcon name="plug" /><span>/MCP</span></button>
        <button type="button" className="environment-nav-row" disabled title="Установка скиллов не поддерживается этим RPC-контрактом"><UiIcon name="spark" /><span>Скиллы</span></button>
        <button type="button" className="environment-nav-row" disabled title="Управление субагентами не предоставляется OMP RPC 17.2.9"><UiIcon name="agents" /><span>Субагенты</span></button>
      </nav>
      <section className="environment-project-section" aria-label="Текущий проект">
        <header><span>Проект</span><button type="button" className="project-inline-action" aria-label="Выбрать папку проекта" onClick={onChooseProject}><UiIcon name="folderPlus" /></button></header>
        <button type="button" className="environment-project-current" onClick={() => openWindow("projects")}><UiIcon name="folder" /><span><strong>{projectName}</strong><small>{files.length ? `${files.length} элементов` : "папка не выбрана"}</small></span><UiIcon name="chevron" /></button>
        <div className="environment-project-tools">
          <button type="button" onClick={() => openWindow("main")}><UiIcon name="branch" /><span>Локальный / main</span></button>
          <button type="button" onClick={() => openWindow("tree")}><UiIcon name="tree" /><span>Дерево проекта</span></button>
          <button type="button" aria-expanded={showFiles} onClick={() => setShowFiles((value) => !value)}><UiIcon name="file" /><span>Файлы</span><small>{fileRows.length}</small></button>
        </div>
        {showFiles ? <div className="quick-files" aria-label="Быстрые файлы">{fileRows.map((entry) => <button type="button" key={entry.path} onClick={() => { onOpenFile(entry.path); onClose(); }}><UiIcon name="file" /><span>{entry.path}</span></button>)}{!fileRows.length ? <p>Выберите папку проекта.</p> : null}</div> : null}
      </section>
      <div className="environment-footer-v2">
        <button id="settings-trigger" type="button" aria-label="Настройки OMP" title="Настройки OMP · Ctrl+," onClick={() => openSettings()}><UiIcon name="settings" /><span>Настройки</span></button>
        <button type="button" aria-label="Подключения OMP" title="Подключения OMP" onClick={() => { onOpenSetup(); onClose(); }}><UiIcon name="connection" /><span>Подключения</span></button>
        <span className={runtime?.rpc.ready ? "success" : "warning"} aria-label={runtime?.rpc.ready ? "OMP подключён" : "OMP offline"}>{runtime?.rpc.ready ? "●" : "○"}</span>
      </div>
    </aside>
  );
}

function renderFloatingBody(record: FloatingRecord, context: { settings: AppSettings | null; runtime: RuntimeSnapshot | null; files: ProjectFileEntry[]; activeFile: ProjectFilePreview | null; fileLoading: boolean; chooseProject(): void; openFile(path: string): void }): JSX.Element {
  switch (record.kind) {
    case "projects": return <ProjectsPage settings={context.settings} files={context.files} onChoose={context.chooseProject} onOpenFile={context.openFile} />;
    case "main": return <MainSurface runtime={context.runtime} settings={context.settings} />;
    case "tree": return <TreeSurface files={context.files} onOpenFile={context.openFile} />;
    case "file": return context.activeFile ? <FileViewer file={context.activeFile} loading={context.fileLoading} /> : <p className="dim">Файл не выбран.</p>;
  }
}

type UiIconName = "menu" | "folder" | "command" | "panel" | "chat" | "projects" | "diff" | "plug" | "spark" | "agents" | "folderPlus" | "chevron" | "branch" | "tree" | "file" | "settings" | "connection";

function UiIcon({ name }: { name: UiIconName }): JSX.Element {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  let content: JSX.Element;
  switch (name) {
    case "menu": content = <><path {...common} d="M3 4.5h10M3 8h10M3 11.5h10" /></>; break;
    case "folder": content = <path {...common} d="M2.5 5.2h4l1.2-1.7h5.8v8.8h-11z" />; break;
    case "folderPlus": content = <><path {...common} d="M2.5 5.2h4l1.2-1.7h5.8v8.8h-11z" /><path {...common} d="M8 7v3M6.5 8.5h3" /></>; break;
    case "command": content = <><path {...common} d="M5.4 5.4H4.3a2 2 0 1 1 2-2v9.2a2 2 0 1 1-2-2h7.4a2 2 0 1 1-2 2V3.4a2 2 0 1 1 2 2z" /></>; break;
    case "panel": content = <><rect {...common} x="2.5" y="2.5" width="11" height="11" rx="1.2" /><path {...common} d="M9.5 2.5v11" /></>; break;
    case "chat": content = <path {...common} d="M3 3.5h10v7H7l-3.5 2v-2H3z" />; break;
    case "projects": content = <><path {...common} d="M2.5 5h4l1-1.5h6v8.8h-11z" /><path {...common} d="M4.5 7.2h7" /></>; break;
    case "diff": content = <><path {...common} d="M5 3v10M3 5l2-2 2 2M11 13V3M9 11l2 2 2-2" /></>; break;
    case "plug": content = <><path {...common} d="M5 3v3M11 3v3M4 6h8v1.5A4 4 0 0 1 8 11.5V14" /></>; break;
    case "spark": content = <path {...common} d="m8 2 1.2 3.8L13 7l-3.8 1.2L8 12l-1.2-3.8L3 7l3.8-1.2z" />; break;
    case "agents": content = <><circle {...common} cx="6" cy="5.2" r="2" /><circle {...common} cx="11.2" cy="6" r="1.5" /><path {...common} d="M2.8 12c.5-2.2 1.8-3.3 3.8-3.3S10 9.8 10.4 12M9.5 9.2c1.8-.3 3 .6 3.7 2.4" /></>; break;
    case "chevron": content = <path {...common} d="m6 3.5 4 4.5-4 4.5" />; break;
    case "branch": content = <><circle {...common} cx="4" cy="3.5" r="1.2" /><circle {...common} cx="11.5" cy="4.5" r="1.2" /><circle {...common} cx="4" cy="12.5" r="1.2" /><path {...common} d="M4 4.7v6.6M5.2 7.5h2.5a3.8 3.8 0 0 0 3.8-1.8" /></>; break;
    case "tree": content = <><path {...common} d="M4 3v10M4 6h4M4 10h4" /><circle {...common} cx="9.5" cy="6" r="1.3" /><circle {...common} cx="9.5" cy="10" r="1.3" /></>; break;
    case "file": content = <><path {...common} d="M4 2.5h5l3 3v8H4z" /><path {...common} d="M9 2.5v3h3" /></>; break;
    case "settings": content = <><circle {...common} cx="8" cy="8" r="2.3" /><path {...common} d="M8 2.5v1.2M8 12.3v1.2M2.5 8h1.2M12.3 8h1.2M4.1 4.1l.9.9M11 11l.9.9M11.9 4.1l-.9.9M5 11l-.9.9" /></>; break;
    case "connection": content = <><path {...common} d="M6 5.5 4.3 3.8M10 5.5l1.7-1.7M5.3 10.7l-2 2M10.7 10.7l2 2" /><path {...common} d="M5.3 6.2a3.8 3.8 0 0 0 5.4 5.4M10.7 6.2a3.8 3.8 0 0 0-5.4 5.4" /></>; break;
    default: content = <path {...common} d="M3 8h10" />;
  }
  return <svg className="ui-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">{content}</svg>;
}

function MainSurface({ runtime, settings }: { runtime: RuntimeSnapshot | null; settings: AppSettings | null }): JSX.Element { return <div className="main-surface"><dl><dt>Проект</dt><dd>{settings?.projectPath || "не выбран"}</dd><dt>Ветка</dt><dd title="Не предоставляется используемым OMP RPC state">—</dd><dt>OMP</dt><dd>{runtime?.version ?? "—"}</dd><dt>RPC</dt><dd className={runtime?.rpc.ready && runtime.compatible ? "success" : "warning"}>{runtime?.rpc.ready && runtime.compatible ? runtime.rpc.mode ?? "ready" : "offline"}</dd></dl></div>; }
function TreeSurface({ files, onOpenFile }: { files: ProjectFileEntry[]; onOpenFile(path: string): void }): JSX.Element { return <div className="floating-tree" role="tree" aria-label="Дерево проекта">{files.map((entry) => entry.kind === "directory" ? <div key={entry.path} role="treeitem" aria-level={entry.depth + 1} className="tree-directory" style={{ paddingLeft: 8 + entry.depth * 13 }}><span>▾</span>{entry.name}</div> : <button key={entry.path} role="treeitem" aria-level={entry.depth + 1} style={{ paddingLeft: 8 + entry.depth * 13 }} onClick={() => onOpenFile(entry.path)}><span>□</span>{entry.name}</button>)}{!files.length ? <p className="dim">Выберите проект.</p> : null}</div>; }
function FileViewer({ file, loading }: { file: ProjectFilePreview; loading: boolean }): JSX.Element { return <section className="file-viewer floating-file" aria-label={`Файл ${file.path}`}><header><span>{file.path}</span>{file.truncated ? <em>первые 128 КБ</em> : null}</header><div className="file-code" aria-busy={loading}>{file.content.split("\n").map((line, index) => <div className="code-line" key={`${index}-${line.slice(0, 8)}`}><span>{index + 1}</span><code>{line || " "}</code></div>)}</div></section>; }

function initialPosition(kind: WindowKind, index: number): { x: number; y: number } { const base: Record<WindowKind, [number, number]> = { projects: [110, 92], main: [520, 92], tree: [180, 180], file: [270, 150] }; const point = base[kind]; return { x: point[0] + (index % 3) * 12, y: point[1] + (index % 3) * 10 }; }
function floatingTitle(kind: WindowKind): string { return ({ projects: "Проект", main: "Локальный / main", tree: "Дерево проекта", file: "Файл" } satisfies Record<WindowKind, string>)[kind]; }
function floatingSize(kind: WindowKind): { width: number; height: number } {
  if (kind === "projects") return { width: 720, height: 560 };
  if (kind === "file") return { width: 720, height: 590 };
  return { width: 560, height: 500 };
}
function messageOf(error: unknown): string { return error instanceof Error ? error.message : String(error); }
