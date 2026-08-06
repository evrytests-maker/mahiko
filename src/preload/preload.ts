import { contextBridge, ipcRenderer } from "electron";
import type { MohikoApi, RuntimeSnapshot } from "../shared/contracts";

const invoke = (channel: string): Promise<RuntimeSnapshot> => ipcRenderer.invoke(channel) as Promise<RuntimeSnapshot>;

const api: MohikoApi = Object.freeze({
  runtime: Object.freeze({
    getSnapshot: () => invoke("runtime:get"),
    refresh: () => invoke("runtime:refresh"),
  }),
});

contextBridge.exposeInMainWorld("mohiko", api);
