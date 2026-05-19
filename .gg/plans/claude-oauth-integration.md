# Subscription OAuth Integration Plan

## Scope

Add optional subscription OAuth support to Dyad for Anthropic/Claude and OpenAI/ChatGPT Codex by adapting the working OAuth/PKCE flows from `/Users/riaz.mohamed/Desktop/projects/unfazed/unstablemind/gg-framework/packages/ggcoder` and `/Users/riaz.mohamed/Desktop/projects/unfazed/unstablemind/agent-girl_riaz`, but fitting them into Dyad's Electron IPC, encrypted settings, provider catalog, and Vercel AI SDK model abstraction.

This plan does not include Z.AI OAuth. The reference project stores Z.AI as static API-key credentials, and the public Z.AI/Dyad provider shape is OpenAI-compatible API-key access.

## Relevant Existing Code

- `src/ipc/utils/get_model_client.ts:47` is the provider-selection boundary. Regular Anthropic clients are currently created at `src/ipc/utils/get_model_client.ts:296` with `createAnthropic({ apiKey })`, and OpenAI clients at `src/ipc/utils/get_model_client.ts:286` with `createOpenAI({ apiKey })` plus `provider.responses(model.name)`.
- `src/main/settings.ts:250` writes settings with a shallow top-level merge and encrypts existing secrets; `src/main/settings.ts:328` reads and decrypts them.
- `src/lib/schemas.ts:100` defines `RegularProviderSettingSchema`, and `src/lib/schemas.ts:316` stores `providerSettings` as a record of provider settings.
- `src/ipc/types/settings.ts:13`, `src/ipc/handlers/settings_handlers.ts:5`, and `src/ipc/ipc_host.ts:48` show the contract/client/handler registration pattern required by `rules/electron-ipc.md`.
- `src/components/settings/ProviderSettingsPage.tsx:31` and `src/components/settings/ApiKeyConfiguration.tsx:46` are the provider settings UI integration points.
- `src/lib/queryKeys.ts:219` is the existing language-model/provider query-key area for OAuth status keys.
- `src/__tests__/readSettings.test.ts` already covers settings read/write behavior and is the right place to add encrypted OAuth token coverage.

## Verified External Findings

- AI SDK Anthropic docs and installed types confirm `createAnthropic` accepts `authToken`, which is sent as `Authorization: Bearer`, as an alternative to `apiKey`; it also accepts `headers` and `fetch`.
- AI SDK OpenAI installed types confirm `createOpenAI` accepts `baseURL`, `apiKey`, `headers`, and `fetch`, and exposes `responses(modelId)`.
- OpenAI Codex CLI docs state the first CLI run prompts users to authenticate with a ChatGPT account or API key, and ChatGPT paid plans include Codex access.
- Public Codex OAuth examples use `https://auth.openai.com/oauth/authorize`, `https://auth.openai.com/oauth/token`, client ID `app_EMoamEEZ73f0CkXaXp7hrann`, redirect URI `http://localhost:1455/auth/callback`, `codex_cli_simplified_flow=true`, and an `originator` value.
- Public Codex integrations set `ChatGPT-Account-Id`/`chatgpt-account-id` when available and route Responses requests to `https://chatgpt.com/backend-api/codex/responses`.
- `ggcoder` extracts `chatgpt_account_id` from the OpenAI access-token JWT claim at `https://api.openai.com/auth` and stores it as `accountId`.
- `ggcoder` Anthropic OAuth uses the Claude Code client ID, auth URL `https://claude.ai/oauth/authorize`, token URLs `https://platform.claude.com/v1/oauth/token` then `https://console.anthropic.com/v1/oauth/token`, redirect URI `https://platform.claude.com/oauth/code/callback`, the `oauth-2025-04-20` beta header, and a Claude CLI user-agent.
- Anthropic policy/product risk remains: Claude subscription login in third-party apps may require Anthropic approval, so UI copy should describe it as an advanced/local option and keep API keys as the official default.

## Target Data Model

Add a provider-scoped OAuth token set to `src/lib/schemas.ts` near the provider setting schemas:

