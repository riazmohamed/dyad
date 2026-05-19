# Repository Agent Guide

Please read `CONTRIBUTING.md` which includes information for human code contributors. Much of the information is applicable to you as well.

## Project overview

Dyad is a local, open-source Electron desktop app for building AI-generated apps. It uses a secure Electron main/preload/renderer split, a React 19 renderer with TanStack Router and TanStack Query, SQLite/Drizzle for local data, and Vercel AI SDK providers for model access.

## Project structure

```text
src/main.ts                 Electron main process entry and app lifecycle
src/preload.ts              Secure renderer bridge and IPC exposure
src/renderer.tsx            React renderer entry
src/ipc/                    IPC contracts, preload allowlist, handlers, shared utilities
src/components/             React UI, including settings, chat, preview, and reusable ui/
src/pages/ and src/routes/  TanStack Router pages and route definitions
src/hooks/                  Renderer hooks for settings, app state, chat, integrations
src/lib/                    Shared schemas, query keys, utilities, provider helpers
src/main/                   Main-process settings, backups, and support modules
src/db/ and drizzle/        Drizzle schema and SQLite migrations
shared/                     Cross-environment utilities
worker/ and workers/        Preview/proxy/client workers and TypeScript worker code
scaffold/                   Generated app template scaffold
e2e-tests/                  Playwright Electron E2E tests
testing/                    Fake LLM/MCP servers and test support scripts
rules/                      Required task-specific development rules
```

## Organization rules

- Keep one concept per file and one responsibility per module/component.
- Match nearby code patterns before introducing new abstractions.
- Use typed IPC contracts plus `createTypedHandler` for renderer-to-main calls.
- Validate external data with existing schemas before trusting it.
- Add or update targeted tests for non-trivial behavior changes.

## Rules index

> **IMPORTANT: BEFORE writing any code or making changes, you MUST read the relevant rule files from the table below.** Identify which areas your task touches and read those rule files first. Skipping this step leads to avoidable mistakes and rework.

Detailed rules and learnings are in the `rules/` directory. Read the relevant file when working in that area.

| File                                                                 | Read when...                                                                                                                                                                   |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [rules/electron-ipc.md](rules/electron-ipc.md)                       | Adding/modifying IPC endpoints, handlers, React Query hooks, or renderer-to-main communication                                                                                 |
| [rules/dyad-errors.md](rules/dyad-errors.md)                         | Classifying IPC/main errors with `DyadError` / `DyadErrorKind` and PostHog exception filtering                                                                                 |
| [rules/local-agent-tools.md](rules/local-agent-tools.md)             | Adding/modifying local agent tools, tool flags (`modifiesState`), or read-only/plan-only guards                                                                                |
| [rules/e2e-testing.md](rules/e2e-testing.md)                         | Writing or debugging E2E tests (Playwright, Base UI radio clicks, Lexical editor, test fixtures)                                                                               |
| [rules/git-workflow.md](rules/git-workflow.md)                       | Pushing branches, creating PRs, or dealing with fork/upstream remotes                                                                                                          |
| [rules/base-ui-components.md](rules/base-ui-components.md)           | Using TooltipTrigger, ToggleGroupItem, or other Base UI wrapper components                                                                                                     |
| [rules/database-drizzle.md](rules/database-drizzle.md)               | Modifying the database schema, generating migrations, or resolving migration conflicts                                                                                         |
| [rules/native-modules.md](rules/native-modules.md)                   | Adding Electron native modules or binaries that must survive Forge packaging/rebuild                                                                                           |
| [rules/typescript-strict-mode.md](rules/typescript-strict-mode.md)   | Debugging type errors from `npm run ts` (tsgo) that pass normal tsc                                                                                                            |
| [rules/openai-reasoning-models.md](rules/openai-reasoning-models.md) | Working with OpenAI reasoning model (o1/o3/o4-mini) conversation history                                                                                                       |
| [rules/adding-settings.md](rules/adding-settings.md)                 | Adding a new user-facing setting or toggle to the Settings page                                                                                                                |
| [rules/chat-message-indicators.md](rules/chat-message-indicators.md) | Using `<dyad-status>` tags in chat messages for system indicators                                                                                                              |
| [rules/supabase-functions.md](rules/supabase-functions.md)           | Deploying, bundling, or queueing Supabase Edge Functions                                                                                                                       |
| [rules/product-principles.md](rules/product-principles.md)           | Planning new features, especially via `dyad:swarm-to-plan`, to guide design trade-offs                                                                                         |
| [rules/jotai-testing.md](rules/jotai-testing.md)                     | Unit-testing Jotai atoms/hooks with `renderHook`, especially across unmount/remount                                                                                            |
| [rules/claude-github-workflows.md](rules/claude-github-workflows.md) | Editing `.github/workflows/*.yml` that invoke `anthropics/claude-code-action` — workflow shape, untrusted-input handling, and **permission/`.claude/settings.json` hardening** |
| [rules/ui-styling.md](rules/ui-styling.md)                           | Adding provider/brand icons, styling scrollable popovers, or using Tailwind v4 arbitrary values                                                                                |

