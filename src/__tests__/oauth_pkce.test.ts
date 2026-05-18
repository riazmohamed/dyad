import { describe, expect, it } from "vitest";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  base64UrlEncode,
  generatePkceChallenge,
  parseAuthorizationInput,
} from "@/ipc/utils/oauth_pkce";

describe("oauth_pkce", () => {
  it("encodes base64url without padding", () => {
    expect(base64UrlEncode(Buffer.from([251, 255, 255]))).toBe("-___");
    expect(base64UrlEncode(Buffer.from("hello"))).toBe("aGVsbG8");
  });

  it("generates PKCE verifier and S256 challenge", () => {
    const challenge = generatePkceChallenge();

    expect(challenge.codeVerifier).toMatch(/^[A-Za-z0-9_-]{43,}$/);
    expect(challenge.codeChallenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challenge.codeChallengeMethod).toBe("S256");
    expect(challenge.codeChallenge).not.toBe(challenge.codeVerifier);
  });

  it.each([
    ["raw-code", { code: "raw-code" }],
    ["raw-code#state-value", { code: "raw-code", state: "state-value" }],
    [
      "?code=query-code&state=query-state",
      { code: "query-code", state: "query-state" },
    ],
    [
      "code=query-code&state=query-state",
      { code: "query-code", state: "query-state" },
    ],
    [
      "http://localhost:1455/auth/callback?code=url-code&state=url-state",
      { code: "url-code", state: "url-state" },
    ],
    [
      "https://platform.claude.com/oauth/code/callback#code=hash-code&state=hash-state",
      { code: "hash-code", state: "hash-state" },
    ],
  ])("parses authorization input %s", (input, expected) => {
    expect(parseAuthorizationInput(input)).toEqual(expected);
  });

  it("classifies missing code as validation error", () => {
    expect(() => parseAuthorizationInput("?state=abc")).toThrow(DyadError);

    try {
      parseAuthorizationInput("?state=abc");
    } catch (error) {
      expect(error).toBeInstanceOf(DyadError);
      expect((error as DyadError).kind).toBe(DyadErrorKind.Validation);
    }
  });
});
