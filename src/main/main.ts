import { app, BrowserWindow } from "electron";
import { join } from "node:path";
import { registerRuntimeIpc } from "./ipc";

let cleanupIpc: (() => void) | null = null;

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1080,
    height: 700,
    minWidth: 620,
    minHeight: 480,
    backgroundColor: "#111418",
    webPreferences: {
      preload: join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  const developmentUrl = process.env.VITE_DEV_SERVER_URL;
  if (developmentUrl) void window.loadURL(developmentUrl);
  else void window.loadFile(join(__dirname, "../../dist/index.html"));
  return window;
}

void app.whenReady().then(() => {
  cleanupIpc = registerRuntimeIpc(app.getAppPath(), process.cwd());
  createWindow();
});

app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => cleanupIpc?.());
