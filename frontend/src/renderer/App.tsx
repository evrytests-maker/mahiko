import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type JSX } from "react";
import type {
  ActivityRun,
  AppSettings,
  ProjectFileEntry,
  ProjectFilePreview,
  RuntimeSnapshot,
  ThinkingLevel,
} from "../shared/contracts";
import { api } from "./api";
import {
  cancelActivityRun,
  createActivityRun,
  createFailedRun,
  createPreparingRun,
  executeActivityRun,
  nextActivityRunId,
} from "./activity";
import { navigation } from "./data";
import { ActivityStream } from "./components/ActivityStream";
import { CommandPalette, SettingsOverlay } from "./components/Overlays";
import { AccountsPage, AppSettingsPage, McpPage, MemoryPage, ProjectsPage, SkillsPage, ToolsPage } from "./components/Pages";
import { Composer, MessageBlock, PiMark, StartupTranscript, type TranscriptMessage } from "./components/OmpChrome";

type SectionName = (typeof navigation)[number][0];
type WorkspaceView = SectionName | "Changes" | "Tasks" | "Использование" | "История изменений";
type AttachedTool = "branch" | "files" | "pull-request";
type TranscriptEntry =
  | { type: "message"; message: TranscriptMessage }
  | { type: "activity"; run: ActivityRun };

type EntriesUpdater = TranscriptEntry[] | ((current: TranscriptEntry[]) => TranscriptEntry[]);

interface ChatSummary {
  id: string;
  title: string;
  meta: string;
}

const NEAR_BOTTOM_THRESHOLD = 96;
const initialChats: ChatSummary[] = [
  { id: "workspace", title: "Рабочая сессия", meta: "сейчас" },
  { id: "activity-ui", title: "Activity / thinking UI", meta: "сегодня" },
  { id: "omp-shell", title: "Интеграция OMP shell", meta: "вчера" },
];
const initialChatId = initialChats[0]?.id ?? "workspace";

function focusAfterFrame(selector: string): void {
  window.requestAnimationFrame(() => {
    if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
    document.querySelector<HTMLElement>(selector)?.focus();
  });
}

