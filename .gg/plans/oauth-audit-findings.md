# OAuth Auth Infrastructure Audit

Date: 2026-05-19
Scope: `src/ipc`, `src/main`, `src/lib`, plus `src/supabase_admin`, `src/neon_admin`.

## Summary

The provider OAuth feature is **substantially implemented and wired end-to-end**, not greenfield.
Anthropic (Claude) and OpenAI (Codex/ChatGPT) subscription sign-in both work: PKCE generation,
authorization URLs, code exchange, token refresh, encrypted storage, credential precedence, IPC
contracts, deep-link + localhost callback routing, and model-client integration all exist with
test coverage. Remaining gaps are narrow.

## What EXISTS (complete)

### Token storage & schema
- `src/lib/schemas.ts`: `OAuthTokenSetSchema` (type `anthropic` | `openai-codex`,
  `accessToken`/`refreshToken` as `SecretSchema`, `expiresAt`, optional `accountId`/`baseUrl`).
  `RegularProviderSettingSchema.oauth` holds it. Secrets support
  `electron-safe-storage` encryption (`encryptionType` enum).
- Tokens persisted in user settings via `saveProviderOAuthTokenSet` /
  `removeProviderOAuthTokenSet` (`src/ipc/shared/provider_auth_service.ts`).

### PKCE & parsing
- `src/ipc/utils/oauth_pkce.ts`: S256 PKCE challenge, random state/session IDs,
  authorization-input parser (URL / query / `code#state` / bare code), account-id extraction.

### Provider OAuth utils
- `src/ipc/utils/anthropic-oauth.ts`: auth URL, code exchange w/ dual token-URL fallback,
  refresh, expiry window, deep-link parsing, state validation, typed errors via `DyadError`.
- `src/ipc/utils/openai_codex_oauth.ts`: auth URL, code exchange, refresh, account-id JWT
  extraction, expiry window, and `createOpenAICodexFetch` Responses-API request rewriter.
- Note: a near-duplicate `src/ipc/utils/anthropic_oauth.ts` (underscore) exists alongside
  `anthropic-oauth.ts` (hyphen) — see Cleanup.

### Credential resolver
- `src/ipc/shared/provider_auth_service.ts`: `resolveProviderAuthCredentials` implements
  documented precedence (OAuth → saved API key → env var → `DyadError.Auth`), auto-refresh
  on expiry, stale-token cleanup on auth-failure, fallthrough to lower-priority creds.
- **Consumed** by `src/ipc/utils/get_model_client.ts` (lines ~307, 346) for Anthropic
  (apiKey=access token) and OpenAI Codex (authToken + `createOpenAICodexFetch`).

### IPC handlers & contracts
- `src/ipc/types/provider-auth.ts`: `providerAuthContracts` (status/startLogin/completeLogin/
  logout/refresh) — current contract.
- `src/ipc/types/oauth.ts`: `oauthContracts` — legacy compatibility surface.
- `src/ipc/handlers/provider_auth_handlers.ts`: registers both contract sets, OpenAI
  localhost callback server (port 1455), deep-link completions
  (`completeAnthropicOAuthDeepLink`, `completeOpenAICodexOAuthDeepLink`), session TTL purge,
  and a test-only `test:complete-provider-oauth` IPC for E2E.
- `src/ipc/handlers/oauth_handlers.ts`: thin re-export shim → provider_auth_handlers.
- `src/main.ts`: deep-link routing for `dyad://anthropic-oauth-return` and
  `dyad://openai-oauth-return`.

### Third-party (non-model) OAuth — separate, pre-existing
- Supabase: `src/supabase_admin/supabase_return_handler.ts` (org token storage,
  `dyad://supabase-oauth-return`).
- Neon: `src/neon_admin/neon_return_handler.ts` (`dyad://neon-oauth-return`).
- These are unrelated integration auth, already working; out of scope for provider OAuth work.

### Tests
- `src/__tests__/`: `anthropic_oauth`, `anthropic_oauth_apikey_parity`, `oauth_pkce`,
  `oauth_token_refresh_errors`, `openai_codex_oauth`, `openai_oauth_apikey_responses_parity`,
  `provider_auth_handlers`, `provider_auth_service`, `token_utils`, plus
  `get_model_client.test.ts` covering Codex fetch wiring.

## What is PARTIAL

- **Phase 3 (UI integration)** — task marked in-progress. Backend/IPC complete; verify UI
  (settings OAuth buttons, status badges in model picker) is fully wired. Audit did not deep-read
  `src/components` — UI layer is the open question, not the backend.
- **Phase 5 (model metadata / auth capabilities)** — in-progress. `get_model_client.ts` already
  branches on `providerSetting?.oauth`; confirm model metadata exposes OAuth-capable flags to UI.
- **Phase 7 (optional media-aware router)** — in-progress and explicitly optional; not a gap in
  core OAuth.

## What is MISSING / Cleanup

- **Duplicate Anthropic OAuth module**: `src/ipc/utils/anthropic-oauth.ts` (hyphen, used by
  handlers/service) vs `src/ipc/utils/anthropic_oauth.ts` (underscore). Determine which is dead
  and remove it to avoid drift. (Not a functional gap — a maintenance hazard.)
- No other missing core OAuth infrastructure identified for Anthropic/OpenAI.

## Task-list reconciliation (actual gaps only)

- Phases 0,1,2,4,6 + all Verify tasks: confirmed done in code — no action.
- Phase 3: keep open — scope to **UI-only** verification (settings buttons, model-picker badges).
- Phase 5: keep open — scope to **model-metadata exposure of OAuth capability flags**.
- Phase 7: optional — no change.
- Add narrow cleanup item: resolve duplicate `anthropic-oauth.ts` / `anthropic_oauth.ts`.