```ts
OAuthTokenSetSchema = z.object({
  type: z.enum(["anthropic", "openai-codex"]),
  accessToken: SecretSchema,
  refreshToken: SecretSchema,
  expiresAt: z.number(),
  accountId: z.string().optional(),
  baseUrl: z.string().optional(),
});
```

Extend `RegularProviderSettingSchema` with `oauth: OAuthTokenSetSchema.optional()` so `providerSettings.anthropic.oauth` and `providerSettings.openai.oauth` can coexist with existing `apiKey`. Keep the existing `.passthrough()` union behavior to preserve unknown provider settings across downgrades.

Do not add a new top-level user setting or default field, so `DEFAULT_SETTINGS` and settings search entries should not need changes.

## OAuth Utility Design

Create small main-process utilities under `src/ipc/utils` rather than sharing renderer code:

- `src/ipc/utils/oauth_pkce.ts` for generic `generatePkceChallenge()`, base64url helpers, random state/session ID generation, and shared authorization-input parsing for raw code, `code#state`, query string, and callback URL formats.
- `src/ipc/utils/anthropic_oauth.ts` for Anthropic constants, authorization URL construction, callback code/state parsing, token exchange, token refresh, expiry window checks, and `DyadError` classification.
- `src/ipc/utils/openai_codex_oauth.ts` for OpenAI Codex constants, optional local callback server support if chosen, token exchange, token refresh, JWT `accountId` extraction, expiry window checks, and `DyadError` classification.

Anthropic token requests should use JSON bodies, the `anthropic-beta: oauth-2025-04-20` header, and a Claude Code-compatible user-agent source. If reusing `ggcoder`'s dynamic Claude Code version helper is too heavy for Dyad, start with a constant user-agent and isolate it in one function for future adjustment.

OpenAI token requests should use form-encoded bodies. The auth URL should include `id_token_add_organizations=true`, `codex_cli_simplified_flow=true`, and an originator such as `dyad`.

All utility errors for expected user-fixable states should be `DyadError` with `DyadErrorKind.Auth`, `Validation`, or `External` as appropriate, and no access/refresh tokens should be logged.

## IPC Design

Create `src/ipc/types/oauth.ts` with a single provider-discriminated contract group and generated client:

- `startProviderOAuth` input `{ provider: "anthropic" | "openai" }`, output `{ authorizationUrl: string; sessionId: string; provider: "anthropic" | "openai" }`.
- `completeProviderOAuth` input `{ provider: "anthropic" | "openai"; sessionId: string; code: string }`, output `{ connected: true; expiresAt: number; accountId?: string }`.
- `logoutProviderOAuth` input `{ provider: "anthropic" | "openai" }`, output `void`.
- `getProviderOAuthStatus` input `{ provider: "anthropic" | "openai" }`, output `{ connected: boolean; expiresAt?: number; accountId?: string }`.

Create `src/ipc/handlers/oauth_handlers.ts`, register it from `src/ipc/ipc_host.ts`, and export contracts/client/types from `src/ipc/types/index.ts`. Use `createTypedHandler` and avoid logged handlers because token-bearing flows should not log args or return payloads.

The handler should maintain an in-memory `Map<sessionId, { provider, codeVerifier, state, createdAt }>` with a short TTL. `startProviderOAuth` should create the PKCE session, open the browser with `shell.openExternal(authorizationUrl)`, and return the session ID. `completeProviderOAuth` should validate provider/session/state, exchange the code, then re-read settings immediately before writing tokens to avoid the stale-read race called out in `rules/electron-ipc.md`. `logoutProviderOAuth` should remove only `providerSettings[provider].oauth`, preserving any API key, Azure/Vertex sibling settings, and unrelated providers.

## Settings Encryption Design

Update `src/main/settings.ts` in the existing provider-settings loop at `src/main/settings.ts:302` and `src/main/settings.ts:433`:

- On write, encrypt `providerSettings[provider].oauth.accessToken` and `.refreshToken` exactly like `apiKey` and Vertex `serviceAccountKey`.
- Preserve `oauth.expiresAt`, `oauth.accountId`, `oauth.baseUrl`, and `oauth.type` as non-secret metadata.
- On read, decrypt both OAuth tokens; if either decrypt fails, delete only the broken `oauth` field and keep the provider's API key.
- Add small helper functions to avoid duplicating encryption/decryption logic inside the provider loop.

