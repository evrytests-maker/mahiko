import "./styles.css";
import type { RuntimeSnapshot } from "../shared/contracts";

const fields = {
  executable: document.querySelector<HTMLElement>("#executable"),
  version: document.querySelector<HTMLElement>("#version"),
  compatibility: document.querySelector<HTMLElement>("#compatibility"),
  rpc: document.querySelector<HTMLElement>("#rpc"),
  detail: document.querySelector<HTMLElement>("#detail"),
};
const refreshButton = document.querySelector<HTMLButtonElement>("#refresh");

function render(snapshot: RuntimeSnapshot): void {
  if (fields.executable) fields.executable.textContent = snapshot.executable ?? "не найден";
  if (fields.version) fields.version.textContent = snapshot.version ?? "неизвестна";
  if (fields.compatibility) {
    fields.compatibility.textContent = snapshot.compatible ? "точное совпадение" : `нужна ${snapshot.expectedVersion}`;
    fields.compatibility.dataset.state = snapshot.compatible ? "ready" : "blocked";
  }
  if (fields.rpc) {
    fields.rpc.textContent = snapshot.rpc.ready
      ? `${snapshot.rpc.mode} · protocol v${snapshot.rpc.protocolVersion}`
      : "не готов";
    fields.rpc.dataset.state = snapshot.rpc.ready ? "ready" : "blocked";
  }
  if (fields.detail) fields.detail.textContent = snapshot.rpc.detail;
}

async function refresh(initial = false): Promise<void> {
  if (!window.mohiko) {
    if (fields.detail) fields.detail.textContent = "Electron preload недоступен. Запустите приложение через npm start.";
    return;
  }
  if (refreshButton) refreshButton.disabled = true;
  if (fields.detail) fields.detail.textContent = "Проверяю OMP…";
  try {
    render(initial ? await window.mohiko.runtime.getSnapshot() : await window.mohiko.runtime.refresh());
  } catch (error) {
    if (fields.detail) fields.detail.textContent = error instanceof Error ? error.message : "Не удалось проверить OMP";
  } finally {
    if (refreshButton) refreshButton.disabled = false;
  }
}

refreshButton?.addEventListener("click", () => void refresh());
void refresh(true);
