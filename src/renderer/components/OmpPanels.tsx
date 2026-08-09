import { useEffect, useState, type ChangeEvent, type FormEvent, type JSX, type KeyboardEvent } from "react";
import type { AccountPoolConfig, AccountPoolSnapshot, CustomProviderRequest, OmpInstallationSnapshot, OmpLoginProvider, RuntimeSnapshot } from "../../shared/contracts";
import { api } from "../api";
import { useNonModalSurfaceFocus } from "./accessibility";
import { TuiEscapeButton } from "./TuiControls";

export interface ProviderSetupDraft {
  providerId: string;
  baseUrl: string;
  api: string;
  auth: "api-key" | "none";
  apiKey: string;
  modelId: string;
  modelName: string;
}

interface PoolRow {
  provider: string;
  identities: string;
}

type ProviderLoadState = "starting" | "runtime-error" | "loading" | "provider-error" | "success";

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function rowsFromPool(value: AccountPoolConfig): PoolRow[] {
  return Object.entries(value).map(([provider, identities]) => ({ provider, identities: identities.join("\n") }));
}

export function OmpBootstrapOverlay({ snapshot, busy, error, onInstall, onExit }: {
  snapshot: OmpInstallationSnapshot | null;
  busy: boolean;
  error: string;
  onInstall(): void;
  onExit(): void;
}): JSX.Element {
  const external = snapshot?.external ?? null;
  const selectedPath = snapshot?.selectedPath ?? null;
  const actionLabel = selectedPath
    ? `Использовать OMP ${snapshot?.expectedVersion ?? "17.2.9"}`
    : `Установить OMP ${snapshot?.expectedVersion ?? "17.2.9"} как CLI`;
  const canInstall = snapshot !== null;

  return (
    <div className="surface-layer setup-surface-layer omp-bootstrap-layer" role="dialog" aria-modal="true" aria-label="Первоначальная настройка OMP" tabIndex={-1} autoFocus onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onExit(); }
    }}>
      <section className="terminal-frame omp-bootstrap-frame">
        <header className="setup-header">
          <div className="setup-mark">π</div>
          <div><h2>Поиск OMP</h2><p>Mahiko использует зафиксированную версию OMP 17.2.9.</p></div>
        </header>
        <div className="omp-bootstrap-content">
          {!snapshot ? <div className="empty-state">Проверяю установку OMP…</div> : null}
          {snapshot ? (
            <div className="omp-installation-result">
              <span className={selectedPath ? "success" : external ? "warning" : "dim"}>{selectedPath ? "● ГОТОВ" : external ? "● НЕСОВМЕСТИМ" : "○ НЕ НАЙДЕН"}</span>
              <strong>{snapshot.managedReady ? `Официальный OMP ${snapshot.expectedVersion}` : external ? `Внешний OMP ${external.version ?? "неизвестной версии"}` : "Совместимая установка отсутствует"}</strong>
              {selectedPath || external?.path ? <code>{selectedPath || external?.path}</code> : <code>{snapshot.managedPath}</code>}
              <p>{snapshot.detail}</p>
            </div>
          ) : null}
          <div className="setup-note omp-data-safety-note">
            <strong>Чаты и аккаунты сохраняются</strong>
            <span>Mahiko запускает официальный installer OMP. Команда omp будет доступна в терминале и использует те же профили, сессии и аккаунты, что и Mahiko; базы данных не удаляются и не перемещаются.</span>
            {snapshot?.dataLocations.length ? <details><summary>Проверенные расположения данных</summary>{snapshot.dataLocations.map((path) => <code key={path}>{path}</code>)}</details> : null}
          </div>
          {error ? <div className="inline-status" role="alert">{error}</div> : null}
        </div>
        <footer className="setup-footer omp-bootstrap-actions">
          <span className={selectedPath ? "success" : "warning"}>{selectedPath ? "● OMP 17.2.9 ПРОВЕРЕН" : "○ ТРЕБУЕТСЯ УСТАНОВКА CLI"}</span>
          <div>
            <button type="button" onClick={onExit} disabled={busy}>Выход</button>
            <button type="button" className="primary" onClick={onInstall} disabled={!canInstall || busy}>{busy ? "Установка и проверка…" : actionLabel}</button>
          </div>
        </footer>
      </section>
    </div>
  );
}

