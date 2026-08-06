import { contextBridge, ipcRenderer } from "electron";
import type { MaHiKoApi } from "../shared/contracts";

const api: MaHiKoApi = {
  runtime: {
    getSnapshot: () => ipcRenderer.invoke("runtime:get"),
    refresh: () => ipcRenderer.invoke("runtime:refresh"),
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
  diagnostics: {
    get: () => ipcRenderer.invoke("diagnostics:get"),
    copy: () => ipcRenderer.invoke("diagnostics:copy"),
  },
  agent: {
    preview: (prompt, options) => ipcRenderer.invoke("agent:preview", prompt, options),
  },
  skills: {
    install: (request) => ipcRenderer.invoke("skills:install", request),
  },
  marketplace: {
    setBounds: (bounds) => ipcRenderer.invoke("marketplace:bounds", bounds),
  },
};

contextBridge.exposeInMainWorld("maHiKo", api);
