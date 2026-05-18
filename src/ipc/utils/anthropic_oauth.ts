import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  parseAuthorizationInput,
  type ParsedAuthorizationInput,
} from "./oauth_pkce";

export const ANTHROPIC_OAUTH_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
export const ANTHROPIC_OAUTH_AUTH_URL = "https://claude.ai/oauth/authorize";
export const ANTHROPIC_OAUTH_REDIRECT_URI =
  "https://platform.claude.com/oauth/code/callback";
export const ANTHROPIC_OAUTH_TOKEN_URLS = [
  "https://platform.claude.com/v1/oauth/token",
  "https://console.anthropic.com/v1/oauth/token",
] as const;
export const ANTHROPIC_OAUTH_BETA_HEADER = "oauth-2025-04-20";
export const ANTHROPIC_OAUTH_EXPIRY_WINDOW_MS = 5 * 60 * 1000;

const ANTHROPIC_OAUTH_USER_AGENT = "claude-cli/1.0.56 (external, cli)";

interface AnthropicOAuthUrlInput {
  codeChallenge: string;
  state: string;
}

interface AnthropicOAuthCompleteInput {
  code: string;
  state?: string;
  expectedState: string;
}

interface AnthropicTokenExchangeInput {
  code: string;
  codeVerifier: string;
  state: string;
  fetchFn?: typeof fetch;
}

interface AnthropicTokenRefreshInput {
  refreshToken: string;
  fetchFn?: typeof fetch;
}

interface AnthropicTokenSuccessResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

