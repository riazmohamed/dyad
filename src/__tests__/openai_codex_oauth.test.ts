import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { DyadErrorKind } from "@/errors/dyad_error";
import {
  OPENAI_CODEX_BASE_URL,
  OPENAI_CODEX_OAUTH_AUTH_URL,
  OPENAI_CODEX_OAUTH_CLIENT_ID,
  OPENAI_CODEX_OAUTH_REDIRECT_URI,
  OPENAI_CODEX_OAUTH_TOKEN_URL,
  OPENAI_CODEX_ORIGINATOR,
  OPENAI_CODEX_RESPONSES_URL,
  createOpenAICodexAuthorizationUrl,
  createOpenAICodexFetch,
  exchangeOpenAICodexOAuthCode,
  extractOpenAICodexAccountId,
  isOpenAICodexOAuthTokenExpired,
  refreshOpenAICodexOAuthToken,
  rewriteOpenAICodexResponsesRequest,
} from "@/ipc/utils/openai_codex_oauth";

const accessTokenWithAccountId = createJwtPayload({
  "https://api.openai.com/auth": {
    chatgpt_account_id: "account-123",
  },
});

const successfulTokenResponse = {
  access_token: accessTokenWithAccountId,
  refresh_token: "refresh-token",
  expires_in: 3600,
};