export function OmpSetupOverlay({ onClose, onComplete, onRetryRuntime, runtime }: { onClose(): void; onComplete(): void; onRetryRuntime(): Promise<void>; runtime: RuntimeSnapshot | null }): JSX.Element {
  const rootRef = useNonModalSurfaceFocus(onClose, "#environment-trigger");
  const runtimePath = runtime?.executable || runtime?.versionCheck.path || "Путь OMP неизвестен";
  const [tab, setTab] = useState<"providers" | "pool" | "custom">("providers");
  const [providers, setProviders] = useState<OmpLoginProvider[]>([]);
  const [providerState, setProviderState] = useState<ProviderLoadState>(runtime ? runtime.rpc.ready ? "loading" : "runtime-error" : "starting");
  const [providerError, setProviderError] = useState("");
  const [loginBusy, setLoginBusy] = useState<string | null>(null);
  const [poolRows, setPoolRows] = useState<PoolRow[]>([]);
  const [poolSnapshot, setPoolSnapshot] = useState<AccountPoolSnapshot | null>(null);
  const [poolLoading, setPoolLoading] = useState(true);
  const [poolSaving, setPoolSaving] = useState(false);
  const [status, setStatus] = useState("");

  const refreshProviders = async () => {
    setProviderState("loading");
    setProviderError("");
    try {
      const observed = await api.omp.getLoginProviders();
      setProviders(observed);
      setProviderState("success");
      return observed;
    } catch (error) {
      setProviderError(messageFrom(error));
      setProviderState("provider-error");
      throw error;
    }
  };

  useEffect(() => {
    let active = true;
    void api.omp.getAccountPool()
      .then((snapshot) => {
        if (!active) return;
        setPoolSnapshot(snapshot);
        setPoolRows(rowsFromPool(snapshot.value));
      })
      .catch((error: unknown) => { if (active) setStatus(`Ошибка чтения пула: ${messageFrom(error)}`); })
      .finally(() => { if (active) setPoolLoading(false); });

    if (!runtime) {
      setProviders([]);
      setProviderState("starting");
      setProviderError("");
    } else if (runtime.rpc.ready) {
      setProviderState("loading");
      setProviderError("");
      void api.omp.getLoginProviders()
        .then((observed) => { if (active) { setProviders(observed); setProviderState("success"); } })
        .catch((error: unknown) => { if (active) { setProviderError(messageFrom(error)); setProviderState("provider-error"); } });
    } else {
      setProviders([]);
      setProviderState("runtime-error");
      setProviderError("");
    }
    return () => { active = false; };
  }, [runtime?.checkedAt, runtime?.rpc.ready]);

  const retryRuntime = async () => {
    setProviders([]);
    setProviderError("");
    setProviderState("starting");
    try {
      await onRetryRuntime();
    } catch (error) {
      setProviderError(`Не удалось повторно проверить OMP: ${messageFrom(error)}`);
      setProviderState("runtime-error");
    }
  };

  const login = async (provider: OmpLoginProvider) => {
    setLoginBusy(provider.id);
    setStatus(`Открываю авторизацию ${provider.name}. Завершите регистрацию или вход в окне браузера…`);
    try {
      const result = await api.omp.login(provider.id);
      await refreshProviders();
      setStatus(result.message);
    } catch (error) {
      const message = messageFrom(error);
      setStatus(/oauth callback cancell?ed|operation was cancelle?d/i.test(message) ? "Вход отменён." : `Ошибка авторизации: ${message}`);
    } finally {
      setLoginBusy(null);
    }
  };

  const savePool = async () => {
    const next: AccountPoolConfig = {};
    for (const row of poolRows) {
      const provider = row.provider.trim();
      const identities = row.identities.split(/\r?\n/).map((identity) => identity.trim()).filter(Boolean);
      if (!provider && identities.length === 0) continue;
      if (!provider) { setStatus("Укажите provider для каждой заполненной строки."); return; }
      if (Object.hasOwn(next, provider)) { setStatus(`Provider ${provider} указан дважды.`); return; }
      next[provider] = identities;
    }

    setPoolSaving(true);
    try {
      const snapshot = await api.omp.setAccountPool(next);
      setPoolSnapshot(snapshot);
      setPoolRows(rowsFromPool(snapshot.value));
      setStatus(snapshot.requiresRestart
        ? `Пул сохранён: ${snapshot.filePath}. OMP будет перезапущен с новой конфигурацией.`
        : `Пул сохранён: ${snapshot.filePath}.`);
    } catch (error) {
      setStatus(`Ошибка сохранения пула: ${messageFrom(error)}`);
    } finally {
      setPoolSaving(false);
    }
  };

  return (
    <div ref={rootRef} className="surface-layer setup-surface-layer" role="dialog" aria-modal="false" aria-label="Подключение OMP" tabIndex={-1} onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
    }}>
      <section className="terminal-frame setup-frame setup-frame-nonmodal">
        <TuiEscapeButton className="settings-close window-corner" label="Закрыть подключение OMP" onClick={onClose} />
        <header className="setup-header">
          <div className="setup-mark">π</div>
          <div><h2>Настройка среды</h2></div>
        </header>
        <div className="setup-tabs" role="tablist" aria-label="Разделы подключения OMP">
          <button type="button" role="tab" aria-selected={tab === "providers"} onClick={() => setTab("providers")}>Провайдеры</button>
          <button type="button" role="tab" aria-selected={tab === "pool"} onClick={() => setTab("pool")}>Аккаунты</button>
          <button type="button" role="tab" aria-selected={tab === "custom"} onClick={() => setTab("custom")}>Custom API</button>
        </div>
        <div className="setup-content">
          {status ? <div className="inline-status" aria-live="polite">{status}</div> : null}
          {tab === "providers" ? (
            <section className="provider-grid" aria-label="Провайдеры">
              <div className="setup-note">
                <strong>Регистрация через GUI</strong>
                <span>Кнопка запускает штатную авторизацию OMP. Пароль, CAPTCHA и подтверждения вводятся только в защищённом окне провайдера.</span>
              </div>
              {providerState === "starting" ? <div className="empty-state">OMP запускается…</div> : null}
              {providerState === "loading" ? <div className="empty-state">Читаю провайдеры OMP…</div> : null}
              {providerState === "runtime-error" ? (
                <div className="setup-note inline-status provider-runtime-status" role="alert">
                  <strong>OMP RPC не готов</strong>
                  <span>Стадия: {runtime?.rpc.failureStage ?? "readiness"}{runtime?.rpc.errorCode ? ` · ${runtime.rpc.errorCode}` : ""}</span>
                  <span>{providerError || runtime?.rpc.detail || "Readiness OMP ещё не завершена."}</span>
                  <code>{runtimePath}</code>
                  <button type="button" onClick={() => void retryRuntime()}>Повторить</button>
                </div>
              ) : null}
              {providerState === "provider-error" ? (
                <div className="setup-note inline-status provider-runtime-status" role="alert">
                  <strong>Ошибка списка провайдеров</strong>
                  <span>Стадия: get_login_providers</span>
                  <span>{providerError}</span>
                  <code>{runtimePath}</code>
                  <button type="button" onClick={() => void retryRuntime()}>Повторить</button>
                </div>
              ) : null}
              {providerState === "success" && providers.length === 0 ? <div className="empty-state">OMP не сообщил доступных провайдеров.</div> : null}
              {providerState === "success" ? providers.map((provider) => {
                const busy = loginBusy === provider.id;
                const action = provider.authenticated ? `Переподключить ${provider.name}` : `Подключить ${provider.name}`;
                return (
                  <div className="provider-row" key={provider.id}>
                    <span className={provider.authenticated ? "success" : provider.available ? "accent" : "dim"}>{provider.authenticated ? "●" : "○"}</span>
                    <span className="provider-identity"><strong>{provider.name}</strong><code>{provider.id}</code></span>
                    <em>{provider.authenticated ? "Подключён" : provider.available ? "Доступен" : "Недоступен"}</em>
                    <button type="button" aria-label={action} disabled={!runtime?.rpc.ready || !provider.available || loginBusy !== null} onClick={() => void login(provider)}>{busy ? "Ожидание…" : provider.authenticated ? "Переподключить" : "Подключить / регистрация"}</button>
                  </div>
                );
              }) : null}
            </section>
          ) : null}
          {tab === "pool" ? (
            <section className="pool-editor" aria-label="Аккаунты провайдеров">
              <div className="setup-note">
                <strong>{poolSnapshot?.configured ? "Пул подключён" : "Пул пока пуст"}</strong>
                <span>{poolSnapshot?.filePath ?? "Читаю путь конфигурации…"} · одна identity на строку</span>
              </div>
              {poolLoading ? <div className="empty-state">Читаю пул аккаунтов…</div> : null}
              {!poolLoading && poolRows.length === 0 ? <div className="empty-state">Добавьте provider и реальные identity, которые уже известны OMP.</div> : null}
              {poolRows.map((row, index) => (
                <div className="pool-row" key={index}>
                  <label><span>Provider</span><input value={row.provider} onChange={(event: ChangeEvent<HTMLInputElement>) => setPoolRows((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, provider: event.target.value } : item))} /></label>
                  <label><span>Identity</span><textarea value={row.identities} onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setPoolRows((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, identities: event.target.value } : item))} /></label>
                  <button type="button" aria-label={`Удалить строку ${index + 1}`} onClick={() => setPoolRows((current) => current.filter((_, itemIndex) => itemIndex !== index))}>×</button>
                </div>
              ))}
              <div className="setup-actions">
                <button type="button" onClick={() => setPoolRows((current) => [...current, { provider: "", identities: "" }])}>＋ Добавить</button>
                <button type="button" className="primary" disabled={poolLoading || poolSaving} onClick={() => void savePool()}>{poolSaving ? "Сохраняю…" : "Сохранить пул"}</button>
              </div>
            </section>
          ) : null}
          {tab === "custom" ? <CustomProviderForm onStatus={setStatus} /> : null}
        </div>
        <footer className="setup-footer">
          <span className={runtime?.rpc.ready ? "success" : "dim"}>{runtime?.rpc.ready ? "● OMP" : "○ OMP"}</span>
          <div><button type="button" onClick={onClose}>Пропустить</button><button type="button" className="primary" onClick={onComplete}>Готово</button></div>
        </footer>
      </section>
    </div>
  );
}

