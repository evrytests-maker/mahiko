import { contextBridge, ipcRenderer } from "electron";
import type { AgentStreamEvent, MahikoApi, OmpUiRequest } from "../shared/contracts";

const api: MahikoApi = {
  runtime: {
    getSnapshot: () => ipcRenderer.invoke("runtime:get"),
    refresh: () => ipcRenderer.invoke("runtime:refresh"),
    getInstallation: () => ipcRenderer.invoke("runtime:installation"),
    installBundled: () => ipcRenderer.invoke("runtime:install-bundled"),
  },
  application: {
    openExternal: (url) => ipcRenderer.invoke("application:open-external", url),
    quit: () => ipcRenderer.invoke("application:quit"),
  },
  project: {
    choose: () => ipcRenderer.invoke("project:choose"),
    listFiles: () => ipcRenderer.invoke("project:list"),
    readFile: (path) => ipcRenderer.invoke("project:read", path),
  },
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    update: (patch) => ipcRenderer.invoke("settings:update", patch),
  },
  browser: {
    show: (bounds, url) => ipcRenderer.invoke("browser:show", bounds, url),
    hide: () => ipcRenderer.invoke("browser:hide"),
    setBounds: (bounds) => ipcRenderer.invoke("browser:bounds", bounds),
    navigate: (url) => ipcRenderer.invoke("browser:navigate", url),
    back: () => ipcRenderer.invoke("browser:back"),
    forward: () => ipcRenderer.invoke("browser:forward"),
    reload: () => ipcRenderer.invoke("browser:reload"),
    onState: (listener) => {
      const handler = (_event: unknown, state: Parameters<typeof listener>[0]) => listener(state);
      ipcRenderer.on("browser:state", handler);
      return () => ipcRenderer.removeListener("browser:state", handler);
    },
  },
  terminal: {
    run: (command) => ipcRenderer.invoke("terminal:run", command),
  },
  diagnostics: {
    get: () => ipcRenderer.invoke("diagnostics:get"),
    copy: () => ipcRenderer.invoke("diagnostics:copy"),
  },
  agent: {
    run: (prompt, runId) => ipcRenderer.invoke("agent:run", prompt, runId),
    cancel: (runId) => ipcRenderer.invoke("agent:cancel", runId),
    onEvent: (listener) => {
      const handler = (_event: unknown, streamEvent: AgentStreamEvent) => listener(streamEvent);
      ipcRenderer.on("agent:event", handler);
      return () => ipcRenderer.removeListener("agent:event", handler);
    },
  },
  omp: {
    getState: () => ipcRenderer.invoke("omp:state"),
    getModels: () => ipcRenderer.invoke("omp:models"),
    setModel: (provider, modelId) => ipcRenderer.invoke("omp:set-model", provider, modelId),
    setThinkingLevel: (level) => ipcRenderer.invoke("omp:set-thinking", level),
    setAutoCompaction: (enabled) => ipcRenderer.invoke("omp:auto-compact", enabled),
    compact: () => ipcRenderer.invoke("omp:compact"),
    getSubagents: () => ipcRenderer.invoke("omp:subagents"),
    getSubagentSettings: () => ipcRenderer.invoke("omp:subagent-settings"),
    setConfig: (key, value) => ipcRenderer.invoke("omp:set-config", key, value),
    getLoginProviders: () => ipcRenderer.invoke("omp:login-providers"),
    login: (providerId) => ipcRenderer.invoke("omp:login", providerId),
    onUiRequest: (listener) => {
      const handler = (_event: unknown, request: OmpUiRequest) => listener(request);
      ipcRenderer.on("omp:ui-request", handler);
      return () => ipcRenderer.removeListener("omp:ui-request", handler);
    },
    respondUi: (request) => ipcRenderer.invoke("omp:ui-response", request),
    getAccountPool: () => ipcRenderer.invoke("omp:account-pool:get"),
    setAccountPool: (value) => ipcRenderer.invoke("omp:account-pool:set", value),
    saveCustomProvider: (request) => ipcRenderer.invoke("omp:custom-provider", request),
  },
};

contextBridge.exposeInMainWorld("mahiko", api);
