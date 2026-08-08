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
  const installed = snapshot?.installed ?? null;
  const actionLabel = installed
    ? `Заменить на версию ${snapshot?.expectedVersion ?? "17.2.9"}`
    : `Установить OMP ${snapshot?.expectedVersion ?? "17.2.9"}`;
  const canInstall = snapshot?.bundledReady === true && (!installed || installed.replaceable);

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
              <span className={installed ? "warning" : "dim"}>{installed ? "● НАЙДЕН" : "○ НЕ НАЙДЕН"}</span>
              <strong>{installed ? `OMP ${installed.version ?? "неизвестной версии"}` : "Внешняя установка отсутствует"}</strong>
              {installed ? <code>{installed.path}</code> : null}
              <p>{snapshot.detail}</p>
            </div>
          ) : null}
          <div className="setup-note omp-data-safety-note">
            <strong>Чаты и аккаунты сохраняются</strong>
            <span>Mahiko заменяет только исполняемый файл OMP. Каталоги данных, профили, сессии и базы аккаунтов не удаляются и не перемещаются.</span>
            {snapshot?.dataLocations.length ? <details><summary>Проверенные расположения данных</summary>{snapshot.dataLocations.map((path) => <code key={path}>{path}</code>)}</details> : null}
          </div>
          {installed && !installed.replaceable ? <div className="inline-status">Этот OMP находится вне пользовательского каталога. Автоматическая замена заблокирована; Mahiko не запрашивает повышенные права и не удаляет системные файлы.</div> : null}
          {error ? <div className="inline-status" role="alert">{error}</div> : null}
        </div>
        <footer className="setup-footer omp-bootstrap-actions">
          <span className={snapshot?.bundledReady ? "success" : "warning"}>{snapshot?.bundledReady ? "● OMP 17.2.9 ПРОВЕРЕН" : "○ OMP НЕ ГОТОВ"}</span>
          <div>
            <button type="button" onClick={onExit} disabled={busy}>Выход</button>
            <button type="button" className="primary" onClick={onInstall} disabled={!canInstall || busy}>{busy ? "Установка…" : actionLabel}</button>
          </div>
        </footer>
      </section>
    </div>
  );
}

export function OmpSetupOverlay({ onClose, onComplete, runtime }: { onClose(): void; onComplete(): void; runtime: RuntimeSnapshot | null }): JSX.Element {
  const rootRef = useNonModalSurfaceFocus(onClose, "#environment-trigger");
  const [tab, setTab] = useState<"providers" | "pool" | "custom">("providers");
  const [providers, setProviders] = useState<OmpLoginProvider[]>([]);
  const [providersLoading, setProvidersLoading] = useState(runtime?.rpc.ready === true);
  const [loginBusy, setLoginBusy] = useState<string | null>(null);
  const [poolRows, setPoolRows] = useState<PoolRow[]>([]);
  const [poolSnapshot, setPoolSnapshot] = useState<AccountPoolSnapshot | null>(null);
  const [poolLoading, setPoolLoading] = useState(true);
  const [poolSaving, setPoolSaving] = useState(false);
  const [status, setStatus] = useState("");

  const refreshProviders = async () => {
    const observed = await api.omp.getLoginProviders();
    setProviders(observed);
    return observed;
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

    if (runtime?.rpc.ready) {
      void api.omp.getLoginProviders()
        .then((observed) => { if (active) setProviders(observed); })
        .catch((error: unknown) => { if (active) setStatus(`Ошибка OMP: ${messageFrom(error)}`); })
        .finally(() => { if (active) setProvidersLoading(false); });
    } else {
      setProvidersLoading(false);
    }
    return () => { active = false; };
  }, [runtime?.rpc.ready]);

  const login = async (provider: OmpLoginProvider) => {
    setLoginBusy(provider.id);
    setStatus(`Открываю авторизацию ${provider.name}. Завершите регистрацию или вход в окне браузера…`);
    try {
      const result = await api.omp.login(provider.id);
      await refreshProviders();
      setStatus(result.message);
    } catch (error) {
      setStatus(`Ошибка авторизации: ${messageFrom(error)}`);
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
          <div><h2>Настройка среды</h2><p>Подключение провайдеров, регистрация и пулы аккаунтов работают через OMP.</p></div>
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
              {providersLoading ? <div className="empty-state">Читаю провайдеры OMP…</div> : null}
              {!providersLoading && providers.length === 0 ? <div className="empty-state">OMP не сообщил доступных провайдеров.</div> : null}
              {providers.map((provider) => {
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
              })}
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