export interface AnthropicOAuthTokenSet {
  type: "anthropic";
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export function getAnthropicOAuthUserAgent(): string {
  return ANTHROPIC_OAUTH_USER_AGENT;
}

export function createAnthropicAuthorizationUrl({
  codeChallenge,
  state,
}: AnthropicOAuthUrlInput): string {
  const url = new URL(ANTHROPIC_OAUTH_AUTH_URL);
  url.searchParams.set("code", "true");
  url.searchParams.set("client_id", ANTHROPIC_OAUTH_CLIENT_ID);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", ANTHROPIC_OAUTH_REDIRECT_URI);
  url.searchParams.set(
    "scope",
    "org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload",
  );
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  return url.toString();
}

export function parseAnthropicAuthorizationResponse({
  code,
  state,
  expectedState,
}: AnthropicOAuthCompleteInput): ParsedAuthorizationInput {
  const parsed = parseAuthorizationInput(code);
  const responseState = parsed.state ?? state;

  if (!responseState) {
    throw new DyadError(
      "The Anthropic sign-in response did not include a state value.",
      DyadErrorKind.Validation,
    );
  }

  if (responseState !== expectedState) {
    throw new DyadError(
      "The Anthropic sign-in response did not match this sign-in session. Please start again.",
      DyadErrorKind.Auth,
    );
  }

  return {
    code: parsed.code,
    state: responseState,
  };
}

export async function exchangeAnthropicOAuthCode({
  code,
  codeVerifier,
  state,
  fetchFn = fetch,
}: AnthropicTokenExchangeInput): Promise<AnthropicOAuthTokenSet> {
  const body = {
    grant_type: "authorization_code",
    client_id: ANTHROPIC_OAUTH_CLIENT_ID,
    code,
    state,
    redirect_uri: ANTHROPIC_OAUTH_REDIRECT_URI,
    code_verifier: codeVerifier,
  };

  return exchangeAnthropicTokenWithFallback({ body, fetchFn });
}

export async function refreshAnthropicOAuthToken({
  refreshToken,
  fetchFn = fetch,
}: AnthropicTokenRefreshInput): Promise<AnthropicOAuthTokenSet> {
  const body = {
    grant_type: "refresh_token",
    client_id: ANTHROPIC_OAUTH_CLIENT_ID,
    refresh_token: refreshToken,
  };

  return exchangeAnthropicTokenWithFallback({
    body,
    fetchFn,
    previousRefreshToken: refreshToken,
  });
}

export function isAnthropicOAuthTokenExpired(
  expiresAt: number,
  now = Date.now(),
): boolean {
  return expiresAt <= now + ANTHROPIC_OAUTH_EXPIRY_WINDOW_MS;
}

async function exchangeAnthropicTokenWithFallback({
  body,
  fetchFn,
  previousRefreshToken,
}: {
  body: Record<string, string>;
  fetchFn: typeof fetch;
  previousRefreshToken?: string;
}): Promise<AnthropicOAuthTokenSet> {
  let lastError: unknown;

  for (const tokenUrl of ANTHROPIC_OAUTH_TOKEN_URLS) {
    try {
      return await requestAnthropicToken({
        tokenUrl,
        body,
        fetchFn,
        previousRefreshToken,
      });
    } catch (error) {
      if (isAnthropicAuthError(error)) {
        throw error;
      }
      lastError = error;
    }
  }

  if (lastError instanceof DyadError) {
    throw lastError;
  }

  throw new DyadError(
    "Anthropic sign-in failed because the token service did not respond successfully.",
    DyadErrorKind.External,
  );
}

async function requestAnthropicToken({
  tokenUrl,
  body,
  fetchFn,
  previousRefreshToken,
}: {
  tokenUrl: string;
  body: Record<string, string>;
  fetchFn: typeof fetch;
  previousRefreshToken?: string;
}): Promise<AnthropicOAuthTokenSet> {
  let response: Response;
  try {
    response = await fetchFn(tokenUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "anthropic-beta": ANTHROPIC_OAUTH_BETA_HEADER,
        "user-agent": getAnthropicOAuthUserAgent(),
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new DyadError(
      `Could not reach Anthropic sign-in service: ${formatErrorMessage(error)}`,
      DyadErrorKind.External,
    );
  }

  if (!response.ok) {
    throw await createAnthropicTokenError(response);
  }

  const tokenResponse = await parseAnthropicTokenResponse(response);
  const refreshToken = tokenResponse.refresh_token ?? previousRefreshToken;

  if (!tokenResponse.access_token || !refreshToken) {
    throw new DyadError(
      "Anthropic sign-in did not return the expected tokens.",
      DyadErrorKind.External,
    );
  }

  return {
    type: "anthropic",
    accessToken: tokenResponse.access_token,
    refreshToken,
    expiresAt: Date.now() + (tokenResponse.expires_in ?? 3600) * 1000,
  };
}

async function createAnthropicTokenError(
  response: Response,
): Promise<DyadError> {
  const message = await readTokenErrorMessage(response);
  const kind =
    response.status >= 400 && response.status < 500
      ? DyadErrorKind.Auth
      : DyadErrorKind.External;

  return new DyadError(
    message
      ? `Anthropic sign-in failed: ${message}`
      : "Anthropic sign-in failed. Please try again.",
    kind,
  );
}

async function parseAnthropicTokenResponse(
  response: Response,
): Promise<AnthropicTokenSuccessResponse> {
  try {
    const raw =
      (await response.json()) as Partial<AnthropicTokenSuccessResponse>;
    return {
      access_token:
        typeof raw.access_token === "string" ? raw.access_token : "",
      refresh_token:
        typeof raw.refresh_token === "string" ? raw.refresh_token : undefined,
      expires_in:
        typeof raw.expires_in === "number" ? raw.expires_in : undefined,
    };
  } catch (error) {
    throw new DyadError(
      `Anthropic sign-in returned an invalid response: ${formatErrorMessage(error)}`,
      DyadErrorKind.External,
    );
  }
}

async function readTokenErrorMessage(response: Response): Promise<string> {
  try {
    const raw = (await response.json()) as Record<string, unknown>;
    const directError = raw.error;
    if (typeof directError === "string") {
      return directError;
    }
    if (typeof directError === "object" && directError !== null) {
      const nestedMessage = (directError as Record<string, unknown>).message;
      if (typeof nestedMessage === "string") {
        return nestedMessage;
      }
    }
    if (typeof raw.error_description === "string") {
      return raw.error_description;
    }
    if (typeof raw.message === "string") {
      return raw.message;
    }
  } catch {
    return "";
  }

  return "";
}

function isAnthropicAuthError(error: unknown): boolean {
  return error instanceof DyadError && error.kind === DyadErrorKind.Auth;
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
