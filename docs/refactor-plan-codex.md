# CoinBuddy Refactor Plan

## Workflow Rules

- Follow the approved phase order and dependency graph.
- Keep each PR atomic and scoped to one phase or a tightly related subtask.
- Use `pnpm run build` and `pnpm test` as acceptance gates for every phase.
- Report progress once per phase after local verification.

## Phase 1

- Task 1.1: create `src/lib/chain-config.ts` and remove duplicated chain/token config from `src/background/brain.ts` and `src/strategy/config.ts`.
- Task 1.2: create shared type files under `src/types/` and replace `any`-typed vault usage in the background flow with shared types.

## Phase 2

- Task 2.1: split `src/background/brain.ts` into `llm-client.ts`, `lifi-client.ts`, `quote-formatter.ts`, and a thin facade `brain.ts`.
- Task 2.2: split `src/background/index.ts` intent routing into handler modules under `src/background/handlers/`.

## Phase 3

- Task 3.1: narrow `host_permissions` and align content script matches.
- Task 3.2: ensure all external `fetch` calls use explicit timeouts.
- Task 3.3: add manifest CSP for extension pages.

## Phase 4

- Task 4.1: add `src/lib/logger.ts` and replace scattered console logging with structured logs.
- Task 4.2: classify LLM errors in the Gemini -> Qwen fallback chain and return differentiated user-facing messages.

## Phase 5

- Add tests for `chain-config`, `quote-formatter`, and `llm-client`.
- Update the `test` script so the new unit tests run with the existing Node native test runner.