function CustomProviderForm({ onStatus }: { onStatus(value: string): void }): JSX.Element {
  const [form, setForm] = useState<ProviderSetupDraft>({ providerId: "", baseUrl: "", api: "openai-responses", auth: "none", apiKey: "", modelId: "", modelName: "" });
  const [busy, setBusy] = useState(false);
  const update = <K extends keyof ProviderSetupDraft>(key: K, value: ProviderSetupDraft[K]) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const request: CustomProviderRequest = {
      providerId: form.providerId.trim(),
      baseUrl: form.baseUrl.trim(),
      api: form.api,
      auth: form.auth,
      modelId: form.modelId.trim(),
      ...(form.modelName.trim() ? { modelName: form.modelName.trim() } : {}),
      ...(form.auth === "api-key" ? { apiKey: form.apiKey } : {}),
    };
    setBusy(true);
    try {
      const result = await api.omp.saveCustomProvider(request);
      onStatus(result.message);
    } catch (error) {
      onStatus(`Ошибка Custom API: ${messageFrom(error)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="custom-provider-form" onSubmit={(event) => void submit(event)}>
      <div className="setup-note"><strong>Реальная конфигурация OMP</strong><span>Настройки сохраняются только после проверки OMP. API key не отображается в статусе и логах интерфейса.</span></div>
      <div className="field-grid">
        <label><span>Provider id</span><input required value={form.providerId} onChange={(event: ChangeEvent<HTMLInputElement>) => update("providerId", event.target.value)} /></label>
        <label><span>Base URL</span><input required type="url" value={form.baseUrl} onChange={(event: ChangeEvent<HTMLInputElement>) => update("baseUrl", event.target.value)} /></label>
        <label><span>API</span><select value={form.api} onChange={(event: ChangeEvent<HTMLSelectElement>) => update("api", event.target.value)}><option value="openai-completions">openai-completions</option><option value="openai-responses">openai-responses</option><option value="anthropic-messages">anthropic-messages</option></select></label>
        <label><span>Credential</span><select value={form.auth} onChange={(event: ChangeEvent<HTMLSelectElement>) => update("auth", event.target.value as ProviderSetupDraft["auth"])}><option value="none">none</option><option value="api-key">API key</option></select></label>
        {form.auth === "api-key" ? <label><span>API key</span><input required type="password" autoComplete="off" value={form.apiKey} onChange={(event: ChangeEvent<HTMLInputElement>) => update("apiKey", event.target.value)} /></label> : null}
        <label><span>Model id</span><input required value={form.modelId} onChange={(event: ChangeEvent<HTMLInputElement>) => update("modelId", event.target.value)} /></label>
        <label><span>Название</span><input value={form.modelName} onChange={(event: ChangeEvent<HTMLInputElement>) => update("modelName", event.target.value)} /></label>
      </div>
      <div className="setup-actions"><button type="submit" className="primary" disabled={busy}>{busy ? "Проверяю…" : "Сохранить и проверить"}</button></div>
    </form>
  );
}
