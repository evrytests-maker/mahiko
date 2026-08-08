import { BrowserWindow, WebContentsView, type WebContents } from "electron";
import type { EmbeddedBrowserBounds, EmbeddedBrowserState } from "../shared/contracts";

const DEFAULT_URL = "https://example.com/";
const STATE_CHANNEL = "browser:state";
const controllers = new WeakMap<BrowserWindow, EmbeddedBrowserController>();

export function embeddedBrowserFor(window: BrowserWindow): EmbeddedBrowserController {
  const current = controllers.get(window);
  if (current) return current;
  const controller = new EmbeddedBrowserController(window);
  controllers.set(window, controller);
  return controller;
}

export class EmbeddedBrowserController {
  private readonly view: WebContentsView;
  private attached = false;
  private lastError: string | null = null;
  private lastViewportWidth = 0;

  constructor(private readonly owner: BrowserWindow) {
    this.view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        spellcheck: false,
        // Keep the legacy partition key so upgrades retain signed-in browser sessions.
        partition: "persist:ma-hi-ko-browser",
      },
    });
    this.view.setBackgroundColor("#ffffff");
    this.installNavigationGuards();
    this.installStateEvents();
    owner.once("closed", () => this.dispose());
  }

  async show(bounds: EmbeddedBrowserBounds, url?: string): Promise<EmbeddedBrowserState> {
    this.attach();
    this.setBounds(bounds);
    const target = url ? normalizeUrl(url) : this.view.webContents.getURL() || DEFAULT_URL;
    if (!this.view.webContents.getURL() || target !== this.view.webContents.getURL()) await this.load(target);
    const state = this.state();
    this.emit(state);
    return state;
  }

  hide(): void {
    if (!this.attached || this.owner.isDestroyed()) return;
    try { this.owner.contentView.removeChildView(this.view); } catch { /* already detached */ }
    this.attached = false;
  }

  setBounds(bounds: EmbeddedBrowserBounds): void {
    if (!bounds.visible) {
      this.hide();
      return;
    }
    this.attach();
    const content = this.owner.getContentBounds();
    const x = clamp(Math.round(bounds.x), 0, Math.max(0, content.width - 80));
    const y = clamp(Math.round(bounds.y), 0, Math.max(0, content.height - 60));
    const width = clamp(Math.round(bounds.width), 80, Math.max(80, content.width - x));
    const height = clamp(Math.round(bounds.height), 60, Math.max(60, content.height - y));
    // Keep a one-pixel seam between Electron chrome and the native child view.
    // This prevents the page from painting over the workbench border on fractional
    // display scales while preserving the full usable viewport.
    const inset = width > 82 && height > 62 ? 1 : 0;
    const viewportWidth = Math.max(80, width - inset * 2);
    this.view.setBounds({
      x: x + inset,
      y: y + inset,
      width: viewportWidth,
      height: Math.max(60, height - inset * 2),
    });
    this.fitPageToViewport(viewportWidth);
  }

  async navigate(url: string): Promise<EmbeddedBrowserState> {
    this.attach();
    await this.load(normalizeUrl(url));
    return this.state();
  }

  async back(): Promise<EmbeddedBrowserState> {
    const history = this.view.webContents.navigationHistory;
    if (history.canGoBack()) history.goBack();
    return this.state();
  }

  async forward(): Promise<EmbeddedBrowserState> {
    const history = this.view.webContents.navigationHistory;
    if (history.canGoForward()) history.goForward();
    return this.state();
  }

  async reload(): Promise<EmbeddedBrowserState> {
    this.view.webContents.reload();
    return this.state();
  }

  state(): EmbeddedBrowserState {
    const contents = this.view.webContents;
    const history = contents.navigationHistory;
    return {
      url: contents.getURL() || DEFAULT_URL,
      title: contents.getTitle() || "Browser",
      loading: contents.isLoading(),
      canGoBack: history.canGoBack(),
      canGoForward: history.canGoForward(),
      error: this.lastError,
    };
  }

  dispose(): void {
    this.hide();
    if (!this.view.webContents.isDestroyed()) this.view.webContents.close();
  }

  private attach(): void {
    if (this.attached || this.owner.isDestroyed()) return;
    this.owner.contentView.addChildView(this.view);
    this.attached = true;
  }

  private async load(url: string): Promise<void> {
    this.lastError = null;
    await this.view.webContents.loadURL(url);
    this.fitPageToViewport(this.lastViewportWidth);
  }

  private emit(state = this.state()): void {
    if (!this.owner.isDestroyed()) this.owner.webContents.send(STATE_CHANNEL, state);
  }

  private installNavigationGuards(): void {
    const contents = this.view.webContents;
    contents.setWindowOpenHandler(({ url }: { url: string }) => {
      try { void this.navigate(url); } catch { /* rejected by normalizeUrl */ }
      return { action: "deny" };
    });
    contents.on("will-navigate", (event: { preventDefault(): void }, url: string) => {
      try { normalizeUrl(url); }
      catch { event.preventDefault(); }
    });
  }

  private installStateEvents(): void {
    const contents = this.view.webContents;
    const emit = () => this.emit();
    contents.on("did-start-loading", emit);
    contents.on("did-stop-loading", () => {
      this.fitPageToViewport(this.lastViewportWidth);
      emit();
    });
    contents.on("did-navigate", emit);
    contents.on("did-navigate-in-page", emit);
    contents.on("page-title-updated", emit);
    contents.on("did-fail-load", (_event: unknown, errorCode: number, errorDescription: string, _validatedUrl: string, isMainFrame: boolean) => {
      if (!isMainFrame || errorCode === -3) return;
      this.lastError = errorDescription;
      emit();
    });
  }

  private fitPageToViewport(width: number): void {
    if (!Number.isFinite(width) || width <= 0 || this.view.webContents.isDestroyed()) return;
    this.lastViewportWidth = width;
    this.view.webContents.setZoomFactor(browserZoomForWidth(width));
  }
}

/**
 * Most public sites assume a viewport closer to a normal browser window than a
 * narrow IDE rail. Electron's WebContentsView reports the real narrow viewport,
 * but many desktop-only pages still overflow it. A conservative zoom curve keeps
 * those pages readable without injecting CSS or changing site content.
 */
export function browserZoomForWidth(width: number): number {
  if (width >= 980) return 1;
  if (width >= 820) return 0.9;
  if (width >= 680) return 0.8;
  if (width >= 560) return 0.72;
  if (width >= 440) return 0.64;
  return 0.56;
}

export function browserWindowFor(contents: WebContents): BrowserWindow {
  const window = BrowserWindow.fromWebContents(contents);
  if (!window) throw new Error("Окно браузера недоступно");
  return window;
}

export function normalizeUrl(input: string): string {
  const value = input.trim();
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}`;
  const parsed = new URL(candidate);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("Поддерживаются только http и https адреса");
  return parsed.toString();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
