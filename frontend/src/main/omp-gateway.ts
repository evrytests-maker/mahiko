import type { PreviewOptions, PreviewReply } from "../shared/contracts";
import { createPreviewReply } from "../shared/preview-fixture";

export async function previewAgent(prompt: string, options?: PreviewOptions): Promise<PreviewReply> {
  const normalized = prompt.trim().slice(0, 8_000);
  if (!normalized) throw new Error("Пустой запрос не может быть выполнен");
  return createPreviewReply(normalized, options);
}