Settings write callers must spread the existing `providerSettings` object and the existing provider object because `writeSettings` merges only top-level fields.

## Provider Client Design

Update `src/ipc/utils/get_model_client.ts`:

- Add `OAuthTokenSet`/provider setting imports from `src/lib/schemas.ts` if needed.
- Add `resolveProviderOAuthCredentials(providerId, settings)` to validate and refresh stored OAuth tokens for `anthropic` and `openai`.
- For `anthropic`, prefer valid OAuth over API key when present, using `createAnthropic({ authToken: accessToken })`; include Anthropic OAuth beta/user-agent headers if empirical testing shows Messages API calls require them.
- For `openai`, keep normal API-key behavior as the default for API-key users. When `providerSettings.openai.oauth` exists, use a Codex-specific OpenAI provider created with `createOpenAI({ apiKey: accessToken, baseURL: "https://chatgpt.com/backend-api/codex", headers: { "chatgpt-account-id": accountId, originator: "dyad" } })`, then call `provider.responses(model.name)`.
- Verify whether AI SDK's `baseURL` plus `responses(model.name)` produces `/codex/responses` or `/codex/v1/responses`. If it cannot produce the Codex URL shape, implement a narrow custom `fetch` in `createOpenAI` that rewrites `/v1/responses` to `https://chatgpt.com/backend-api/codex/responses`, matching public Codex integrations.
- If OAuth refresh succeeds, re-read settings immediately before `writeSettings` and replace only that provider's `oauth` token set.
- If refresh fails with an auth failure and an API key or env key exists, remove the stale OAuth field and fall back to the key. If no fallback exists, throw `DyadError(DyadErrorKind.Auth)` with a user-actionable message.
- Do not change local providers, Azure, Vertex, Dyad Pro engine, or custom-provider behavior.

## UI Design

Add `src/components/settings/ProviderOAuthConfiguration.tsx` and render it from `src/components/settings/ProviderSettingsPage.tsx` only for `provider === "anthropic" || provider === "openai"`.

The component should follow the existing `ApiKeyConfiguration` visual language: Accordion card, `Alert`, `Button`, `Input`, and existing Base UI wrappers. It should use React Query with new keys under `queryKeys.languageModels.oauthStatus({ providerId })` or `queryKeys.providerOAuth.status({ providerId })`, plus `useMutation` for start, complete, and logout.

UI states:

- Not connected: show a provider-specific button, "Connect Claude subscription" or "Connect ChatGPT/Codex subscription".
- Started: show concise instructions, an input for the copied callback code or URL, and a "Complete sign in" button.
- Connected: show connected status, expiration date, account ID for OpenAI if present, and a disconnect button.
- Error: show user-fixable validation/auth errors inline without exposing raw token responses.

Copy should make the tradeoff explicit: API keys are the official/recommended setup path; subscription OAuth is an advanced local sign-in option. For Anthropic, include a short policy warning. The page's configured status should count OAuth as configured for Anthropic/OpenAI, alongside saved API keys and env vars.

## Tests

Add or update unit tests rather than broad E2E first:

- `src/__tests__/oauth_pkce.test.ts` for base64url/PKCE shape and authorization input parsing.
- `src/__tests__/anthropic_oauth.test.ts` for Anthropic URL construction, state validation, exchange/refresh request shape, endpoint fallback behavior, expiry window, and expected `DyadError` classification using mocked `fetch`.
- `src/__tests__/openai_codex_oauth.test.ts` for OpenAI URL construction, token exchange/refresh request shape, JWT `accountId` extraction, expiry window, and expected `DyadError` classification using mocked `fetch`.
- `src/__tests__/readSettings.test.ts` for encrypting/decrypting `providerSettings.anthropic.oauth` and `providerSettings.openai.oauth`, including preserving API keys and deleting only broken OAuth fields.
- If the custom OpenAI Codex `fetch` rewrite is needed, add a focused unit test for the rewrite helper rather than relying only on manual streaming tests.

