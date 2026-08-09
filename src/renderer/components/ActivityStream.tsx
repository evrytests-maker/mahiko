import { useEffect, useMemo, useState, type JSX } from "react";
import type { ActivityEvent, ActivityKind, ActivityRun, ActivityStatus, ObservedThinkingBlock } from "../../shared/contracts";

interface ActivityStreamProps {
  run: ActivityRun;
  onStop(): void;
  onRetry(run: ActivityRun): void;
}

const MAX_VISIBLE_EVENTS = 5;
const MAX_OUTPUT_LINES = 20;

const statusPresentation: Record<ActivityStatus, { glyph: string; label: string }> = {
  pending: { glyph: "○", label: "Ожидает" },
  running: { glyph: "◉", label: "Выполняется" },
  success: { glyph: "✓", label: "Готово" },
  error: { glyph: "!", label: "Ошибка" },
  cancelled: { glyph: "×", label: "Отменено" },
};

const kindLabels: Record<ActivityKind, string> = {
  explore: "Обзор",
  read: "Чтение",
  plan: "План",
  edit: "Изменение",
  command: "Команда",
  verify: "Проверка",
  complete: "Итог",
  error: "Ошибка",
  cancelled: "Отмена",
};

export function ActivityStream({ run, onStop, onRetry }: ActivityStreamProps): JSX.Element {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [showAll, setShowAll] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const currentEvent = getCurrentEvent(run);
  const events = useMemo(() => selectVisibleEvents(run.events, showAll, currentEvent?.id), [currentEvent?.id, run.events, showAll]);
  const hiddenCount = Math.max(0, run.events.length - events.length);
  const plannedEvents = run.events.filter((event) => event.kind !== "error" && event.kind !== "cancelled");
  const completedCount = plannedEvents.filter((event) => event.status === "success").length;
  const isActive = run.status === "pending" || run.status === "running";
  const announcement = createAnnouncement(run, currentEvent, copyState);

  useEffect(() => {
    if (!isActive) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [isActive]);

  useEffect(() => {
    setCopyState("idle");
  }, [run.attempt, run.status]);

  const toggleDetails = (id: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const copyDetails = async () => {
    try {
      await writeClipboard(serializeRun(run));
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  };

  return (
    <section className={`activity-stream activity-stream-compact activity-run-${run.status}`} aria-label={`Ход выполнения: ${run.safeSummary}`}>
      <p className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</p>
      <header className="activity-header">
        <div className="activity-heading">
          <strong>{currentEvent?.summary ?? run.safeSummary}</strong>
          <span className="activity-progress">{completedCount}/{plannedEvents.length} шагов · попытка {run.attempt + 1}</span>
        </div>
        <div className="activity-runtime" aria-label={`Прошло ${formatElapsed(getRunElapsed(run, now))}`}>
          <span>{formatElapsed(getRunElapsed(run, now))}</span>
          {isActive ? <button type="button" className="activity-stop" onClick={onStop}>■ Остановить <kbd>Esc</kbd></button> : null}
        </div>
      </header>

      {run.thinkingBlocks.length ? <ThinkingTrace blocks={run.thinkingBlocks} isActive={isActive} /> : null}

      <ol className="activity-list">
        {events.map((event) => (
          <ActivityRow
            key={event.id}
            event={event}
            now={now}
            expanded={expandedIds.has(event.id)}
            onToggle={() => toggleDetails(event.id)}
          />
        ))}
      </ol>

      {run.events.length > MAX_VISIBLE_EVENTS ? (
        <button type="button" className="activity-more" aria-expanded={showAll} onClick={() => setShowAll((value) => !value)}>
          {showAll ? "Свернуть список" : `Ещё ${hiddenCount} ${pluralize(hiddenCount, "шаг", "шага", "шагов")}`}
        </button>
      ) : null}

      {!isActive ? (
        <footer className="activity-actions">
          <span className={`activity-final activity-final-${run.status}`}>
            {statusPresentation[run.status].glyph} {statusPresentation[run.status].label}
          </span>
          {(run.status === "error" || run.status === "cancelled") ? (
            <button type="button" className="activity-action" onClick={() => onRetry(run)}>↻ Повторить</button>
          ) : null}
          <button type="button" className="activity-action" onClick={() => void copyDetails()}>
            {copyState === "copied" ? "✓ Скопировано" : copyState === "error" ? "! Не скопировано" : "⧉ Копировать детали"}
          </button>
        </footer>
      ) : null}
    </section>
  );
}

function ThinkingTrace({ blocks, isActive }: { blocks: ObservedThinkingBlock[]; isActive: boolean }): JSX.Element {
  return (
    <section className="activity-thinking" aria-label="Thinking модели">
      <header>
        <span>THINKING · ПЕРЕДАНО МОДЕЛЬЮ</span>
        <small>{blocks.length} {pluralize(blocks.length, "блок", "блока", "блоков")}</small>
      </header>
      {blocks.map((block, index) => (
        <details key={block.contentIndex} open={isActive && index === blocks.length - 1}>
          <summary>
            <span>Блок {index + 1}</span>
            <small>{block.status === "running" ? "поступает…" : "готово"}</small>
          </summary>
          <pre>{block.text || "Ожидаем текст от модели…"}</pre>
        </details>
      ))}
    </section>
  );
}

function ActivityRow({ event, now, expanded, onToggle }: { event: ActivityEvent; now: number; expanded: boolean; onToggle(): void }): JSX.Element {
  const presentation = statusPresentation[event.status];
  const detailsId = `activity-details-${sanitizeId(event.id)}`;
  const hasDetails = Boolean(event.detail || event.command || event.output?.length || event.errorMessage || event.recoveryHint);
  const duration = getEventElapsed(event, now);

  return (
    <li className={`activity-event activity-event-${event.status}`} data-kind={event.kind}>
      <span className="activity-rail" aria-hidden="true"><span>{presentation.glyph}</span></span>
      {hasDetails ? (
        <button type="button" className="activity-row-toggle" aria-expanded={expanded} aria-controls={detailsId} onClick={onToggle}>
          <ActivityRowSummary event={event} statusLabel={presentation.label} duration={duration} expanded={expanded} expandable />
        </button>
      ) : (
        <div className="activity-row-static">
          <ActivityRowSummary event={event} statusLabel={presentation.label} duration={duration} expanded={false} expandable={false} />
        </div>
      )}
      {hasDetails && expanded ? <ActivityDetails id={detailsId} event={event} /> : null}
    </li>
  );
}

function ActivityRowSummary({ event, statusLabel, duration, expanded, expandable }: { event: ActivityEvent; statusLabel: string; duration: number; expanded: boolean; expandable: boolean }): JSX.Element {
  return (
    <>
      <span className="activity-kind">{kindLabels[event.kind]}</span>
      <span className="activity-summary">{event.summary}</span>
      <span className="activity-meta"><span>{statusLabel}</span><span>{formatDuration(duration, event.status, Boolean(event.startedAt))}</span>{expandable ? <span aria-hidden="true">{expanded ? "⌃" : "⌄"}</span> : null}</span>
    </>
  );
}

function ActivityDetails({ id, event }: { id: string; event: ActivityEvent }): JSX.Element {
  const output = event.output ?? [];
  const visibleOutput = output.slice(-MAX_OUTPUT_LINES);
  const hiddenLines = Math.max(0, output.length - visibleOutput.length);
  return (
    <div id={id} className="activity-details">
      {event.detail ? <p>{event.detail}</p> : null}
      {event.command ? (
        <div className="activity-detail-block">
          <span>Команда</span>
          <code><b aria-hidden="true">$</b> {event.command}</code>
        </div>
      ) : null}
      {typeof event.exitCode === "number" && event.status !== "pending" && event.status !== "running" ? (
        <div className="activity-detail-block activity-exit-code"><span>Код завершения</span><code>{event.exitCode}</code></div>
      ) : null}
      {visibleOutput.length ? (
        <div className="activity-detail-block">
          <span>Вывод {hiddenLines ? `· последние ${visibleOutput.length} из ${output.length} строк` : `· ${output.length} ${pluralize(output.length, "строка", "строки", "строк")}`}</span>
          <pre>{visibleOutput.join("\n")}</pre>
        </div>
      ) : null}
      {event.errorMessage ? <p className="activity-error-message"><strong>Ошибка:</strong> {event.errorMessage}</p> : null}
      {event.recoveryHint ? <p className="activity-recovery"><strong>Следующий шаг:</strong> {event.recoveryHint}</p> : null}
    </div>
  );
}

function getCurrentEvent(run: ActivityRun): ActivityEvent | undefined {
  return run.events.find((event) => event.status === "running")
    ?? [...run.events].reverse().find((event) => event.kind === "error" || event.kind === "cancelled" || event.kind === "complete")
    ?? [...run.events].reverse().find((event) => event.status === "success")
    ?? run.events[0];
}

function selectVisibleEvents(events: ActivityEvent[], showAll: boolean, currentId?: string): ActivityEvent[] {
  if (showAll || events.length <= MAX_VISIBLE_EVENTS) return events;
  const currentIndex = currentId ? events.findIndex((event) => event.id === currentId) : -1;
  if (currentIndex >= MAX_VISIBLE_EVENTS) return [...events.slice(0, MAX_VISIBLE_EVENTS - 1), events[currentIndex]!];
  return events.slice(0, MAX_VISIBLE_EVENTS);
}

function getRunElapsed(run: ActivityRun, now: number): number {
  return Math.max(0, (run.endedAt ?? now) - run.startedAt);
}

function getEventElapsed(event: ActivityEvent, now: number): number {
  if (!event.startedAt) return 0;
  return Math.max(0, (event.endedAt ?? now) - event.startedAt);
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatDuration(ms: number, status: ActivityStatus, started: boolean): string {
  if (status === "pending" || (status === "cancelled" && !started)) return "—";
  if (ms < 1_000) return `${Math.round(ms)} мс`;
  return `${(ms / 1_000).toFixed(ms < 10_000 ? 1 : 0)} с`;
}

function serializeRun(run: ActivityRun): string {
  const lines = [
    `Activity: ${run.safeSummary}`,
    `Статус: ${statusPresentation[run.status].label}`,
    `Попытка: ${run.attempt + 1}`,
    "",
  ];
  for (const [index, block] of run.thinkingBlocks.entries()) {
    lines.push(`Thinking ${index + 1} (${block.status === "running" ? "поток" : "готово"}):`);
    lines.push(block.text || "[пустой наблюдаемый блок]");
    lines.push("");
  }
  for (const event of run.events) {
    lines.push(`[${statusPresentation[event.status].label}] ${kindLabels[event.kind]} — ${event.summary}`);
    if (event.detail) lines.push(`  ${event.detail}`);
    if (event.command) lines.push(`  $ ${event.command}`);
    if (typeof event.exitCode === "number") lines.push(`  Код завершения: ${event.exitCode}`);
    if (event.output?.length) lines.push(...event.output.map((line) => `  ${line}`));
    if (event.errorMessage) lines.push(`  Ошибка: ${event.errorMessage}`);
    if (event.recoveryHint) lines.push(`  Следующий шаг: ${event.recoveryHint}`);
  }
  return lines.join("\n");
}

async function writeClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Clipboard API недоступен");
}

function createAnnouncement(run: ActivityRun, current: ActivityEvent | undefined, copyState: "idle" | "copied" | "error"): string {
  if (copyState === "copied") return "Детали выполнения скопированы";
  if (copyState === "error") return "Не удалось скопировать детали выполнения";
  if (run.status === "success") return "Задача завершена успешно";
  if (run.status === "error") return `Задача завершилась с ошибкой: ${run.safeSummary}`;
  if (run.status === "cancelled") return "Задача отменена";
  return current ? `${statusPresentation[current.status].label}: ${current.summary}` : run.safeSummary;
}

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function pluralize(value: number, one: string, few: string, many: string): string {
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
