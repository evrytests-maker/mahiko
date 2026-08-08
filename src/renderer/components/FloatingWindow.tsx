import { useEffect, useRef, useState, type JSX, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { TuiEscapeButton } from "./TuiControls";

interface Position { x: number; y: number }
interface Size { width: number; height: number }

const VIEWPORT_MARGIN = 8;
const WORKSPACE_TOP = 56;
const MIN_WIDTH = 320;
const MIN_HEIGHT = 240;

export function FloatingWindow({ id, title, subtitle, zIndex, initialPosition, width = 440, height = 520, onActivate, onClose, children }: {
  id: string;
  title: string;
  subtitle?: string;
  zIndex: number;
  initialPosition: Position;
  width?: number;
  height?: number;
  onActivate(): void;
  onClose(): void;
  children: ReactNode;
}): JSX.Element {
  const initialSize = fitSize({ width, height });
  const [position, setPosition] = useState(() => bound(initialPosition, initialSize));
  const [size, setSize] = useState<Size>(initialSize);
  const [maximized, setMaximized] = useState(false);
  const restoreRef = useRef<{ position: Position; size: Size }>({ position: initialPosition, size: initialSize });
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; origin: Position } | null>(null);
  const resizeRef = useRef<{ pointerId: number; startX: number; startY: number; origin: Size } | null>(null);

  useEffect(() => {
    const onResize = () => {
      if (maximized) {
        setPosition({ x: VIEWPORT_MARGIN, y: WORKSPACE_TOP });
        setSize(maximizedSize());
        return;
      }
      setSize((current) => {
        const next = fitSize(current);
        setPosition((point) => bound(point, next));
        return next;
      });
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [maximized]);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (drag?.pointerId === event.pointerId && !maximized) {
        setPosition(bound({ x: drag.origin.x + event.clientX - drag.startX, y: drag.origin.y + event.clientY - drag.startY }, size));
        return;
      }
      const resize = resizeRef.current;
      if (resize?.pointerId !== event.pointerId || maximized) return;
      const next = fitSize({ width: resize.origin.width + event.clientX - resize.startX, height: resize.origin.height + event.clientY - resize.startY }, position);
      setSize(next);
    };
    const stop = (event: PointerEvent) => {
      if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
      if (resizeRef.current?.pointerId === event.pointerId) resizeRef.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, [maximized, position, size]);

  const beginDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || maximized || (event.target as HTMLElement).closest("button")) return;
    onActivate();
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, origin: position };
    event.preventDefault();
  };

  const beginResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || maximized) return;
    onActivate();
    resizeRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, origin: size };
    event.stopPropagation();
    event.preventDefault();
  };

  const toggleMaximize = () => {
    onActivate();
    if (maximized) {
      const restored = fitSize(restoreRef.current.size);
      setSize(restored);
      setPosition(bound(restoreRef.current.position, restored));
      setMaximized(false);
      return;
    }
    restoreRef.current = { position, size };
    setPosition({ x: VIEWPORT_MARGIN, y: WORKSPACE_TOP });
    setSize(maximizedSize());
    setMaximized(true);
  };

  return (
    <section
      id={`floating-${id}`}
      role="dialog"
      aria-modal="false"
      aria-labelledby={`floating-${id}-title`}
      className={`floating-window${maximized ? " maximized" : ""}`}
      style={{ width: size.width, height: size.height, transform: `translate(${position.x}px, ${position.y}px)`, zIndex }}
      onPointerDown={onActivate}
      onFocusCapture={onActivate}
    >
      <div
        className="floating-titlebar"
        tabIndex={0}
        aria-label={`Переместить окно: ${title}. Alt + стрелки перемещают окно`}
        onDoubleClick={toggleMaximize}
        onPointerDown={beginDrag}
        onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
          if (!event.altKey || maximized || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
          event.preventDefault();
          const dx = event.key === "ArrowLeft" ? -16 : event.key === "ArrowRight" ? 16 : 0;
          const dy = event.key === "ArrowUp" ? -16 : event.key === "ArrowDown" ? 16 : 0;
          setPosition((current) => bound({ x: current.x + dx, y: current.y + dy }, size));
        }}
      >
        <div><strong id={`floating-${id}-title`}>{title}</strong>{subtitle ? <span>{subtitle}</span> : null}</div>
        <div className="floating-window-actions">
          <button type="button" className="window-icon-button" aria-label={maximized ? `Восстановить ${title}` : `Развернуть ${title}`} title={maximized ? "Восстановить" : "Развернуть"} onPointerDown={(event: ReactPointerEvent<HTMLButtonElement>) => event.stopPropagation()} onClick={toggleMaximize}>{maximized ? "❐" : "□"}</button>
          <TuiEscapeButton className="floating-escape" label={`Закрыть ${title}`} onPointerDown={(event) => event.stopPropagation()} onClick={onClose} />
        </div>
      </div>
      <div className="floating-body">{children}</div>
      {!maximized ? <button type="button" className="floating-resize-handle" aria-label={`Изменить размер окна ${title}`} onPointerDown={beginResize} /> : null}
    </section>
  );
}

function maximizedSize(): Size {
  return {
    width: Math.max(MIN_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2),
    height: Math.max(MIN_HEIGHT, window.innerHeight - WORKSPACE_TOP - VIEWPORT_MARGIN),
  };
}

function fitSize(size: Size, position: Position = { x: VIEWPORT_MARGIN, y: WORKSPACE_TOP }): Size {
  return {
    width: Math.max(MIN_WIDTH, Math.min(Math.round(size.width), Math.max(MIN_WIDTH, window.innerWidth - position.x - VIEWPORT_MARGIN))),
    height: Math.max(MIN_HEIGHT, Math.min(Math.round(size.height), Math.max(MIN_HEIGHT, window.innerHeight - position.y - VIEWPORT_MARGIN))),
  };
}

function bound(position: Position, size: Size): Position {
  const visibleWidth = Math.min(size.width, Math.max(MIN_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2));
  const visibleHeight = Math.min(size.height, Math.max(MIN_HEIGHT, window.innerHeight - WORKSPACE_TOP - VIEWPORT_MARGIN));
  const maxX = Math.max(VIEWPORT_MARGIN, window.innerWidth - visibleWidth - VIEWPORT_MARGIN);
  const maxY = Math.max(WORKSPACE_TOP, window.innerHeight - visibleHeight - VIEWPORT_MARGIN);
  return {
    x: Math.max(VIEWPORT_MARGIN, Math.min(maxX, Math.round(position.x))),
    y: Math.max(WORKSPACE_TOP, Math.min(maxY, Math.round(position.y))),
  };
}
