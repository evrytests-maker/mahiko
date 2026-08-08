import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

const focusableSelector = [
  "a[href]", "button:not([disabled])", "input:not([disabled])", "select:not([disabled])", "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function activeElementOrNull(): HTMLElement | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || active === document.body || active === document.documentElement) return null;
  return active;
}

export function useModalFocusTrap(onClose: () => void, fallbackSelector: string): RefObject<HTMLDivElement | null> {
  const rootRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    previousFocus.current = activeElementOrNull();
    const root = rootRef.current;
    if (!root) return;
    const first = root.querySelector<HTMLElement>(focusableSelector) ?? root;
    first.focus();
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusables = [...root.querySelectorAll<HTMLElement>(focusableSelector)].filter((node) => !node.hasAttribute("disabled") && node.offsetParent !== null);
      if (!focusables.length) {
        event.preventDefault();
        root.focus();
        return;
      }
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !root.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", listener, true);
    return () => document.removeEventListener("keydown", listener, true);
  }, [onClose]);

  useEffect(() => () => {
    const previous = previousFocus.current;
    window.requestAnimationFrame(() => {
      const target = previous?.isConnected ? previous : document.querySelector<HTMLElement>(fallbackSelector);
      target?.focus();
    });
  }, [fallbackSelector]);

  return rootRef;
}

export function useNonModalSurfaceFocus(onClose: () => void, fallbackSelector: string): RefObject<HTMLDivElement | null> {
  const rootRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    previousFocus.current = activeElementOrNull();
    const root = rootRef.current;
    const first = root?.querySelector<HTMLElement>("[data-initial-focus]") ?? root?.querySelector<HTMLElement>(focusableSelector) ?? root;
    first?.focus();
  }, []);

  useEffect(() => () => {
    const previous = previousFocus.current;
    window.requestAnimationFrame(() => {
      const target = previous?.isConnected ? previous : document.querySelector<HTMLElement>(fallbackSelector);
      target?.focus();
    });
  }, [fallbackSelector]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const listener = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    root.addEventListener("keydown", listener);
    return () => root.removeEventListener("keydown", listener);
  }, [onClose]);

  return rootRef;
}
