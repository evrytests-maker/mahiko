# Task 2 — connect live OMP

Begin only after Task 1 is accepted. Read `AGENTS.md` and `info.md`, then inspect the actual integrated controls before changing the gateway.

Implement the real OMP 17.2.9 connection for the controls that exist in the UI: prompt, streamed events, tools, stop/cancel and extension UI where supported by the pinned protocol. Keep version mismatch fail-closed. Validate and redact every IPC/RPC boundary, preserve backpressure and cancellation, and surface unsupported capabilities honestly.

Do not invent events, controls or success states. Do not expose raw provider state, credentials, private reasoning or unrestricted filesystem access to the renderer. Add contract and process tests for every supported flow and update `info.md`.

