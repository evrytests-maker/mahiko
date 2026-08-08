import type { JSX, MouseEventHandler, PointerEventHandler } from "react";

export function TuiEscapeButton({ label, onClick, className = "", onPointerDown }: {
  label: string;
  onClick: MouseEventHandler<HTMLButtonElement>;
  className?: string;
  onPointerDown?: PointerEventHandler<HTMLButtonElement>;
}): JSX.Element {
  return (
    <button
      type="button"
      className={`tui-escape-button${className ? ` ${className}` : ""}`}
      aria-label={label}
      title="Esc"
      onPointerDown={onPointerDown}
      onClick={onClick}
    >
      <kbd>esc</kbd><span aria-hidden="true">×</span>
    </button>
  );
}
