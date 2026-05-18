import http from "node:http";
import { shell } from "electron";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { readSettings, writeSettings } from "@/main/settings";
import { oauthContracts, type ProviderOAuthProvider } from "../types/oauth";
import { createTypedHandler } from "./base";
import {
  generateOAuthSessionId,
  generateOAuthState,
  generatePkceChallenge,
  parseAuthorizationInput,
} from "../utils/oauth_pkce";
import {
  createAnthropicAuthorizationUrl,
  exchangeAnthropicOAuthCode,
  parseAnthropicAuthorizationResponse,
} from "../utils/anthropic_oauth";
import {
  createOpenAICodexAuthorizationUrl,
  exchangeOpenAICodexOAuthCode,
} from "../utils/openai_codex_oauth";
import type { OAuthTokenSet, RegularProviderSetting } from "@/lib/schemas";

const OAUTH_SESSION_TTL_MS = 10 * 60 * 1000;

interface ProviderOAuthSession {
  provider: ProviderOAuthProvider;
  codeVerifier: string;
  state: string;
  createdAt: number;
  completedOAuthTokenSet?: OAuthTokenSet;
}

const providerOAuthSessions = new Map<string, ProviderOAuthSession>();

export function registerOAuthHandlers(): void {
  createTypedHandler(oauthContracts.startProviderOAuth, async (_, input) => {
    purgeExpiredProviderOAuthSessions();

    const pkceChallenge = generatePkceChallenge();
    const state = generateOAuthState();
    const sessionId = generateOAuthSessionId();
    const authorizationUrl = createAuthorizationUrl({
      provider: input.provider,
      codeChallenge: pkceChallenge.codeChallenge,
      state,
    });

    const session: ProviderOAuthSession = {
      provider: input.provider,
      codeVerifier: pkceChallenge.codeVerifier,
      state,
      createdAt: Date.now(),
    };
    providerOAuthSessions.set(sessionId, session);

    if (input.provider === "openai") {
      startOpenAICodexCallbackServer({ sessionId, session });
    }

    await shell.openExternal(authorizationUrl);

    return {
      authorizationUrl,
      sessionId,
      provider: input.provider,
    };
  });

  createTypedHandler(oauthContracts.completeProviderOAuth, async (_, input) => {
    purgeExpiredProviderOAuthSessions();

    const session = providerOAuthSessions.get(input.sessionId);
    if (!session) {
      throw new DyadError(
        "This sign-in session has expired. Please start again.",
        DyadErrorKind.Auth,
      );
    }

    if (session.provider !== input.provider) {
      throw new DyadError(
        "This sign-in session is for a different provider. Please start again.",
        DyadErrorKind.Validation,
      );
    }

    const oauthTokenSet = session.completedOAuthTokenSet
      ? session.completedOAuthTokenSet
      : await completeProviderOAuth({
          provider: input.provider,
          code: input.code,
          session,
        });

    providerOAuthSessions.delete(input.sessionId);
    saveProviderOAuthTokenSet(input.provider, oauthTokenSet);

    return {
      connected: true as const,
      expiresAt: oauthTokenSet.expiresAt,
      ...(oauthTokenSet.accountId
        ? { accountId: oauthTokenSet.accountId }
        : {}),
    };
  });

  createTypedHandler(oauthContracts.logoutProviderOAuth, async (_, input) => {
    const settings = readSettings();
    const existingProviderSetting = settings.providerSettings[input.provider] as
      | RegularProviderSetting
      | undefined;
    if (!existingProviderSetting?.oauth) {
      return;
    }

    const { oauth: _oauth, ...providerSettingWithoutOAuth } =
      existingProviderSetting;

    writeSettings({
      providerSettings: {
        ...settings.providerSettings,
        [input.provider]: providerSettingWithoutOAuth,
      },
    });
  });

  createTypedHandler(
    oauthContracts.getProviderOAuthStatus,
    async (_, input) => {
      const providerSetting = readSettings().providerSettings[input.provider] as
        | RegularProviderSetting
        | undefined;
      const oauth = providerSetting?.oauth;
      if (!oauth) {
        return { connected: false };
      }

      return {
        connected: true,
        expiresAt: oauth.expiresAt,
        ...(oauth.accountId ? { accountId: oauth.accountId } : {}),
      };
    },
  );
}

function createAuthorizationUrl({
  provider,
  codeChallenge,
  state,
}: {
  provider: ProviderOAuthProvider;
  codeChallenge: string;
  state: string;
}): string {
  switch (provider) {
    case "anthropic":
      return createAnthropicAuthorizationUrl({ codeChallenge, state });
    case "openai":
      return createOpenAICodexAuthorizationUrl({ codeChallenge, state });
  }
}