## Project setup and commands

Use Node `>=24 <26` (`.npmrc` has `engine-strict=true`). After `npm install`, run `npm run init-precommit` once to install hooks.

- Start app: `npm start`
- Development mode: `npm run dev`
- Build/package for E2E: `npm run build`
- Unit tests: `npm test`
- Targeted unit test: `npm test -- path/to/file.test.ts`
- E2E tests: `npm run e2e` after `npm run build`

**Note:** Running `npm install` may update `package-lock.json` with version changes or peer dependency flag removals. If rebasing or performing git operations, commit these changes first to avoid "unstaged changes" errors.

## Git worktrees

When you create a new git worktree for this repository, run `npm install` inside the new worktree before starting development. Each worktree has its own working directory and needs its dependencies installed there.

## Zero-tolerance quality checks

Run these before committing meaningful changes, and fix failures before reporting completion:

```sh
npm run fmt:check
npm run lint
npm run ts
npm test -- path/to/changed.test.ts
```

Use `npm test` when feasible after targeted tests pass. Use `npm run build` before any Playwright run, then `npm run e2e` or a targeted Playwright spec.

> **WARNING: Do NOT run `npx eslint` directly.** The project uses **oxlint** (not eslint) via `npm run lint`. Running `npx eslint <file>` produces spurious `import/no-unresolved` errors for `@/...` path aliases and other false positives — ignore those and rely on `npm run lint` / `npm run lint:fix`.

## Running TypeScript

> **WARNING: Do NOT run `npx tsc` or `tsc` directly.** The project is not set up for direct `tsc` invocation and will produce incorrect or misleading results.

**Always use:**

```sh
npm run ts
```

This is the only supported way to type-check the project. It uses the correct configuration and compiler (`tsgo`). Any other method of running TypeScript checks is unsupported and will likely give wrong results.

## Project context

- This is an Electron application with a secure IPC boundary.
- Frontend is a React app that uses TanStack Router (not Next.js or React Router).
- Data fetching/mutations should be handled with TanStack Query when touching IPC-backed endpoints.
- Main-process IPC errors that are **not bugs** (validation, missing entities, auth, user refusal, etc.) should be thrown as **`DyadError`** with a **`DyadErrorKind`** so they can be excluded from PostHog exception telemetry. See [rules/dyad-errors.md](rules/dyad-errors.md).

## Verifying your changes

You should test your changes before committing or pushing. Run relevant unit tests and E2E tests to verify expected behavior. If it's truly impossible to test a change locally (e.g. CI-only behavior, third-party service integration), note this in the PR description explaining why and what manual verification is needed.

## General guidance

- Favor descriptive module/function names that mirror IPC channel semantics.
- Keep Electron security practices in mind (no `remote`, validate/lock by `appId` when mutating shared resources).
- Add tests in the same folder tree when touching renderer components.
- **Always use Base UI (`@base-ui/react`) for UI primitives, never Radix UI.** This includes menus, tooltips, accordions, context menus, and other headless UI components. See [rules/base-ui-components.md](rules/base-ui-components.md) for component-specific guidance.

Use these guidelines whenever you work within this repository.

## Testing

Our project relies on a combination of unit testing and E2E testing. Unless your change is trivial, you MUST add a test, preferably an e2e test case.

### Unit testing

Use unit testing for pure business logic and util functions.

Target a Vitest file with `npm test -- path/to/file.test.ts`. Do not pass Jest-only flags such as `--runInBand`; Vitest will fail with `Unknown option '--runInBand'`.

### E2E testing

> **IMPORTANT: You MUST run `npm run build` before running E2E tests.** E2E tests run against the built application, not the dev server. If you have changed any application code (i.e. anything outside of test files), you MUST re-run `npm run build` before running the tests, otherwise the tests will run against stale code and results will be misleading. Only changes to test code itself (e.g. files in `e2e-tests/`) do not require a rebuild.