A full E2E test is optional for the first implementation because real OAuth requires browser/provider interaction. If a mocked E2E is added later, follow `rules/e2e-testing.md` and run `npm run build` before Playwright.

## Risks

- Anthropic policy/product risk: Claude subscription login in third-party apps may require Anthropic approval, so this should be hidden behind careful copy or limited to advanced/local use.
- OAuth constants are unofficial/public-client constants borrowed from Claude Code/Codex CLI behavior and can change without notice.
- Anthropic subscription OAuth may require additional headers on Messages API inference requests, not only token requests.
- OpenAI Codex subscription traffic uses ChatGPT backend paths that differ from normal OpenAI API paths; AI SDK URL behavior must be verified and may require a custom fetch rewrite.
- Refresh writes can clobber concurrent settings changes unless every async path re-reads settings immediately before writing.
- Token storage must never log raw token payloads, callback URLs with codes, or decrypted settings.

## Verification Criteria

- `npm run fmt:check`
- `npm run lint`
- `npm run ts`
- Targeted Vitest files for OAuth utilities and settings encryption.
- `npm run test` if feasible after targeted tests pass.
- Manual verification for Anthropic: Settings → Providers → Anthropic starts OAuth, browser opens, pasted code completes, status shows connected, model calls use OAuth, disconnect preserves API key, expired token refreshes or falls back correctly.
- Manual verification for OpenAI: Settings → Providers → OpenAI starts ChatGPT/Codex OAuth, browser opens, callback completes, status shows connected with account ID when present, model calls route to Codex Responses with account header, disconnect preserves API key, expired token refreshes or falls back correctly.

## Steps

1. Add shared PKCE and authorization-input parsing utilities in `src/ipc/utils/oauth_pkce.ts` with unit tests for deterministic parsing and token-safe behavior.
2. Add Anthropic OAuth utilities in `src/ipc/utils/anthropic_oauth.ts` for URL creation, code/state validation, token exchange, refresh, expiry checks, and `DyadError` classification.
3. Add OpenAI Codex OAuth utilities in `src/ipc/utils/openai_codex_oauth.ts` for URL creation, optional callback parsing, token exchange, refresh, JWT account ID extraction, expiry checks, and `DyadError` classification.
4. Extend `src/lib/schemas.ts` so regular provider settings can store optional encrypted OAuth token sets for Anthropic and OpenAI without adding a new default setting.
5. Update `src/main/settings.ts` to encrypt and decrypt provider OAuth access and refresh tokens alongside existing provider API key encryption, preserving non-secret OAuth metadata and API-key fallbacks.
6. Add provider OAuth IPC contracts/client/types in `src/ipc/types/oauth.ts`, export them from `src/ipc/types/index.ts`, and add OAuth query keys in `src/lib/queryKeys.ts`.
7. Implement `src/ipc/handlers/oauth_handlers.ts` with start, complete, status, and logout handlers using `createTypedHandler`, `shell.openExternal`, short-lived in-memory PKCE sessions, `DyadError`, and fresh settings reads immediately before writes.
8. Register OAuth handlers in `src/ipc/ipc_host.ts` and verify the preload allowlist picks up the new contract channels automatically.
9. Update `src/ipc/utils/get_model_client.ts` so Anthropic OAuth uses `createAnthropic({ authToken })`, OpenAI OAuth uses Codex Responses routing and account headers, both providers refresh expired tokens safely, and both fall back to API keys only when available.
10. Add `src/components/settings/ProviderOAuthConfiguration.tsx` and integrate it into `src/components/settings/ProviderSettingsPage.tsx` for Anthropic and OpenAI only, matching existing settings styling and Base UI patterns.
11. Update provider configured-state logic in `ProviderSettingsPage` so a connected OAuth token counts as setup for Anthropic/OpenAI without changing Azure, Vertex, Dyad Pro, local, or custom provider behavior.
12. Add targeted unit tests for Anthropic OAuth, OpenAI Codex OAuth, shared PKCE/input parsing, settings OAuth encryption/decryption, and any Codex URL rewrite helper.
13. Run `npm run fmt:check`, `npm run lint`, `npm run ts`, targeted Vitest files, and `npm run test` if feasible; fix failures before implementation is considered complete.
