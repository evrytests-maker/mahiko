# Thinking controls exposed through OMP

Mahiko does not translate provider-specific reasoning parameters. OMP `17.2.9` owns that mapping and exposes the selected model's normalized `thinking.efforts` metadata. The renderer must display only those efforts, plus `auto` and `off` when OMP says disabling is supported.

Provider behavior checked against official documentation on 2026-08-08:

| Family | Native control | Readable stream |
|---|---|---|
| Xiaomi MiMo | Chat Completions uses `thinking.type: enabled/disabled`. Responses uses `reasoning.effort`; `none` disables thinking, while `low/medium/high` currently have identical enabled behavior. | Responses emits `response.reasoning_text.delta/done`; OMP normalizes readable text to `thinking_*`. |
| DeepSeek | `thinking.type: enabled/disabled`; V4 accepts effective `high/max` effort (`low/medium → high`, `xhigh → max`). | `reasoning_content`; it must be preserved across tool-call turns. |
| Kimi | K3 uses `reasoning_effort: low/high/max`. K2.6/K2.7 use `thinking.type`; K2.7 Code cannot disable it. | `reasoning_content`; K2 also defines `thinking.keep`. |
| GLM | GLM 4.5+ uses `thinking.type: enabled/disabled`; newer models may additionally advertise effort tiers. | `reasoning_content`. |
| Gemini | Gemini 3 uses model-specific `thinkingLevel` values. Gemini 2.5 uses `thinkingBudget`. Some Pro/3 models cannot fully disable thinking. | `includeThoughts` returns thought summaries, not raw hidden thoughts. OMP exposes those summaries as `thinking_*`. |
| StepFun | `reasoning_effort`; most supported models use `low/medium/high`, while `step-3.5-flash-2603` uses `low/high`. `reasoning_format` selects `reasoning` or DeepSeek-compatible `reasoning_content`. | `reasoning` or `reasoning_content`, normalized by OMP. |

Official references:

- [Xiaomi MiMo Chat Completions](https://mimo.mi.com/docs/en-US/api/chat/openai-api) and [Responses API](https://mimo.mi.com/docs/en-US/api/chat/responses)
- [DeepSeek thinking mode](https://api-docs.deepseek.com/guides/thinking_mode)
- [Kimi Chat Completions](https://platform.kimi.ai/docs/api/chat) and [thinking models guide](https://platform.kimi.ai/docs/guide/use-thinking-models)
- [GLM thinking mode](https://docs.bigmodel.cn/cn/guide/models/text/glm-4.5)
- [Gemini thinking](https://ai.google.dev/gemini-api/docs/generate-content/thinking)
- [StepFun Chat Completions](https://platform.stepfun.ai/docs/en/api-reference/chat/chat-completion-create)