describe("openai_codex_oauth", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-18T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("builds the OpenAI Codex authorization URL", () => {
    const url = new URL(
      createOpenAICodexAuthorizationUrl({
        codeChallenge: "challenge",
        state: "state-value",
      }),
    );

    expect(`${url.origin}${url.pathname}`).toBe(OPENAI_CODEX_OAUTH_AUTH_URL);
    expect(url.searchParams.get("client_id")).toBe(
      OPENAI_CODEX_OAUTH_CLIENT_ID,
    );
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("redirect_uri")).toBe(
      OPENAI_CODEX_OAUTH_REDIRECT_URI,
    );
    expect(url.searchParams.get("scope")).toContain("offline_access");
    expect(url.searchParams.get("scope")).toContain("api.connectors.invoke");
    expect(url.searchParams.get("code_challenge")).toBe("challenge");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe("state-value");
    expect(url.searchParams.get("id_token_add_organizations")).toBe("true");
    expect(url.searchParams.get("codex_cli_simplified_flow")).toBe("true");
    expect(url.searchParams.get("originator")).toBe(OPENAI_CODEX_ORIGINATOR);
  });

  it("exchanges code using form encoded request shape", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () =>
      Response.json(successfulTokenResponse),
    );

    const tokenSet = await exchangeOpenAICodexOAuthCode({
      code: "auth-code",
      codeVerifier: "verifier",
      fetchFn,
    });

    expect(fetchFn).toHaveBeenCalledWith(OPENAI_CODEX_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        originator: OPENAI_CODEX_ORIGINATOR,
      },
      body: expect.any(URLSearchParams),
    });
    const body = fetchFn.mock.calls[0]?.[1]?.body as URLSearchParams;
    expect(Object.fromEntries(body.entries())).toEqual({
      grant_type: "authorization_code",
      client_id: OPENAI_CODEX_OAUTH_CLIENT_ID,
      code: "auth-code",
      redirect_uri: OPENAI_CODEX_OAUTH_REDIRECT_URI,
      code_verifier: "verifier",
    });
    expect(tokenSet).toEqual({
      type: "openai-codex",
      accessToken: accessTokenWithAccountId,
      refreshToken: "refresh-token",
      expiresAt: Date.now() + 3600 * 1000,
      accountId: "account-123",
      baseUrl: OPENAI_CODEX_BASE_URL,
    });
  });

  it("refreshes tokens and keeps existing refresh token when none is returned", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () =>
      Response.json({
        access_token: accessTokenWithAccountId,
        expires_in: 100,
      }),
    );

    const tokenSet = await refreshOpenAICodexOAuthToken({
      refreshToken: "old-refresh",
      fetchFn,
    });

    const body = fetchFn.mock.calls[0]?.[1]?.body as URLSearchParams;
    expect(Object.fromEntries(body.entries())).toEqual({
      grant_type: "refresh_token",
      client_id: OPENAI_CODEX_OAUTH_CLIENT_ID,
      refresh_token: "old-refresh",
    });
    expect(tokenSet.refreshToken).toBe("old-refresh");
    expect(tokenSet.accountId).toBe("account-123");
  });

  it("classifies auth failures", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () =>
      Response.json({ error_description: "invalid grant" }, { status: 400 }),
    );

    await expect(
      exchangeOpenAICodexOAuthCode({
        code: "auth-code",
        codeVerifier: "verifier",
        fetchFn,
      }),
    ).rejects.toMatchObject({ kind: DyadErrorKind.Auth });
  });

  it("extracts ChatGPT account ID from access token JWT claim", () => {
    expect(extractOpenAICodexAccountId(accessTokenWithAccountId)).toBe(
      "account-123",
    );
    expect(extractOpenAICodexAccountId("not-a-jwt")).toBeUndefined();
    expect(
      extractOpenAICodexAccountId(createJwtPayload({ sub: "user" })),
    ).toBeUndefined();
  });

  it("detects expiry inside the refresh window", () => {
    const now = Date.now();

    expect(isOpenAICodexOAuthTokenExpired(now + 6 * 60 * 1000, now)).toBe(
      false,
    );
    expect(isOpenAICodexOAuthTokenExpired(now + 4 * 60 * 1000, now)).toBe(true);
  });

  it("rewrites Codex Responses URLs", () => {
    expect(
      rewriteOpenAICodexResponsesRequest(
        "https://chatgpt.com/backend-api/codex/v1/responses",
      ),
    ).toBe(OPENAI_CODEX_RESPONSES_URL);
    expect(
      rewriteOpenAICodexResponsesRequest("https://api.openai.com/v1/responses"),
    ).toBe(OPENAI_CODEX_RESPONSES_URL);
    expect(
      rewriteOpenAICodexResponsesRequest("https://api.openai.com/v1/models"),
    ).toBe("https://api.openai.com/v1/models");
  });

  it("creates fetch middleware that rewrites and normalizes Responses request", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () =>
      Response.json({ ok: true }),
    );
    const codexFetch = createOpenAICodexFetch(fetchFn);

    await codexFetch("https://chatgpt.com/backend-api/codex/v1/responses", {
      method: "POST",
      headers: {
        accept: "application/json",
        "user-agent": "sdk-agent",
        "chatgpt-account-id": "account-123",
      },
      body: JSON.stringify({
        model: "gpt-5.5",
        input: [{ id: "item-1", role: "user", content: "hello" }],
        previous_response_id: "previous",
        max_output_tokens: 100,
        stream_options: {},
      }),
    });

    const init = fetchFn.mock.calls[0]?.[1];
    expect(fetchFn.mock.calls[0]?.[0]).toBe(OPENAI_CODEX_RESPONSES_URL);
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("accept")).toBe("text/event-stream");
    expect(new Headers(init?.headers).get("originator")).toBe(
      OPENAI_CODEX_ORIGINATOR,
    );
    expect(new Headers(init?.headers).get("chatgpt-account-id")).toBe(
      "account-123",
    );
    expect(JSON.parse(init?.body as string)).toEqual({
      model: "gpt-5.5",
      input: [{ role: "user", content: "hello" }],
      stream: true,
      store: false,
      instructions: "",
    });
  });
});

function createJwtPayload(payload: Record<string, unknown>): string {
  return [
    base64UrlEncode(JSON.stringify({ alg: "none" })),
    base64UrlEncode(JSON.stringify(payload)),
    "signature",
  ].join(".");
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}
