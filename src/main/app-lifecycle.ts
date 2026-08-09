export interface BackgroundWindow {
  hide(): void;
  show(): void;
  focus(): void;
  isDestroyed(): boolean;
  isMinimized(): boolean;
  restore(): void;
}

interface CloseEvent {
  preventDefault(): void;
}

interface BackgroundLifecycleOptions {
  getWindow(): BackgroundWindow | null;
  quitApplication(): void;
}

export interface BackgroundLifecycle {
  onWindowClose(event: CloseEvent): void;
  showWindow(): void;
  beginQuit(): void;
  quit(): void;
  readonly isQuitting: boolean;
}

export function createBackgroundLifecycle(options: BackgroundLifecycleOptions): BackgroundLifecycle {
  let quitting = false;
  return {
    get isQuitting() { return quitting; },
    onWindowClose(event) {
      if (quitting) return;
      event.preventDefault();
      const window = options.getWindow();
      if (window && !window.isDestroyed()) window.hide();
    },
    showWindow() {
      const window = options.getWindow();
      if (!window || window.isDestroyed()) return;
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    },
    beginQuit() { quitting = true; },
    quit() {
      quitting = true;
      options.quitApplication();
    },
  };
}