export function App(): JSX.Element {
  const [active, setActive] = useState<WorkspaceView>("Sessions");
  const [runtime, setRuntime] = useState<RuntimeSnapshot | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [compactLayout, setCompactLayout] = useState(() => window.matchMedia("(max-width: 1180px)").matches);
  const [files, setFiles] = useState<ProjectFileEntry[]>([]);
  const [activeFile, setActiveFile] = useState<ProjectFilePreview | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState("GPT-5.6 Sol");
  const [selectedModelKey, setSelectedModelKey] = useState("a6api:gpt-5.6-sol");
  const [selectedThinking, setSelectedThinking] = useState<ThinkingLevel>("xhigh");
  const [contextCompact, setContextCompact] = useState(false);
  const [composer, setComposer] = useState("");
  const [chats, setChats] = useState<ChatSummary[]>(initialChats);
  const [activeChatId, setActiveChatId] = useState(initialChatId);
  const [entriesByChat, setEntriesByChat] = useState<Record<string, TranscriptEntry[]>>(() => Object.fromEntries(initialChats.map((chat) => [chat.id, []])));
  const [attachedTool, setAttachedTool] = useState<AttachedTool | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [unseenEvents, setUnseenEvents] = useState(0);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const mountedRef = useRef(true);
  const activeControllerRef = useRef<{ runId: string; controller: AbortController } | null>(null);
  const entries = entriesByChat[activeChatId] ?? [];
  const working = activeRunId !== null;

  const updateEntries = useCallback((updater: EntriesUpdater) => {
    setEntriesByChat((current) => {
      const activeEntries = current[activeChatId] ?? [];
      const nextEntries = typeof updater === "function" ? updater(activeEntries) : updater;
      return { ...current, [activeChatId]: nextEntries };
    });
  }, [activeChatId]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([api.settings.get(), api.runtime.getSnapshot(), api.project.listFiles()]).then(([nextSettings, nextRuntime, nextFiles]) => {
      if (cancelled) return;
      setSettings(nextSettings);
      setRuntime(nextRuntime);
      setFiles(nextFiles);
      setSelectedThinking(nextRuntime.thinking.defaultLevel);
      document.documentElement.dataset.theme = nextSettings.theme;
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      activeControllerRef.current?.controller.abort();
    };
  }, []);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 1180px)");
    const update = () => setCompactLayout(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!entries.length) return undefined;
    const transcript = transcriptRef.current;
    if (!transcript) return undefined;
    if (!nearBottomRef.current) {
      setUnseenEvents((count) => Math.min(99, count + 1));
      return undefined;
    }
    const frame = window.requestAnimationFrame(() => {
      transcript.scrollTo({ top: transcript.scrollHeight, behavior: "auto" });
      setUnseenEvents(0);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [entries]);

  const updateScrollPosition = useCallback(() => {
    const transcript = transcriptRef.current;
    if (!transcript) return;
    const distance = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight;
    const nearBottom = distance <= NEAR_BOTTOM_THRESHOLD;
    nearBottomRef.current = nearBottom;
    if (nearBottom) setUnseenEvents(0);
  }, []);

  const scrollToLatest = useCallback(() => {
    const transcript = transcriptRef.current;
    if (!transcript) return;
    nearBottomRef.current = true;
    transcript.scrollTo({ top: transcript.scrollHeight, behavior: "auto" });
    setUnseenEvents(0);
  }, []);

  const updateSettings = useCallback(async (patch: Partial<AppSettings>) => {
    setSettings((current) => current ? { ...current, ...patch } : current);
    setSettings(await api.settings.update(patch));
  }, []);

  useEffect(() => {
    if (compactLayout && settings?.navVisible && settings.inspectorVisible) {
      void updateSettings({ inspectorVisible: false });
    }
  }, [compactLayout, settings?.inspectorVisible, settings?.navVisible, updateSettings]);

  const closeSidebar = useCallback(() => {
    void updateSettings({ navVisible: false });
    focusAfterFrame("#environment-trigger");
  }, [updateSettings]);

  const closeReview = useCallback(() => {
    void updateSettings({ inspectorVisible: false });
    focusAfterFrame('[aria-label="Показать проверку изменений"]');
  }, [updateSettings]);

  const chooseProject = useCallback(async () => {
    const path = await api.project.choose();
    if (!path) return;
    const [nextSettings, nextRuntime, nextFiles] = await Promise.all([api.settings.get(), api.runtime.refresh(), api.project.listFiles()]);
    setSettings(nextSettings);
    setRuntime(nextRuntime);
    setFiles(nextFiles);
    setActiveFile(null);
    setActive("Sessions");
  }, []);

  const refreshRuntime = useCallback(async () => {
    const nextRuntime = await api.runtime.refresh();
    setRuntime(nextRuntime);
    if (!nextRuntime.thinking.levels.some(({ id }) => id === selectedThinking)) setSelectedThinking(nextRuntime.thinking.defaultLevel);
  }, [selectedThinking]);

  const openFile = useCallback(async (path: string) => {
    setFileLoading(true);
    try {
      setActiveFile(await api.project.readFile(path));
    } catch (error) {
      setActiveFile({ path, content: error instanceof Error ? error.message : "Не удалось открыть файл", truncated: false });
    } finally {
      setFileLoading(false);
    }
  }, []);

  const showChat = useCallback(() => {
    setActiveFile(null);
    setActive("Sessions");
  }, []);

  const selectChat = useCallback((chatId: string) => {
    activeControllerRef.current?.controller.abort();
    setActiveChatId(chatId);
    setActiveFile(null);
    setAttachedTool(null);
    setActive("Sessions");
    nearBottomRef.current = true;
    if (compactLayout) void updateSettings({ navVisible: false });
  }, [compactLayout, updateSettings]);

  const createNewChat = useCallback(() => {
    activeControllerRef.current?.controller.abort();
    const id = `chat-${Date.now()}`;
    setChats((current) => [{ id, title: "Новый чат", meta: "сейчас" }, ...current]);
    setEntriesByChat((current) => ({ ...current, [id]: [] }));
    setActiveChatId(id);
    setComposer("");
    setContextCompact(false);
    setActiveFile(null);
    setAttachedTool(null);
    setActive("Sessions");
    nearBottomRef.current = true;
    if (compactLayout) void updateSettings({ navVisible: false });
    focusAfterFrame('[aria-label="Сообщение ma-hi-ko"]');
  }, [compactLayout, updateSettings]);

  const replaceActivityRun = useCallback((run: ActivityRun) => {
    if (!mountedRef.current) return;
    updateEntries((current) => current.map((entry) => entry.type === "activity" && entry.run.id === run.id ? { type: "activity", run } : entry));
  }, [updateEntries]);

  const executePrompt = useCallback(async (prompt: string, attempt = 0, retryRunId?: string) => {
    if (activeControllerRef.current) return;
    const runId = retryRunId ?? nextActivityRunId();
    const controller = new AbortController();
    const startedAt = Date.now();
    const preparingRun = createPreparingRun(runId, prompt, attempt, startedAt);
    activeControllerRef.current = { runId, controller };
    setActiveRunId(runId);

    if (!retryRunId) {
      setChats((current) => current.map((chat) => chat.id === activeChatId && chat.title === "Новый чат"
        ? { ...chat, title: prompt.slice(0, 42), meta: "сейчас" }
        : chat));
    }

    updateEntries((current) => retryRunId
      ? current.map((entry) => entry.type === "activity" && entry.run.id === runId ? { type: "activity", run: preparingRun } : entry)
      : [
        ...current,
        { type: "message", message: { id: `${runId}:user`, role: "user", text: prompt } },
        { type: "activity", run: preparingRun },
      ]);

    try {
      const reply = await api.agent.preview(prompt, { attempt, runId });
      if (controller.signal.aborted) {
        replaceActivityRun(cancelActivityRun(preparingRun));
        return;
      }

      const initialRun = createActivityRun(reply, prompt, attempt, startedAt);
      replaceActivityRun(initialRun);
      const finalRun = await executeActivityRun(initialRun, controller.signal, replaceActivityRun);
      if (finalRun.status === "success" && !controller.signal.aborted && mountedRef.current) {
        const answer: TranscriptMessage = {
          id: `${runId}:assistant:${attempt}`,
          role: "assistant",
          text: reply.chunks.join("").trim(),
        };
        updateEntries((current) => current.some((entry) => entry.type === "message" && entry.message.id === answer.id)
          ? current
          : [...current, { type: "message", message: answer }]);
      }
    } catch (error) {
      const finalRun = controller.signal.aborted
        ? cancelActivityRun(preparingRun)
        : createFailedRun(runId, prompt, attempt, error instanceof Error ? error.message : "Не удалось выполнить предпросмотр.", startedAt);
      replaceActivityRun(finalRun);
    } finally {
      if (activeControllerRef.current?.controller === controller) {
        activeControllerRef.current = null;
        if (mountedRef.current) setActiveRunId(null);
      }
    }
  }, [activeChatId, replaceActivityRun, updateEntries]);

  const runPreview = useCallback(() => {
    const prompt = composer.trim();
    if (!prompt || activeControllerRef.current) return;
    setComposer("");
    setModelPickerOpen(false);
    void executePrompt(prompt);
  }, [composer, executePrompt]);

  const stopActiveRun = useCallback(() => {
    activeControllerRef.current?.controller.abort();
  }, []);

  const retryRun = useCallback((run: ActivityRun) => {
    if (activeControllerRef.current) return;
    void executePrompt(run.prompt, run.attempt + 1, run.id);
  }, [executePrompt]);

  const openModelPicker = useCallback(() => {
    showChat();
    setModelPickerOpen(true);
  }, [showChat]);

  const handleCommand = useCallback((command: string) => {
    setPaletteOpen(false);
    setComposer("");
    setActiveFile(null);
    if (command.startsWith("/models")) {
      setActive("Sessions");
      setModelPickerOpen(true);
    } else if (command.startsWith("/settings")) {
      setSettingsOpen(true);
    } else if (command.startsWith("/session")) {
      setActive("Sessions");
    } else if (command.startsWith("/context")) {
      setActive("Sessions");
      window.requestAnimationFrame(() => document.getElementById("context-settings-trigger")?.click());
    } else if (command.startsWith("/compact")) {
      setActive("Sessions");
      setContextCompact(true);
    } else if (command.startsWith("/mcp")) {
      setActive("MCP");
    } else if (command.startsWith("/skills")) {
      setActive("Skills");
    } else if (command.startsWith("/usage")) {
      setActive("Использование");
    } else if (command.startsWith("/login")) {
      setActive("Accounts");
    } else if (command.startsWith("/tools")) {
      setActive("Tools");
    } else if (command.startsWith("/memory")) {
      setActive("Memory");
    } else if (command.startsWith("/changelog")) {
      setActive("История изменений");
    } else {
      setActive("Sessions");
    }
  }, []);

  useEffect(() => {
    const listener = (event: globalThis.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") {
        event.preventDefault();
        createNewChat();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(true);
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "b" && !event.shiftKey) {
        event.preventDefault();
        if (settings) {
          const nextVisible = !settings.navVisible;
          void updateSettings(compactLayout && nextVisible
            ? { navVisible: true, inspectorVisible: false }
            : { navVisible: nextVisible });
        }
      }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "b") {
        event.preventDefault();
        if (settings) {
          const nextVisible = !settings.inspectorVisible;
          void updateSettings(compactLayout && nextVisible
            ? { inspectorVisible: true, navVisible: false }
            : { inspectorVisible: nextVisible });
        }
      }
      if ((event.ctrlKey || event.metaKey) && event.key === ",") {
        event.preventDefault();
        setSettingsOpen(true);
      }
      if (event.key === "Escape") {
        if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
        if (activeControllerRef.current) {
          event.preventDefault();
          activeControllerRef.current.controller.abort();
          return;
        }
        if (attachedTool) {
          event.preventDefault();
          setAttachedTool(null);
          focusAfterFrame("#environment-trigger");
          return;
        }
        if (modelPickerOpen) {
          event.preventDefault();
          setModelPickerOpen(false);
          focusAfterFrame("#model-picker-trigger");
          return;
        }
        if (activeFile) {
          event.preventDefault();
          showChat();
          focusAfterFrame('[aria-label="Сообщение ma-hi-ko"]');
          return;
        }
        if (active !== "Sessions") {
          event.preventDefault();
          setActive("Sessions");
          focusAfterFrame('[aria-label="Сообщение ma-hi-ko"]');
          return;
        }
        if (window.matchMedia("(max-width: 1180px)").matches && (settings?.navVisible || settings?.inspectorVisible)) {
          event.preventDefault();
          void updateSettings({ navVisible: false, inspectorVisible: false });
          focusAfterFrame(settings?.navVisible ? "#environment-trigger" : '[aria-label="Показать проверку изменений"]');
        }
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [active, activeFile, attachedTool, compactLayout, createNewChat, modelPickerOpen, settings, showChat, updateSettings]);

  const projectName = settings?.projectPath.split("/").filter(Boolean).pop() ?? "проект не выбран";
  const showNav = settings?.navVisible ?? true;
  const showReview = (settings?.inspectorVisible ?? true) && !(compactLayout && showNav);
  const activeLabel = activeFile?.path
    ?? (active === "Changes" ? "Изменения"
      : active === "Tasks" ? "Запланировано"
        : navigation.find(([name]) => name === active)?.[2] ?? active);
  const layoutStyle = {
    "--nav-width": `${settings?.navWidth ?? 312}px`,
    "--review-width": `${settings?.inspectorWidth ?? 356}px`,
  } as CSSProperties;

  const selectSection = (view: WorkspaceView) => {
    setActiveFile(null);
    setAttachedTool(null);
    setActive(view);
    if (compactLayout) void updateSettings({ navVisible: false });
  };

  const toggleSidebar = () => {
    const nextVisible = !showNav;
    void updateSettings(compactLayout && nextVisible
      ? { navVisible: true, inspectorVisible: false }
      : { navVisible: nextVisible });
    if (compactLayout && nextVisible) focusAfterFrame('#environment-panel [aria-label="Скрыть боковую панель"]');
  };

  const toggleReview = () => {
    const nextVisible = !showReview;
    void updateSettings(compactLayout && nextVisible
      ? { inspectorVisible: true, navVisible: false }
      : { inspectorVisible: nextVisible });
    if (compactLayout && nextVisible) focusAfterFrame('#review-panel [aria-label="Скрыть проверку изменений"]');
  };

  const openReview = () => {
    void updateSettings(compactLayout
      ? { inspectorVisible: true, navVisible: false }
      : { inspectorVisible: true });
  };

  return (
    <div className="app-shell minimal-shell">
      <a className="skip-link" href="#main-workspace">Перейти к чату</a>
      <main id="main-workspace" style={layoutStyle} className={`desktop-layout${showNav ? " has-sidebar" : ""}${showReview ? " has-context" : ""}`}>
        {compactLayout && (showNav || showReview) ? (
          <button
            type="button"
            className="workbench-scrim"
            aria-label={showNav ? "Закрыть боковую панель" : "Закрыть проверку изменений"}
            tabIndex={-1}
            onClick={showNav ? closeSidebar : closeReview}
          />
        ) : null}
        {showNav ? (
          <WorkspaceSidebar
            active={active}
            activeChatId={activeChatId}
            chats={chats}
            projectName={projectName}
            runtime={runtime}
            onChooseProject={chooseProject}
            onClose={closeSidebar}
            onNewChat={createNewChat}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenTool={setAttachedTool}
            onSelectChat={selectChat}
            onSelectSection={selectSection}
          />
        ) : null}

        <section className="workspace-main minimal-workspace">
          <header className="workspace-header">
            <button id="environment-trigger" className="workbench-icon" aria-label={showNav ? "Скрыть боковую панель" : "Показать боковую панель"} aria-controls="environment-panel" aria-expanded={showNav} title={`${showNav ? "Скрыть" : "Показать"} навигацию · Ctrl+B`} onClick={toggleSidebar}><span aria-hidden="true">◫</span></button>
            <div className="workspace-title"><h1>{activeLabel}</h1><button className="workspace-project" aria-label={`Выбрать проект. Текущий: ${projectName}`} onClick={chooseProject}>{projectName}</button></div>
            <button className={`runtime-state ${runtime?.rpc.ready ? "success" : "warning"}`} aria-label="Обновить состояние OMP" onClick={refreshRuntime}>{runtime?.rpc.ready ? "● OMP подключён" : "○ Подключение…"}</button>
            <div className="workspace-actions">
              <button className="workbench-icon" aria-label="Открыть команды" title="Команды · Ctrl+K" onClick={() => setPaletteOpen(true)}><span aria-hidden="true">⌕</span></button>
              <button
                className="workbench-icon"
                aria-label={showReview ? "Скрыть проверку изменений" : "Показать проверку изменений"}
                aria-controls="review-panel"
                aria-expanded={showReview}
                title={`${showReview ? "Скрыть" : "Показать"} проверку изменений · Ctrl+Shift+B`}
                onClick={toggleReview}
              ><span aria-hidden="true">◧</span></button>
            </div>
          </header>

          <div className="workspace-content">
            {activeFile ? <FileViewer file={activeFile} loading={fileLoading} onBack={showChat} />
              : active === "Sessions" ? (
                <div className="session-workspace minimal-session">
                  <div className="transcript" ref={transcriptRef} onScroll={updateScrollPosition} aria-busy={working} aria-label="Транскрипт сессии">
                    <div className="transcript-inner">
                      {entries.length ? null : <StartupTranscript runtime={runtime} projectName={projectName} />}
                      {entries.map((entry) => entry.type === "message"
                        ? <MessageBlock key={entry.message.id} message={entry.message} />
                        : <ActivityStream key={entry.run.id} run={entry.run} onStop={stopActiveRun} onRetry={retryRun} />)}
                    </div>
                  </div>
                  {unseenEvents ? <button type="button" className="new-events-button" onClick={scrollToLatest}>↓ К новым событиям · {unseenEvents}</button> : null}
                  <Composer
                    value={composer}
                    onChange={setComposer}
                    onSubmit={runPreview}
                    working={working}
                    projectName={projectName}
                    runtime={runtime}
                    onCommand={handleCommand}
                    selectedModel={selectedModel}
                    selectedModelKey={selectedModelKey}
                    modelPickerOpen={modelPickerOpen}
                    onToggleModelPicker={() => setModelPickerOpen((value) => !value)}
                    onSelectModel={(model, key) => { setSelectedModel(model); setSelectedModelKey(key); setModelPickerOpen(false); }}
                    selectedThinking={selectedThinking}
                    onSelectThinking={setSelectedThinking}
                    contextCompact={contextCompact}
                    onContextCompactChange={setContextCompact}
                    autoCompact={settings?.autoCompact}
                    compactionThreshold={settings?.compactionThreshold}
                    compactionStrategy={settings?.compactionStrategy}
                    onContextSettingsChange={(patch) => void updateSettings(patch)}
                    onChooseProject={chooseProject}
                    onRefreshRuntime={refreshRuntime}
                  />
                </div>
              ) : active === "Changes" ? <ChangesSurface files={files} onOpenReview={openReview} />
                : active === "Projects" ? <ProjectsPage settings={settings} onChoose={chooseProject} />
                  : active === "Accounts" ? <AccountsPage />
                    : active === "MCP" ? <McpPage />
                      : active === "Skills" ? <SkillsPage projectPath={settings?.projectPath ?? ""} />
                        : active === "Tools" ? <ToolsPage />
                          : active === "Memory" ? <MemoryPage />
                            : active === "App Settings" ? <AppSettingsPage runtime={runtime} settings={settings} />
                              : <PreviewSurface title={activeLabel} />}
          </div>

          {attachedTool ? (
            <AttachedWorkbench
              tool={attachedTool}
              files={files}
              projectName={projectName}
              onClose={() => setAttachedTool(null)}
              onOpenFile={(path) => { void openFile(path); setAttachedTool(null); }}
              onOpenReview={openReview}
            />
          ) : null}
        </section>

        {showReview ? <ReviewPanel files={files} onClose={closeReview} onOpenFile={(path) => void openFile(path)} /> : null}
      </main>

      {settingsOpen ? <SettingsOverlay onClose={() => setSettingsOpen(false)} /> : null}
      {paletteOpen ? <CommandPalette onClose={() => setPaletteOpen(false)} onCommand={handleCommand} /> : null}
    </div>
  );
}

interface WorkspaceSidebarProps {
  active: WorkspaceView;
  activeChatId: string;
  chats: ChatSummary[];
  projectName: string;
  runtime: RuntimeSnapshot | null;
  onChooseProject(): void;
  onClose(): void;
  onNewChat(): void;
  onOpenSettings(): void;
  onOpenTool(tool: AttachedTool): void;
  onSelectChat(id: string): void;
  onSelectSection(view: WorkspaceView): void;
}

function WorkspaceSidebar(props: WorkspaceSidebarProps): JSX.Element {
  const navItems: Array<[WorkspaceView, string, string]> = [
    ["Sessions", "◫", "Чаты"],
    ["Projects", "▣", "Проекты"],
    ["Changes", "◩", "Изменения"],
    ["Tasks", "◷", "Запланировано"],
    ["MCP", "⌘", "/MCP"],
    ["Skills", "✦", "Скиллы"],
  ];

  return (
    <aside id="environment-panel" className="app-sidebar workspace-sidebar" aria-label="Навигация и проекты">
      <div className="sidebar-brand">
        <PiMark className="sidebar-pi" labelled />
        <div><strong>ma-hi-ko</strong><small>OMP desktop</small></div>
        <button className="workbench-icon compact" aria-label="Скрыть боковую панель" onClick={props.onClose}><span aria-hidden="true">‹</span></button>
      </div>

      <div className="sidebar-body">
        <button className="new-chat" aria-label="Новый чат" aria-keyshortcuts="Control+N" onClick={props.onNewChat}><span aria-hidden="true">＋</span><strong>Новый чат</strong><kbd aria-hidden="true">Ctrl+N</kbd></button>

        <nav className="primary-nav" aria-label="Основные разделы">
          {navItems.map(([view, icon, label]) => (
            <button key={view} className={props.active === view ? "active" : ""} aria-label={label} aria-current={props.active === view ? "page" : undefined} onClick={() => props.onSelectSection(view)}>
              <span aria-hidden="true">{icon}</span><span>{label}</span>
            </button>
          ))}
        </nav>

        <section className="sidebar-block chat-history" aria-labelledby="chat-history-title">
          <h2 className="sidebar-heading" id="chat-history-title"><span>Чаты</span><button aria-label="Создать новый чат" onClick={props.onNewChat}><span aria-hidden="true">＋</span></button></h2>
          <div className="recent-list">
            {props.chats.map((chat) => (
              <button key={chat.id} className={chat.id === props.activeChatId ? "active" : ""} onClick={() => props.onSelectChat(chat.id)}>
                <span>{chat.title}</span><small>{chat.meta}</small>
              </button>
            ))}
          </div>
        </section>

        <section className="sidebar-block project-block" aria-labelledby="project-block-title">
          <h2 className="sidebar-heading" id="project-block-title"><span>Проект</span><button aria-label="Выбрать папку проекта" onClick={props.onChooseProject}><span aria-hidden="true">＋</span></button></h2>
          <button className="sidebar-project" aria-label={`Выбрать проект. Текущий: ${props.projectName}`} onClick={props.onChooseProject}><span aria-hidden="true">▣</span><span><strong>{props.projectName}</strong><small>локальная рабочая область</small></span></button>
          <div className="project-tools">
            <button aria-label="Открыть окно ветки main" onClick={() => props.onOpenTool("branch")}><span aria-hidden="true">⑂</span><span>main</span><small aria-hidden="true">?18</small></button>
            <button aria-label="Открыть окно дерева файлов" onClick={() => props.onOpenTool("files")}><span aria-hidden="true">▤</span><span>Дерево файлов</span><small aria-hidden="true">внутри app</small></button>
            <button aria-label="Открыть окно пулл-реквеста" onClick={() => props.onOpenTool("pull-request")}><span aria-hidden="true">◉</span><span>Пулл-реквест</span><small aria-hidden="true">черновик</small></button>
          </div>
        </section>
      </div>

      <div className="sidebar-footer">
        <button aria-label="Открыть настройки OMP" onClick={props.onOpenSettings}><span aria-hidden="true">⚙</span><span>Настройки OMP</span></button>
        <span className={props.runtime?.rpc.ready ? "success" : "warning"}>{props.runtime?.rpc.ready ? "●" : "○"}</span>
      </div>
    </aside>
  );
}

function AttachedWorkbench({ tool, files, projectName, onClose, onOpenFile, onOpenReview }: { tool: AttachedTool; files: ProjectFileEntry[]; projectName: string; onClose(): void; onOpenFile(path: string): void; onOpenReview(): void }): JSX.Element {
  const panelRef = useRef<HTMLElement>(null);
  const [notice, setNotice] = useState("");
  const [commitMessage, setCommitMessage] = useState("");
  const [prTitle, setPrTitle] = useState("");
  const [prBody, setPrBody] = useState("");
  const fileRows = files.filter((entry) => entry.kind === "file").slice(0, 14);
  const title = tool === "branch" ? "Ветка main" : tool === "files" ? "Дерево проекта" : "Пулл-реквест";

  useEffect(() => { panelRef.current?.focus(); }, []);

  return (
    <section ref={panelRef} className="attached-workbench" role="dialog" aria-label={title} tabIndex={-1}>
      <header><div><span>ВНУТРЕННЕЕ ОКНО</span><strong>{title}</strong><small>{projectName}</small></div><button className="workbench-icon" aria-label={`Закрыть окно: ${title}`} onClick={onClose}>×</button></header>
      {tool === "branch" ? (
        <div className="attached-content branch-workbench">
          <div className="workbench-summary"><span>⑂ main</span><strong>18 локальных изменений</strong><button onClick={onOpenReview}>Открыть проверку →</button></div>
          <label><span>Сообщение коммита</span><input value={commitMessage} onChange={(event: ChangeEvent<HTMLInputElement>) => setCommitMessage(event.target.value)} aria-label="Сообщение коммита" placeholder="Кратко опишите изменение" /></label>
          <div className="tui-checklist"><p><span>●</span> Изменения остаются локальными</p><p><span>○</span> Push выполняется только после подтверждения</p><p><span>○</span> OMP проверит diff перед командой</p></div>
          <button className="primary-tui-action" disabled={!commitMessage.trim()} onClick={() => setNotice(`Подготовлена команда commit: ${commitMessage.trim()}`)}>Подготовить коммит</button>
        </div>
      ) : tool === "files" ? (
        <div className="attached-content file-workbench">
          <div className="attached-toolbar"><span>Источники проекта</span><small>{fileRows.length} файлов в быстром списке</small></div>
          <div className="attached-file-list" role="tree" aria-label="Файлы во внутреннем окне">
            {fileRows.map((entry) => <button key={entry.path} role="treeitem" onClick={() => onOpenFile(entry.path)}><span>▤</span><span>{entry.path}</span><small>открыть</small></button>)}
            {!fileRows.length ? <p>Выберите папку проекта, чтобы открыть дерево.</p> : null}
          </div>
        </div>
      ) : (
        <div className="attached-content pr-workbench">
          <label><span>Заголовок</span><input value={prTitle} onChange={(event: ChangeEvent<HTMLInputElement>) => setPrTitle(event.target.value)} aria-label="Заголовок пулл-реквеста" placeholder="Что меняется" /></label>
          <label><span>Описание</span><textarea value={prBody} onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setPrBody(event.target.value)} aria-label="Описание пулл-реквеста" placeholder="Контекст, проверка и риски" /></label>
          <div className="tui-checklist"><p><span>●</span> base: main</p><p><span>●</span> head: local/ui-rework</p><p><span>○</span> Отправка остаётся заблокированной до подключения git OMP</p></div>
          <button className="primary-tui-action" disabled={!prTitle.trim()} onClick={() => setNotice(`Черновик pull request «${prTitle.trim()}» подготовлен локально`)}>Подготовить черновик</button>
        </div>
      )}
      <footer><span>{notice || "Окно привязано к ma-hi-ko и не создаёт отдельный Electron BrowserWindow."}</span><kbd>Esc закрыть</kbd></footer>
    </section>
  );
}

