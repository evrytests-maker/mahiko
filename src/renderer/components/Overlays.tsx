import { useMemo, useState, type ChangeEvent, type JSX, type KeyboardEvent } from "react";
import type { AppSettings, ThemeName } from "../../shared/contracts";
import { settingsTabs, slashCommands } from "../data";
import { useModalFocusTrap, useNonModalSurfaceFocus } from "./accessibility";
import { TuiEscapeButton } from "./TuiControls";

const APP_THEMES: ReadonlyArray<{ value: ThemeName; label: string; hint: string }> = [
  { value: "omp", label: "OMP", hint: "Titanium TUI" },
  { value: "claude", label: "Claude Code", hint: "тёплый терминал" },
  { value: "codex", label: "Codex", hint: "нейтральный desktop" },
];

interface SettingsOverlayProps {
  settings: AppSettings | null;
  initialTab?: string;
  initialSection?: string;
  onUpdate(patch: Partial<AppSettings>): Promise<void>;
  onClose(): void;
}

export function SettingsOverlay({ settings, onUpdate, onClose }: SettingsOverlayProps): JSX.Element {
  const rootRef = useModalFocusTrap(onClose, '#settings-trigger, #environment-trigger, [aria-label="Сообщение mahiko"]');
  return (
    <div ref={rootRef} className="overlay-screen" role="dialog" aria-modal="true" aria-label="Настройки OMP" tabIndex={-1}>
      <section className="terminal-frame settings-frame">
        <div className="frame-title">Настройки приложения</div>
        <TuiEscapeButton className="settings-close" label="Закрыть настройки" onClick={onClose} />
        <div className="settings-tabs" role="tablist" aria-label="Разделы настроек">
          {settingsTabs.map(([name, icon, label], index) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={index === 0}
              aria-label={label}
              disabled={index !== 0}
              title={index === 0 ? label : `${label}: запись этого раздела не поддерживается OMP RPC 17.2.9`}
            >
              <span className="settings-code">{icon}</span>{index === 0 ? <span>{label}</span> : null}
            </button>
          ))}
        </div>
        <div className="settings-content">
          <div className="theme-switcher" role="group" aria-label="Цветовая тема">
            <div className="theme-switcher-copy"><strong>Оформление окна</strong><span>Сохраняется локально приложением.</span></div>
            <div className="theme-switcher-options">
              {APP_THEMES.map((theme) => (
                <button type="button" key={theme.value} aria-pressed={settings?.theme === theme.value} onClick={() => void onUpdate({ theme: theme.value })}>
                  <span className="theme-swatch" data-theme-preview={theme.value} aria-hidden="true" />
                  <span><strong>{theme.label}</strong><small>{theme.hint}</small></span>
                </button>
              ))}
            </div>
          </div>
          <div className="plugin-empty" role="status">
            <div className="inner-rule" />
            <h3>Live OMP controls</h3>
            <p className="muted">Модель, reasoning и compaction меняются через контролы под полем ввода. Остальные разделы отключены, потому что RPC 17.2.9 не предоставляет безопасный контракт записи для них.</p>
            <div className="inner-rule" />
          </div>
        </div>
        <div className="setting-description"><span>› Оформление окна</span><small>Единственный параметр этого окна, который приложение действительно сохраняет.</small></div>
        <div className="overlay-help">Tab — перейти · Enter — выбрать · Esc — закрыть</div>
      </section>
    </div>
  );
}

export function CommandPalette({ onClose, onCommand }: { onClose(): void; onCommand(command: string): void }): JSX.Element {
  const rootRef = useNonModalSurfaceFocus(onClose, '[aria-label="Открыть команды"], [aria-label="Сообщение mahiko"]');
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const filtered = useMemo(() => slashCommands.filter(([command, description]) => `${command} ${description}`.toLowerCase().includes(query.toLowerCase())), [query]);

  return (
    <div ref={rootRef} className="palette-backdrop nonblocking-surface" role="dialog" aria-modal="false" aria-label="Палитра команд" tabIndex={-1} onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "ArrowDown") { event.preventDefault(); setSelected((value) => Math.min(Math.max(0, filtered.length - 1), value + 1)); }
      else if (event.key === "ArrowUp") { event.preventDefault(); setSelected((value) => Math.max(0, value - 1)); }
      else if (event.key === "Enter" && filtered[selected]) { event.preventDefault(); onCommand(filtered[selected][0]); }
    }}>
      <section className="terminal-frame command-palette">
        <div className="frame-title">Команды</div>
        <TuiEscapeButton className="settings-close window-corner" label="Закрыть палитру команд" onClick={onClose} />
        <label className="palette-search"><span>⌕ &gt;</span><input name="command-search" autoComplete="off" aria-label="Фильтр команд" data-initial-focus value={query} onChange={(event: ChangeEvent<HTMLInputElement>) => { setQuery(event.target.value); setSelected(0); }} /></label>
        <div className="palette-list" role="listbox">
          {filtered.map(([command, description], index) => <button key={command} type="button" role="option" aria-selected={index === selected} className={index === selected ? "selected" : ""} onMouseEnter={() => setSelected(index)} onClick={() => onCommand(command)}><span>{index === selected ? "❯" : " "} {command}</span><span>{description}</span><span>{index === selected ? "█" : "│"}</span></button>)}
          {!filtered.length ? <p className="empty-line">Команды не найдены</p> : null}
        </div>
        <div className="overlay-help">↑/↓ — выбрать · Enter — открыть · Esc — закрыть</div>
      </section>
    </div>
  );
}
