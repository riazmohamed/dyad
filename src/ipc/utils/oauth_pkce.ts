import { createHash, randomBytes } from "node:crypto";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const PKCE_VERIFIER_BYTES = 32;
const OAUTH_RANDOM_BYTES = 32;

export interface PkceChallenge {
  codeVerifier: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
}

export interface ParsedAuthorizationInput {
  code: string;
  state?: string;
}

export function base64UrlEncode(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function generateRandomOAuthString(bytes = OAUTH_RANDOM_BYTES): string {
  return base64UrlEncode(randomBytes(bytes));
}

export function generateOAuthSessionId(): string {
  return generateRandomOAuthString();
}

export function generateOAuthState(): string {
  return generateRandomOAuthString();
}

export function generatePkceChallenge(): PkceChallenge {
  const codeVerifier = generateRandomOAuthString(PKCE_VERIFIER_BYTES);
  const codeChallenge = base64UrlEncode(
    createHash("sha256").update(codeVerifier).digest(),
  );

  return {
    codeVerifier,
    codeChallenge,
    codeChallengeMethod: "S256",
  };
}

export function parseAuthorizationInput(
  input: string,
): ParsedAuthorizationInput {
  const trimmedInput = input.trim();
  if (!trimmedInput) {
    throw new DyadError(
      "Paste the authorization code or callback URL to complete sign in.",
      DyadErrorKind.Validation,
    );
  }

  const urlParsed = parseAuthorizationUrl(trimmedInput);
  if (urlParsed) {
    return urlParsed;
  }

  const queryParsed = parseAuthorizationSearchParams(trimmedInput);
  if (queryParsed) {
    return queryParsed;
  }

  const hashIndex = trimmedInput.indexOf("#");
  if (hashIndex > 0) {
    const code = trimmedInput.slice(0, hashIndex).trim();
    const state = trimmedInput.slice(hashIndex + 1).trim();
    return normalizeParsedAuthorizationInput({ code, state });
  }

  return normalizeParsedAuthorizationInput({ code: trimmedInput });
}

function parseAuthorizationUrl(input: string): ParsedAuthorizationInput | null {
  try {
    const parsedUrl = new URL(input);
    const fromSearch = parseAuthorizationSearchParams(parsedUrl.search);
    if (fromSearch) {
      return fromSearch;
    }
    return parseAuthorizationSearchParams(parsedUrl.hash);
  } catch {
    return null;
  }
}

function parseAuthorizationSearchParams(
  input: string,
): ParsedAuthorizationInput | null {
  const trimmedInput = input.trim();
  const hasStructuredParams =
    trimmedInput.startsWith("?") ||
    trimmedInput.startsWith("#") ||
    trimmedInput.includes("code=") ||
    trimmedInput.includes("state=");

  if (!hasStructuredParams) {
    return null;
  }

  const normalizedInput = trimmedInput.replace(/^[?#]/, "");
  const params = new URLSearchParams(normalizedInput);
  const code = params.get("code")?.trim() ?? "";
  const state = params.get("state")?.trim() ?? undefined;

  return normalizeParsedAuthorizationInput({ code, state });
}

function normalizeParsedAuthorizationInput({
  code,
  state,
}: ParsedAuthorizationInput): ParsedAuthorizationInput {
  const normalizedCode = code.trim();
  const normalizedState = state?.trim();

  if (!normalizedCode) {
    throw new DyadError(
      "The pasted authorization response did not include a code.",
      DyadErrorKind.Validation,
    );
  }

  return {
    code: normalizedCode,
    ...(normalizedState ? { state: normalizedState } : {}),
  };
}
