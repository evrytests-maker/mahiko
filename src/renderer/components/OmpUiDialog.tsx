import { useEffect, useRef, useState, type FormEvent, type JSX } from "react";
import type { OmpUiRequest, OmpUiResponse } from "../../shared/contracts";

export type InteractiveOmpUiRequest = Extract<OmpUiRequest, { type: "select" | "input" | "editor" | "confirm" }>;

export function OmpUiDialog({ request, onRespond, onEscape }: {
  request: InteractiveOmpUiRequest;
  onRespond(response: OmpUiResponse): void;
  onEscape(): void;
}): JSX.Element {
  const [value, setValue] = useState(request.type === "editor" ? request.prefill : "");
  const rootRef = useRef<HTMLElement>(null);

  useEffect(() => {
    rootRef.current?.focus();
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onRespond({ id: request.id, cancelled: true });
      onEscape();
    };
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
  }, [onEscape, onRespond, request.id]);

  const submitValue = (event: FormEvent) => {
    event.preventDefault();
    onRespond({ id: request.id, value });
  };

  return (
    <div className="overlay-screen" role="dialog" aria-modal="true" aria-label={dialogTitle(request)}>
      <section ref={rootRef} className="terminal-frame install-dialog" tabIndex={-1}>
        <div className="frame-title">OMP запрашивает ввод</div>
        <div className="dialog-content">
          <h2>{dialogTitle(request)}</h2>
          {request.type === "select" ? (
            <div className="selector-list" role="listbox" aria-label={request.title}>
              {request.options.map((option) => <button type="button" role="option" aria-selected="false" key={option} onClick={() => onRespond({ id: request.id, value: option })}>{option}</button>)}
            </div>
          ) : null}
          {request.type === "confirm" ? <p>{request.message}</p> : null}
          {request.type === "input" || request.type === "editor" ? (
            <form onSubmit={submitValue}>
              {request.type === "input"
                ? <input autoFocus aria-label={request.title ?? request.message} placeholder={request.placeholder} value={value} onChange={(event) => setValue(event.target.value)} autoComplete="off" />
                : <textarea autoFocus aria-label={request.title} value={value} onChange={(event) => setValue(event.target.value)} rows={10} />}
              <div className="dialog-actions"><button type="button" onClick={() => onRespond({ id: request.id, cancelled: true })}>Отмена</button><button type="submit" className="primary">Отправить</button></div>
            </form>
          ) : null}
        </div>
        {request.type === "confirm" ? <div className="dialog-actions"><button type="button" onClick={() => onRespond({ id: request.id, confirmed: false })}>Нет</button><button type="button" className="primary" onClick={() => onRespond({ id: request.id, confirmed: true })}>Да</button></div> : null}
        {request.type === "select" ? <div className="overlay-help">Выберите значение · Esc — отменить запрос</div> : null}
      </section>
    </div>
  );
}

function dialogTitle(request: InteractiveOmpUiRequest): string {
  if (request.type === "input") return request.title ?? request.message;
  if (request.type === "confirm") return request.title ?? "Подтверждение";
  return request.title;
}