function ReviewPanel({ files, onClose, onOpenFile }: { files: ProjectFileEntry[]; onClose(): void; onOpenFile(path: string): void }): JSX.Element {
  const changedFiles = useMemo(() => {
    const available = files.filter((entry) => entry.kind === "file").slice(0, 6);
    return available.length ? available : [
      { path: "src/renderer/App.tsx", name: "App.tsx", kind: "file" as const, depth: 0 },
      { path: "src/renderer/styles.css", name: "styles.css", kind: "file" as const, depth: 0 },
    ];
  }, [files]);
  const [selectedPath, setSelectedPath] = useState(changedFiles[0]?.path ?? "");
  const [copied, setCopied] = useState(false);
  const [filesExpanded, setFilesExpanded] = useState(true);
  const selected = changedFiles.find((entry) => entry.path === selectedPath) ?? changedFiles[0];
  const patch = selected ? `--- a/${selected.path}\n+++ b/${selected.path}\n@@ -18,3 +18,4 @@\n-  background: #0b0f12;\n+  background: var(--omp-canvas);\n+  color: var(--omp-text);` : "";

  useEffect(() => {
    if (!changedFiles.some((entry) => entry.path === selectedPath)) setSelectedPath(changedFiles[0]?.path ?? "");
  }, [changedFiles, selectedPath]);

  const copyPatch = async () => {
    try {
      await navigator.clipboard.writeText(patch);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <aside id="review-panel" className="review-panel" aria-label="Проверка изменений">
      <header className="review-header"><div><span>ПРОВЕРКА</span><strong>Локальные изменения</strong></div><button className="workbench-icon compact" aria-label="Скрыть проверку изменений" onClick={onClose}>›</button></header>
      <section className="review-summary"><div><span>⑂ main</span><strong>18 изменений</strong></div><p><span className="success">+218</span><span className="error">−74</span><span>6 файлов</span></p></section>
      <section className={`review-files${filesExpanded ? "" : " collapsed"}`} aria-labelledby="review-files-title"><div className="review-section-title" id="review-files-title"><span>Файлы</span><button aria-label={filesExpanded ? "Свернуть список файлов" : "Развернуть список файлов"} aria-expanded={filesExpanded} onClick={() => setFilesExpanded((value) => !value)}>{filesExpanded ? "⌃" : "⌄"}</button></div>
        {filesExpanded ? <div role="listbox" aria-label="Изменённые файлы">
          {changedFiles.map((entry, index) => (
            <button key={entry.path} role="option" aria-selected={entry.path === selected?.path} className={entry.path === selected?.path ? "active" : ""} onClick={() => setSelectedPath(entry.path)}>
              <span>{entry.path === selected?.path ? "❯" : " "}</span><span>{entry.path}</span><small><i className="success">+{24 + index * 7}</i><i className="error">−{3 + index}</i></small>
            </button>
          ))}
        </div> : null}
      </section>
      <section className="review-diff" aria-label="Предпросмотр diff"><div className="review-section-title"><span>Diff</span><small>unified</small></div><div className="diff-path">{selected?.path ?? "нет файла"}</div><pre><code>{patch}</code></pre></section>
      <div className="review-actions"><button disabled={!selected} onClick={() => selected && onOpenFile(selected.path)}>Открыть файл</button><button onClick={() => void copyPatch()}>{copied ? "✓ Скопировано" : "Копировать патч"}</button></div>
      <p className="review-note"><span className="accent">●</span> Панель показывает только локальные изменения, выбранный файл и проверяемый unified diff.</p>
    </aside>
  );
}

function FileViewer({ file, loading, onBack }: { file: ProjectFilePreview; loading: boolean; onBack(): void }): JSX.Element {
  const lines = file.content.split("\n");
  return (
    <section className="file-viewer" aria-label={`Файл ${file.path}`}>
      <header><button className="workbench-icon compact" aria-label="Вернуться в чат" onClick={onBack}>‹</button><span>{file.path}</span>{file.truncated ? <em>показаны первые 128 КБ</em> : null}</header>
      <div className="file-code" aria-busy={loading}>
        {lines.map((line, index) => <div className="code-line" key={`${index}-${line.slice(0, 8)}`}><span>{index + 1}</span><code>{line || " "}</code></div>)}
      </div>
    </section>
  );
}

function ChangesSurface({ files, onOpenReview }: { files: ProjectFileEntry[]; onOpenReview(): void }): JSX.Element {
  const fileCount = files.filter((entry) => entry.kind === "file").length;
  return (
    <section className="changes-surface">
      <div className="changes-title"><span>⑂ main</span><span className="warning">?18</span><button onClick={onOpenReview}>Открыть проверку →</button></div>
      <div className="changes-empty"><span>◩</span><strong>Локальные изменения</strong><p>{fileCount ? `${fileCount} файлов проекта доступны для review.` : "OMP покажет git-статус после подключения инструментов."}</p><button className="primary-tui-action" onClick={onOpenReview}>Проверить diff</button></div>
    </section>
  );
}

function PreviewSurface({ title }: { title: string }): JSX.Element {
  return <section className="preview-surface"><span className="big-glyph">◇</span><h2>{title}</h2><p>Раздел доступен в режиме безопасного предпросмотра.</p></section>;
}