See [rules/e2e-testing.md](rules/e2e-testing.md) for full E2E testing guidance, including Playwright tips and fixture setup.

**Debugging E2E test failures with screenshots:** When an E2E test fails and you can't determine the cause from the error message alone, use the `/dyad:debug-with-playwright` skill to add screenshots at key points in the test. Playwright's built-in `screenshot: "on"` does NOT work with Electron — you must use manual `page.screenshot()` calls. The skill walks you through adding debug screenshots, running the test, viewing the captured PNGs, and cleaning up afterward.

## Git workflow

When pushing changes and creating PRs:

1. If the branch already has an associated PR, push to whichever remote the branch is tracking.
2. If the branch hasn't been pushed before, default to pushing to `origin` (the fork `wwwillchen/dyad`), then create a PR from the fork to the upstream repo (`dyad-sh/dyad`).
3. If you cannot push to the fork due to permissions, push directly to `upstream` (`dyad-sh/dyad`) as a last resort.

### Skipping automated review

Add `#skip-bugbot` to the PR description for trivial PRs that won't affect end-users, such as:

- Claude settings, commands, or agent configuration
- Linting or test setup changes
- Documentation-only changes
- CI/build configuration updates

## Subscription OAuth integration

Dyad supports optional **subscription OAuth** sign-in for Anthropic (Claude)
and OpenAI (ChatGPT/Codex), adapted from the gg-framework reference flows into
Dyad's Electron IPC, encrypted settings, provider catalog, and Vercel AI SDK
model abstraction. API keys remain the official/recommended setup path;
subscription OAuth is an advanced local sign-in option. Z.AI OAuth is
explicitly out of scope (it uses static API-key credentials).

### Credential storage schema (decided)

Provider OAuth tokens are stored **per-provider inside existing provider
settings**, not as a new top-level user setting — so `DEFAULT_SETTINGS` and
settings-search entries are unchanged.

- `OAuthTokenSetSchema` in `src/lib/schemas.ts`:
  - `type`: `"anthropic" | "openai-codex"`
  - `accessToken`: `SecretSchema` (encrypted via `electron-safe-storage`)
  - `refreshToken`: `SecretSchema` (encrypted)
  - `expiresAt`: `number` (non-secret metadata)
  - `accountId`: optional `string` (non-secret; OpenAI Codex JWT claim)
  - `baseUrl`: optional `string` (non-secret)
- `RegularProviderSettingSchema.oauth` holds the token set, coexisting with the
  existing `apiKey`. The `.passthrough()` union behavior is preserved so
  unknown provider settings survive downgrades.
- `src/main/settings.ts` encrypts `oauth.accessToken` and `oauth.refreshToken`
  exactly like `apiKey` / Vertex `serviceAccountKey`, preserving non-secret
  OAuth metadata. On decrypt failure, only the broken `oauth` field is removed;
  the provider's API key is kept.
- Credential precedence (in `resolveProviderAuthCredentials`,
  `src/ipc/shared/provider_auth_service.ts`): **OAuth → saved API key → env
  var → `DyadError(DyadErrorKind.Auth)`**, with auto-refresh on expiry and
  stale-token cleanup on auth failure.
- Never log raw token payloads, callback URLs containing codes, or decrypted
  settings. OAuth IPC handlers must not log args or return payloads.

### Phase timeline

| Phase | Scope | Status |
| ----- | ----- | ------ |
| 0 | Shared PKCE + authorization-input parsing (`src/ipc/utils/oauth_pkce.ts`) | Done |
| 1 | Anthropic OAuth utils (`src/ipc/utils/anthropic-oauth.ts`) | Done |
| 2 | OpenAI Codex OAuth utils (`src/ipc/utils/openai_codex_oauth.ts`) | Done |
| 4 | Schema + encrypted settings storage (`src/lib/schemas.ts`, `src/main/settings.ts`) | Done |
| 6 | IPC contracts/handlers (`provider-auth.ts`, `provider_auth_handlers.ts`), deep-link + localhost (port 1455) callback routing, `main.ts` deep links | Done |
| 3 | UI integration — settings OAuth buttons, model-picker status badges | **Partial — backend/IPC complete; UI layer needs verification** |
| 5 | Model metadata exposing OAuth-capable auth flags to the UI | **Partial — `get_model_client.ts` branches on `oauth`; metadata flag exposure to confirm** |
| 7 | Optional media-aware router | Optional — not a core OAuth gap |
| Verify | Targeted Vitest + fmt/lint/ts | Done |

### Implemented vs. planned

