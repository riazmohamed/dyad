import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  ANTHROPIC_OAUTH_AUTH_URL,
  ANTHROPIC_OAUTH_BETA_HEADER,
  ANTHROPIC_OAUTH_CLIENT_ID,
  ANTHROPIC_OAUTH_REDIRECT_URI,
  ANTHROPIC_OAUTH_TOKEN_URLS,
  createAnthropicAuthorizationUrl,
  exchangeAnthropicOAuthCode,
  getAnthropicOAuthUserAgent,
  isAnthropicOAuthTokenExpired,
  parseAnthropicAuthorizationResponse,
  refreshAnthropicOAuthToken,
} from "@/ipc/utils/anthropic_oauth";

const successfulTokenResponse = {
  access_token: "access-token",
  refresh_token: "refresh-token",
  expires_in: 3600,
};

describe("anthropic_oauth", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-18T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("builds the Anthropic authorization URL", () => {
    const url = new URL(
      createAnthropicAuthorizationUrl({
        codeChallenge: "challenge",
        state: "state-value",
      }),
    );

    expect(`${url.origin}${url.pathname}`).toBe(ANTHROPIC_OAUTH_AUTH_URL);
    expect(url.searchParams.get("client_id")).toBe(ANTHROPIC_OAUTH_CLIENT_ID);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("redirect_uri")).toBe(
      ANTHROPIC_OAUTH_REDIRECT_URI,
    );
    expect(url.searchParams.get("code")).toBe("true");
    expect(url.searchParams.get("scope")).toContain("user:inference");
    expect(url.searchParams.get("scope")).toContain(
      "user:sessions:claude_code",
    );
    expect(url.searchParams.get("code_challenge")).toBe("challenge");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe("state-value");
  });

  it("parses and validates the authorization response state", () => {
    expect(
      parseAnthropicAuthorizationResponse({
        code: "https://platform.claude.com/oauth/code/callback?code=abc&state=expected",
        expectedState: "expected",
      }),
    ).toEqual({ code: "abc", state: "expected" });
  });

  it("rejects mismatched state", () => {
    expect(() =>
      parseAnthropicAuthorizationResponse({
        code: "abc#wrong",
        expectedState: "expected",
      }),
    ).toThrow(DyadError);

    try {
      parseAnthropicAuthorizationResponse({
        code: "abc#wrong",
        expectedState: "expected",
      });
    } catch (error) {
      expect((error as DyadError).kind).toBe(DyadErrorKind.Auth);
    }
  });

  it("exchanges code using JSON Anthropic OAuth request shape", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () =>
      Response.json(successfulTokenResponse),
    );

    const tokenSet = await exchangeAnthropicOAuthCode({
      code: "auth-code",
      codeVerifier: "verifier",
      state: "state-value",
      fetchFn,
    });

    expect(fetchFn).toHaveBeenCalledWith(ANTHROPIC_OAUTH_TOKEN_URLS[0], {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "anthropic-beta": ANTHROPIC_OAUTH_BETA_HEADER,
        "user-agent": getAnthropicOAuthUserAgent(),
      },
      body: JSON.stringify({
        grant_type: "authorization_code",
        client_id: ANTHROPIC_OAUTH_CLIENT_ID,
        code: "auth-code",
        state: "state-value",
        redirect_uri: ANTHROPIC_OAUTH_REDIRECT_URI,
        code_verifier: "verifier",
      }),
    });
    expect(tokenSet).toEqual({
      type: "anthropic",
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresAt: Date.now() + 3600 * 1000,
    });
  });

  it("falls back to console token endpoint for transient platform failures", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ error: "bad gateway" }, { status: 502 }),
      )
      .mockResolvedValueOnce(Response.json(successfulTokenResponse));

    await exchangeAnthropicOAuthCode({
      code: "auth-code",
      codeVerifier: "verifier",
      state: "state-value",
      fetchFn,
    });

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fetchFn.mock.calls[1]?.[0]).toBe(ANTHROPIC_OAUTH_TOKEN_URLS[1]);
  });

  it("does not fallback for auth failures", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () =>
      Response.json({ error: "invalid_grant" }, { status: 400 }),
    );

    await expect(
      exchangeAnthropicOAuthCode({
        code: "auth-code",
        codeVerifier: "verifier",
        state: "state-value",
        fetchFn,
      }),
    ).rejects.toMatchObject({ kind: DyadErrorKind.Auth });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("refreshes tokens and keeps existing refresh token when none is returned", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () =>
      Response.json({ access_token: "new-access", expires_in: 100 }),
    );

    const tokenSet = await refreshAnthropicOAuthToken({
      refreshToken: "old-refresh",
      fetchFn,
    });

    expect(JSON.parse(fetchFn.mock.calls[0]?.[1]?.body as string)).toEqual({
      grant_type: "refresh_token",
      client_id: ANTHROPIC_OAUTH_CLIENT_ID,
      refresh_token: "old-refresh",
    });
    expect(tokenSet.refreshToken).toBe("old-refresh");
    expect(tokenSet.accessToken).toBe("new-access");
  });

  it("detects expiry inside the refresh window", () => {
    const now = Date.now();

    expect(isAnthropicOAuthTokenExpired(now + 6 * 60 * 1000, now)).toBe(false);
    expect(isAnthropicOAuthTokenExpired(now + 4 * 60 * 1000, now)).toBe(true);
  });
});
