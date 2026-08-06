import type { ActivityStepTemplate, PreviewOptions, PreviewReply } from "./contracts";

export function createPreviewReply(prompt: string, options: PreviewOptions = {}): PreviewReply {
  const attempt = options.attempt ?? 0;
  const runId = options.runId ?? `preview-${attempt + 1}`;
  const shouldFail = /ошиб|error|fail/i.test(prompt) && attempt === 0;
  const commandOutput = Array.from({ length: 28 }, (_, index) => {
    const line = String(index + 1).padStart(2, "0");
    return `${line}  src/renderer/${index % 3 === 0 ? "App.tsx" : index % 3 === 1 ? "activity.ts" : "components/ActivityStream.tsx"}  проверено`;
  });

  return {
    id: runId,
    summary: shouldFail ? "Проверка остановлена: требуется исправление" : "Предпросмотр завершён, изменения проверены локально",
    chunks: [
      "Проверил границы текущего интерфейса и выполнил детерминированный безопасный предпросмотр. ",
      "Наблюдаемые операции и команды доступны в раскрываемых деталях; скрытое рассуждение не отображается. ",
      "Результат не отправлялся во внешний агент и не изменял файлы проекта.",
    ],
    activity: withStableIds(runId, [
      {
        kind: "explore",
        summary: "Проверяю структуру рабочей области",
        detail: "Сопоставляю доступные renderer-модули и точки интеграции transcript.",
        durationMs: 180,
      },
      {
        kind: "read",
        summary: "Читаю контракты и компоненты transcript",
        detail: "Просматриваются только файлы, относящиеся к текущей операции.",
        durationMs: 220,
        command: "sed -n '1,240p' src/shared/contracts.ts src/renderer/App.tsx",
        output: [
          "src/shared/contracts.ts: ActivityRun, ActivityEvent",
          "src/renderer/App.tsx: transcript integration point",
        ],
      },
      {
        kind: "plan",
        summary: "Формирую краткий план наблюдаемых действий",
        detail: "План содержит действия и проверки, но не внутренние рассуждения модели.",
        durationMs: 160,
      },
      {
        kind: "edit",
        summary: "Готовлю локальное изменение интерфейса",
        detail: "Изменения ограничены renderer-слоем и типизированными контрактами.",
        durationMs: 260,
      },
      {
        kind: "command",
        summary: "Запускаю локальную проверочную команду",
        detail: "Команда выполняется в безопасном предпросмотре с ограниченным выводом.",
        durationMs: 320,
        command: "npm run typecheck",
        output: commandOutput,
        exitCode: 0,
      },
      {
        kind: "verify",
        summary: shouldFail ? "Проверка типов обнаружила воспроизводимую ошибку" : "Проверяю типы и итоговые состояния",
        detail: shouldFail ? "Демонстрационный сценарий ошибки включён содержимым запроса." : "Проверяются переходы состояний и доступность управляющих элементов.",
        durationMs: 260,
        command: "npm test -- --runInBand",
        output: shouldFail
          ? ["FAIL  src/renderer/activity.test.ts", "Expected status: success", "Received status: error", "Process exited with code 1"]
          : ["PASS  activity transitions", "PASS  cancellation cleanup", "PASS  expandable details"],
        exitCode: shouldFail ? 1 : 0,
        outcome: shouldFail ? "error" : "success",
        errorMessage: shouldFail ? "Проверка завершилась с кодом 1" : undefined,
        recoveryHint: shouldFail ? "Исправьте причину ошибки и нажмите «Повторить». Повторная попытка завершится успешно." : undefined,
      },
      {
        kind: "complete",
        summary: "Собираю краткий итог без скрытого рассуждения",
        detail: "Итог содержит только результат и проверяемые факты выполнения.",
        durationMs: 120,
      },
    ]),
  };
}

function withStableIds(runId: string, templates: Omit<ActivityStepTemplate, "id">[]): ActivityStepTemplate[] {
  return templates.map((step, index) => ({ ...step, id: `${runId}:step-${index + 1}` }));
}