**Already implemented (end-to-end, with test coverage):**

- Token storage schema and encrypted persistence
  (`saveProviderOAuthTokenSet` / `removeProviderOAuthTokenSet`).
- S256 PKCE generation, random state/session IDs, authorization-input parsing
  (URL / query / `code#state` / bare code), account-id extraction.
- Anthropic OAuth: auth URL, code exchange with dual token-URL fallback,
  refresh, expiry window, deep-link parsing, state validation, typed errors.
- OpenAI Codex OAuth: auth URL, code exchange, refresh, account-id JWT
  extraction, expiry window, and `createOpenAICodexFetch` Responses-API
  request rewriter.
- `resolveProviderAuthCredentials` precedence + auto-refresh, consumed by
  `src/ipc/utils/get_model_client.ts` for Anthropic (apiKey = access token)
  and OpenAI Codex (authToken + `createOpenAICodexFetch`).
- IPC: `providerAuthContracts` (status/startLogin/completeLogin/logout/refresh)
  plus legacy `oauthContracts` compatibility surface;
  `provider_auth_handlers.ts` with localhost callback server, deep-link
  completions, session TTL purge, and a test-only
  `test:complete-provider-oauth` IPC for E2E.
- Tests: `anthropic_oauth`, `anthropic_oauth_apikey_parity`, `oauth_pkce`,
  `oauth_token_refresh_errors`, `openai_codex_oauth`,
  `openai_oauth_apikey_responses_parity`, `provider_auth_handlers`,
  `provider_auth_service`, `token_utils`, and `get_model_client.test.ts`.

**Still planned / open:**

- Phase 3: verify the settings OAuth UI (connect/complete/disconnect buttons,
  connected status with expiry and OpenAI account ID) and model-picker status
  badges are fully wired. UI is the open question, not the backend.
- Phase 5: confirm model metadata exposes OAuth-capable flags to the UI.
- Phase 7 (optional): media-aware router — not required for core OAuth.

### Audit findings (2026-05-19)

Scope: `src/ipc`, `src/main`, `src/lib`, `src/supabase_admin`,
`src/neon_admin`. The provider OAuth feature is **substantially implemented
and wired end-to-end, not greenfield**; remaining gaps are narrow.

- **Cleanup hazard:** a near-duplicate Anthropic module exists —
  `src/ipc/utils/anthropic-oauth.ts` (hyphen, used by handlers/service) vs.
  `src/ipc/utils/anthropic_oauth.ts` (underscore). Determine which is dead
  and remove it to avoid drift. Not a functional gap, but a maintenance
  hazard.
- `src/ipc/handlers/oauth_handlers.ts` is a thin re-export shim →
  `provider_auth_handlers.ts`.
- Supabase (`supabase_return_handler.ts`) and Neon
  (`neon_return_handler.ts`) OAuth are separate, pre-existing
  third-party integration auth — unrelated to provider model OAuth and
  out of scope.
- No other missing core OAuth infrastructure identified for
  Anthropic/OpenAI.

### Compliance checklist

- [ ] API keys presented as the official/recommended path; subscription
      OAuth labeled an advanced local sign-in option in UI copy.
- [ ] Anthropic UI includes a short policy warning — Claude subscription
      login in third-party apps may require Anthropic approval.
- [ ] OAuth constants documented as unofficial/public-client constants
      (Claude Code / Codex CLI behavior) that can change without notice.
- [ ] No access/refresh tokens, callback URLs with codes, or decrypted
      settings are ever logged; OAuth IPC handlers do not log args or returns.
- [ ] Encrypted-at-rest: `oauth.accessToken` / `oauth.refreshToken`
      encrypted like `apiKey`; broken-decrypt deletes only `oauth`,
      preserving the API key.
- [ ] Every async path that may refresh tokens re-reads settings
      immediately before `writeSettings` to avoid clobbering concurrent
      changes (see `rules/electron-ipc.md`).
- [ ] Expected user-fixable failures raised as `DyadError` with
      `DyadErrorKind.Auth` / `Validation` / `External` so they are excluded
      from PostHog exception telemetry (see `rules/dyad-errors.md`).
- [ ] Disconnect/logout removes only `providerSettings[provider].oauth`,
      preserving API key, Azure/Vertex siblings, and unrelated providers.
- [ ] Local, Azure, Vertex, Dyad Pro engine, and custom-provider behavior
      unchanged.
- [ ] `npm run fmt:check`, `npm run lint`, `npm run ts`, and targeted
      Vitest OAuth/settings suites pass.
