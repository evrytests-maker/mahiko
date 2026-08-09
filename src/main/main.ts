import { app, BrowserWindow, Menu, nativeImage, shell, Tray } from "electron";
import { join } from "node:path";
import { createBackgroundLifecycle } from "./app-lifecycle";
import { normalizeExternalUrl } from "./external-url";
import { registerIpcHandlers } from "./ipc";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
const lifecycle = createBackgroundLifecycle({
  getWindow: () => mainWindow,
  quitApplication: () => app.quit(),
});

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  else lifecycle.showWindow();
}

function createTray(): void {
  if (tray) return;
  const extension = process.platform === "win32" ? "ico" : "png";
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, "tray", `icon.${extension}`)
    : join(app.getAppPath(), "build", `icon.${extension}`);
  const source = nativeImage.createFromPath(iconPath);
  const image = process.platform === "win32" ? source : source.resize({ width: 20, height: 20 });
  if (image.isEmpty()) throw new Error(`Не удалось загрузить tray icon: ${iconPath}`);

  tray = new Tray(image);
  tray.setToolTip("mahiko · OMP 17.2.9");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Открыть mahiko", click: showMainWindow },
    { type: "separator" },
    { label: "Полностью закрыть", click: () => lifecycle.quit() },
  ]));
  tray.on("click", showMainWindow);
  tray.on("double-click", showMainWindow);
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 760,
    minHeight: 640,
    backgroundColor: "#0b0f12",
    show: false,
    webPreferences: {
      preload: join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      devTools: !app.isPackaged,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try { void shell.openExternal(normalizeExternalUrl(url)); } catch { /* blocked external protocol */ }
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const current = mainWindow?.webContents.getURL();
    if (current && url !== current) event.preventDefault();
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("close", (event) => lifecycle.onWindowClose(event));
  mainWindow.on("closed", () => { mainWindow = null; });

  const developmentUrl = process.env.VITE_DEV_SERVER_URL;
  if (developmentUrl) void mainWindow.loadURL(developmentUrl);
  else void mainWindow.loadFile(join(__dirname, "../../dist/index.html"));
}

app.whenReady().then(() => {
  if (process.platform === "win32") app.setAppUserModelId("com.github.evrytestsmaker.mahiko");
  registerIpcHandlers();
  createWindow();
  createTray();
  app.on("activate", showMainWindow);
});

app.on("before-quit", () => lifecycle.beginQuit());
app.on("will-quit", () => { tray?.destroy(); tray = null; });
app.on("window-all-closed", () => undefined);