async function completeProviderOAuth({
  provider,
  code,
  session,
}: {
  provider: ProviderOAuthProvider;
  code: string;
  session: ProviderOAuthSession;
}): Promise<OAuthTokenSet> {
  switch (provider) {
    case "anthropic": {
      const parsed = parseAnthropicAuthorizationResponse({
        code,
        expectedState: session.state,
      });
      const tokenSet = await exchangeAnthropicOAuthCode({
        code: parsed.code,
        codeVerifier: session.codeVerifier,
        state: session.state,
      });
      return toSettingsOAuthTokenSet(tokenSet);
    }
    case "openai": {
      const parsed = parseAuthorizationInput(code);
      const responseState = parsed.state;
      if (!responseState) {
        throw new DyadError(
          "The OpenAI sign-in response did not include a state value.",
          DyadErrorKind.Validation,
        );
      }
      if (responseState !== session.state) {
        throw new DyadError(
          "The OpenAI sign-in response did not match this sign-in session. Please start again.",
          DyadErrorKind.Auth,
        );
      }
      const tokenSet = await exchangeOpenAICodexOAuthCode({
        code: parsed.code,
        codeVerifier: session.codeVerifier,
      });
      return toSettingsOAuthTokenSet(tokenSet);
    }
  }
}

function saveProviderOAuthTokenSet(
  provider: ProviderOAuthProvider,
  oauthTokenSet: OAuthTokenSet,
): void {
  const settings = readSettings();
  writeSettings({
    providerSettings: {
      ...settings.providerSettings,
      [provider]: {
        ...settings.providerSettings[provider],
        oauth: oauthTokenSet,
      },
    },
  });
}

function toSettingsOAuthTokenSet(tokenSet: {
  type: OAuthTokenSet["type"];
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  accountId?: string;
  baseUrl?: string;
}): OAuthTokenSet {
  return {
    type: tokenSet.type,
    accessToken: { value: tokenSet.accessToken },
    refreshToken: { value: tokenSet.refreshToken },
    expiresAt: tokenSet.expiresAt,
    ...(tokenSet.accountId ? { accountId: tokenSet.accountId } : {}),
    ...(tokenSet.baseUrl ? { baseUrl: tokenSet.baseUrl } : {}),
  };
}

function startOpenAICodexCallbackServer({
  sessionId,
  session,
}: {
  sessionId: string;
  session: ProviderOAuthSession;
}): void {
  const server = http.createServer((request, response) => {
    handleOpenAICodexCallback({ sessionId, session, request, response })
      .catch((error) => {
        response.writeHead(400, { "content-type": "text/html; charset=utf-8" });
        response.end(
          renderOAuthCallbackPage("Sign-in failed", formatErrorMessage(error)),
        );
      })
      .finally(() => {
        server.close();
      });
  });

  server.on("error", () => {
    // Manual paste remains available when port 1455 is unavailable.
  });

  server.listen(1455, "127.0.0.1");
  setTimeout(() => server.close(), OAUTH_SESSION_TTL_MS).unref();
}

async function handleOpenAICodexCallback({
  sessionId,
  session,
  request,
  response,
}: {
  sessionId: string;
  session: ProviderOAuthSession;
  request: http.IncomingMessage;
  response: http.ServerResponse;
}): Promise<void> {
  const requestUrl = new URL(request.url ?? "/", "http://localhost:1455");
  if (requestUrl.pathname !== "/auth/callback") {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  const code = requestUrl.searchParams.get("code") ?? "";
  const state = requestUrl.searchParams.get("state") ?? "";
  if (!code || state !== session.state) {
    throw new DyadError(
      "The OpenAI sign-in callback did not match this sign-in session.",
      DyadErrorKind.Auth,
    );
  }

  const tokenSet = await exchangeOpenAICodexOAuthCode({
    code,
    codeVerifier: session.codeVerifier,
  });
  const oauthTokenSet = toSettingsOAuthTokenSet(tokenSet);
  session.completedOAuthTokenSet = oauthTokenSet;
  providerOAuthSessions.delete(sessionId);
  saveProviderOAuthTokenSet("openai", oauthTokenSet);

  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(
    renderOAuthCallbackPage(
      "Sign-in complete",
      "You can close this tab and return to Dyad.",
    ),
  );
}

function renderOAuthCallbackPage(title: string, message: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></body></html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function purgeExpiredProviderOAuthSessions(): void {
  const now = Date.now();
  for (const [sessionId, session] of providerOAuthSessions.entries()) {
    if (session.createdAt + OAUTH_SESSION_TTL_MS <= now) {
      providerOAuthSessions.delete(sessionId);
    }
  }
}

export function clearProviderOAuthSessionsForTesting(): void {
  providerOAuthSessions.clear();
}
