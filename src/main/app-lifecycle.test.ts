import { describe, expect, it, vi } from "vitest";
import { createBackgroundLifecycle } from "./app-lifecycle";

describe("desktop background lifecycle", () => {
  it("hides the window on close and restores it from the tray", () => {
    const window = {
      hide: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
      isDestroyed: vi.fn(() => false),
      isMinimized: vi.fn(() => true),
      restore: vi.fn(),
    };
    const lifecycle = createBackgroundLifecycle({ getWindow: () => window, quitApplication: vi.fn() });
    const closeEvent = { preventDefault: vi.fn() };

    lifecycle.onWindowClose(closeEvent);
    expect(closeEvent.preventDefault).toHaveBeenCalledOnce();
    expect(window.hide).toHaveBeenCalledOnce();

    lifecycle.showWindow();
    expect(window.restore).toHaveBeenCalledOnce();
    expect(window.show).toHaveBeenCalledOnce();
    expect(window.focus).toHaveBeenCalledOnce();
  });

  it("allows the native close during an explicit tray quit", () => {
    const quitApplication = vi.fn();
    const window = {
      hide: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
      isDestroyed: vi.fn(() => false),
      isMinimized: vi.fn(() => false),
      restore: vi.fn(),
    };
    const lifecycle = createBackgroundLifecycle({ getWindow: () => window, quitApplication });
    const closeEvent = { preventDefault: vi.fn() };

    lifecycle.quit();
    lifecycle.onWindowClose(closeEvent);

    expect(quitApplication).toHaveBeenCalledOnce();
    expect(closeEvent.preventDefault).not.toHaveBeenCalled();
    expect(window.hide).not.toHaveBeenCalled();
  });
});
