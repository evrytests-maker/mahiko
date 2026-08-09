import { useCallback, useEffect, useRef, useState, type FormEvent, type JSX } from "react";
import type { OmpUiRequest, OmpUiResponse } from "../../shared/contracts";

export type InteractiveOmpUiRequest = Extract<OmpUiRequest, { type: "select" | "input" | "editor" | "confirm" }>;
export type OmpBrowserRequest = Extract<OmpUiRequest, { type: "open_url" }>;

export function OmpUiDialog({ request, browserRequest, onOpenExternal, onRespond }: {
  request: InteractiveOmpUiRequest;
  browserRequest?: OmpBrowserRequest | null;
  onOpenExternal?(url: string): Promise<unknown> | unknown;
  onRespond(response: OmpUiResponse): void;
}): JSX.Element {
  const [value, setValue] = useState(request.type === "editor" ? request.prefill : "");
  const [browserError, setBrowserError] = useState("");
  const rootRef = useRef<HTMLElement>(null);
  const respondedRef = useRef(false);
  const authentication = request.type === "input" && browserRequest && /authori[sz]ation code|redirect url/i.test(`${request.title ?? ""} ${request.message}`);

  const respondOnce = useCallback((response: OmpUiResponse) => {
    if (respondedRef.current) return;
    respondedRef.current = true;
    onRespond(response);
  }, [onRespond]);

  const cancel = useCallback(() => respondOnce({ id: request.id, cancelled: true }), [request.id, respondOnce]);

  useEffect(() => {
    respondedRef.current = false;
    rootRef.current?.focus();
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      cancel();
    };
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
  }, [cancel, request.id]);

  const submitValue = (event: FormEvent) => {
    event.preventDefault();
    respondOnce({ id: request.id, value: value.trim() });
  };

  const reopenBrowser = async (url: string) => {
    if (!onOpenExternal) return;
    setBrowserError("");
    try {
      await onOpenExternal(url);
    } catch (error) {
      setBrowserError(`Не удалось открыть браузер: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return (
    <div className="overlay-screen omp-ui-overlay" role="dialog" aria-modal="true" aria-label={authentication ? "Вход через OMP" : dialogTitle(request)}>
      <section ref={rootRef} className={`terminal-frame install-dialog${authentication ? " omp-auth-dialog" : ""}`} tabIndex={-1}>
        <div className="frame-title">{authentication ? "Авторизация провайдера" : "OMP запрашивает ввод"}</div>
        <div className="dialog-content">
          <h2>{authentication ? "Вход через OMP" : dialogTitle(request)}</h2>
          {authentication ? (
            <div className="auth-browser-card">
              <div>
                <strong>Продолжите вход в системном браузере</strong>
                <p>После подтверждения вставьте сюда код или полный URL, на который вас перенаправил провайдер.</p>
              </div>
              <button type="button" onClick={() => void reopenBrowser(browserRequest.url)}>Открыть браузер снова</button>
              {browserError ? <p className="field-error" role="alert">{browserError}</p> : null}
            </div>
          ) : null}
          {request.type === "select" ? (
            <div className="selector-list" role="listbox" aria-label={request.title}>
              {request.options.map((option) => <button type="button" role="option" aria-selected="false" key={option} onClick={() => respondOnce({ id: request.id, value: option })}>{option}</button>)}
            </div>
          ) : null}
          {request.type === "confirm" ? <p>{request.message}</p> : null}
          {request.type === "input" || request.type === "editor" ? (
            <form onSubmit={submitValue}>
              {request.type === "input"
                ? <label className="dialog-field"><span>{authentication ? "Код или URL перенаправления" : request.title ?? request.message}</span><input autoFocus placeholder={authentication ? "Вставьте код или https://…" : request.placeholder} value={value} onChange={(event) => setValue(event.target.value)} autoComplete="off" /></label>
                : <textarea autoFocus aria-label={request.title} value={value} onChange={(event) => setValue(event.target.value)} rows={10} />}
              {authentication ? <p className="dialog-hint">Mahiko передаст значение напрямую OMP. Данные аккаунта и сессии не удаляются.</p> : null}
              <div className="dialog-actions"><button type="button" onClick={cancel}>{authentication ? "Отменить вход" : "Отмена"}</button><button type="submit" className="primary" disabled={!value.trim()}>{authentication ? "Продолжить" : "Отправить"}</button></div>
            </form>
          ) : null}
        </div>
        {request.type === "confirm" ? <div className="dialog-actions"><button type="button" onClick={() => respondOnce({ id: request.id, confirmed: false })}>Нет</button><button type="button" className="primary" onClick={() => respondOnce({ id: request.id, confirmed: true })}>Да</button></div> : null}
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
