import { ipcMain } from "electron";
import type { RuntimeSnapshot } from "../shared/contracts";
import { discoverRuntime, loadOmpLock } from "./omp-runtime";

export function registerRuntimeIpc(appRoot: string, runtimeCwd: string): () => void {
  let cached: RuntimeSnapshot | null = null;

  const refresh = async () => {
    const lock = await loadOmpLock(appRoot);
    cached = await discoverRuntime(runtimeCwd, lock, process.env.MOHIKO_OMP_PATH ?? null);
    return cached;
  };

  ipcMain.handle("runtime:get", async () => cached ?? refresh());
  ipcMain.handle("runtime:refresh", refresh);

  return () => {
    ipcMain.removeHandler("runtime:get");
    ipcMain.removeHandler("runtime:refresh");
  };
}
