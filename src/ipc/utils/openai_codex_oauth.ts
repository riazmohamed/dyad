import log from "electron-log";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const logger = log.scope("openai_codex_oauth");

export const OPENAI_CODEX_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export const OPENAI_CODEX_OAUTH_AUTH_URL =
  "https://auth.openai.com/oauth/authorize";
export const OPENAI_CODEX_OAUTH_TOKEN_URL =
  "https://auth.openai.com/oauth/token";
export const OPENAI_CODEX_OAUTH_REDIRECT_URI =
  "http://localhost:1455/auth/callback";
export const OPENAI_CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex";
export const OPENAI_CODEX_RESPONSES_URL = `${OPENAI_CODEX_BASE_URL}/responses`;
export const OPENAI_CODEX_ORIGINATOR = "codex_cli_rs";
export const OPENAI_CODEX_USER_AGENT = "codex_cli_rs/0.0.0 (Dyad; local OAuth)";
export const OPENAI_CODEX_OAUTH_EXPIRY_WINDOW_MS = 5 * 60 * 1000;

interface OpenAICodexOAuthUrlInput {
  codeChallenge: string;
  state: string;
}

interface OpenAICodexTokenExchangeInput {
  code: string;
  codeVerifier: string;
  fetchFn?: typeof fetch;
}

interface OpenAICodexTokenRefreshInput {
  refreshToken: string;
  fetchFn?: typeof fetch;
}

interface OpenAICodexTokenSuccessResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

export interface OpenAICodexOAuthTokenSet {
  type: "openai-codex";
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  accountId?: string;
  baseUrl: string;
}

export function createOpenAICodexAuthorizationUrl({
  codeChallenge,
  state,
}: OpenAICodexOAuthUrlInput): string {
  const url = new URL(OPENAI_CODEX_OAUTH_AUTH_URL);
  url.searchParams.set("client_id", OPENAI_CODEX_OAUTH_CLIENT_ID);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", OPENAI_CODEX_OAUTH_REDIRECT_URI);
  url.searchParams.set(
    "scope",
    "openid profile email offline_access api.connectors.read api.connectors.invoke",
  );
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  url.searchParams.set("id_token_add_organizations", "true");
  url.searchParams.set("codex_cli_simplified_flow", "true");
  url.searchParams.set("originator", OPENAI_CODEX_ORIGINATOR);
  return url.toString();
}

export async function exchangeOpenAICodexOAuthCode({
  code,
  codeVerifier,
  fetchFn = fetch,
}: OpenAICodexTokenExchangeInput): Promise<OpenAICodexOAuthTokenSet> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: OPENAI_CODEX_OAUTH_CLIENT_ID,
    code,
    redirect_uri: OPENAI_CODEX_OAUTH_REDIRECT_URI,
    code_verifier: codeVerifier,
  });

  return requestOpenAICodexToken({ body, fetchFn });
}

export async function refreshOpenAICodexOAuthToken({
  refreshToken,
  fetchFn = fetch,
}: OpenAICodexTokenRefreshInput): Promise<OpenAICodexOAuthTokenSet> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: OPENAI_CODEX_OAUTH_CLIENT_ID,
    refresh_token: refreshToken,
  });

  return requestOpenAICodexToken({
    body,
    fetchFn,
    previousRefreshToken: refreshToken,
  });
}

export function extractOpenAICodexAccountId(
  accessToken: string,
): string | undefined {
  const [, payload] = accessToken.split(".");
  if (!payload) {
    return undefined;
  }

  try {
    const json = Buffer.from(base64UrlToBase64(payload), "base64").toString(
      "utf-8",
    );
    const claims = JSON.parse(json) as Record<string, unknown>;
    const authClaim = claims["https://api.openai.com/auth"];
    if (typeof authClaim === "object" && authClaim !== null) {
      const accountId = (authClaim as Record<string, unknown>)[
        "chatgpt_account_id"
      ];
      return typeof accountId === "string" && accountId.length > 0
        ? accountId
        : undefined;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

export function isOpenAICodexOAuthTokenExpired(
  expiresAt: number,
  now = Date.now(),
): boolean {
  return expiresAt <= now + OPENAI_CODEX_OAUTH_EXPIRY_WINDOW_MS;
}

export function createOpenAICodexFetch(
  fetchFn: typeof fetch = fetch,
): typeof fetch {
  return async (input, init) => {
    const rewrittenInput = rewriteOpenAICodexResponsesRequest(input);
    const rewrittenInit = normalizeOpenAICodexResponsesRequestInit(
      rewrittenInput,
      init,
    );
    const response = await fetchFn(rewrittenInput, rewrittenInit);
    if (!response.ok) {
      await logOpenAICodexResponseError(response);
    }
    return response;
  };
}

export function normalizeOpenAICodexResponsesRequestInit(
  input: RequestInfo | URL,
  init?: RequestInit,
): RequestInit | undefined {
  const url = getRequestUrl(input);
  if (!url || !url.pathname.includes("/backend-api/codex/responses")) {
    return init;
  }

  return {
    ...init,
    headers: normalizeOpenAICodexHeaders(init?.headers),
    body: normalizeOpenAICodexRequestBody(init?.body),
  };
}

export function rewriteOpenAICodexResponsesRequest(
  input: RequestInfo | URL,
): RequestInfo | URL {
  const url = getRequestUrl(input);
  if (!url) {
    return input;
  }

  if (url.pathname === "/backend-api/codex/v1/responses") {
    url.pathname = "/backend-api/codex/responses";
    return rewriteRequestInput(input, url.toString());
  }

  if (url.pathname === "/v1/responses") {
    return rewriteRequestInput(input, OPENAI_CODEX_RESPONSES_URL);
  }

  return input;
}

async function requestOpenAICodexToken({
  body,
  fetchFn,
  previousRefreshToken,
}: {
  body: URLSearchParams;
  fetchFn: typeof fetch;
  previousRefreshToken?: string;
}): Promise<OpenAICodexOAuthTokenSet> {
  let response: Response;
  try {
    response = await fetchFn(OPENAI_CODEX_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        originator: OPENAI_CODEX_ORIGINATOR,
      },
      body,
    });
  } catch (error) {
    throw new DyadError(
      `Could not reach OpenAI sign-in service: ${formatErrorMessage(error)}`,
      DyadErrorKind.External,
    );
  }

  if (!response.ok) {
    throw await createOpenAICodexTokenError(response);
  }

  const tokenResponse = await parseOpenAICodexTokenResponse(response);
  const refreshToken = tokenResponse.refresh_token ?? previousRefreshToken;

  if (!tokenResponse.access_token || !refreshToken) {
    throw new DyadError(
      "OpenAI sign-in did not return the expected tokens.",
      DyadErrorKind.External,
    );
  }

  return {
    type: "openai-codex",
    accessToken: tokenResponse.access_token,
    refreshToken,
    expiresAt: Date.now() + (tokenResponse.expires_in ?? 3600) * 1000,
    accountId: extractOpenAICodexAccountId(tokenResponse.access_token),
    baseUrl: OPENAI_CODEX_BASE_URL,
  };
}

async function createOpenAICodexTokenError(
  response: Response,
): Promise<DyadError> {
  const message = await readTokenErrorMessage(response);
  const kind =
    response.status >= 400 && response.status < 500
      ? DyadErrorKind.Auth
      : DyadErrorKind.External;

  return new DyadError(
    message
      ? `OpenAI sign-in failed: ${message}`
      : "OpenAI sign-in failed. Please try again.",
    kind,
  );
}

async function parseOpenAICodexTokenResponse(
  response: Response,
): Promise<OpenAICodexTokenSuccessResponse> {
  try {
    const raw =
      (await response.json()) as Partial<OpenAICodexTokenSuccessResponse>;
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
      `OpenAI sign-in returned an invalid response: ${formatErrorMessage(error)}`,
      DyadErrorKind.External,
    );
  }
}

async function readTokenErrorMessage(response: Response): Promise<string> {
  try {
    const raw = (await response.json()) as Record<string, unknown>;
    if (typeof raw.error_description === "string") {
      return raw.error_description;
    }
    if (typeof raw.error === "string") {
      return raw.error;
    }
    if (typeof raw.message === "string") {
      return raw.message;
    }
  } catch {
    return "";
  }

  return "";
}

function base64UrlToBase64(value: string): string {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const paddingLength = (4 - (base64.length % 4)) % 4;
  return `${base64}${"=".repeat(paddingLength)}`;
}

function getRequestUrl(input: RequestInfo | URL): URL | null {
  try {
    if (typeof input === "string") {
      return new URL(input);
    }
    if (input instanceof URL) {
      return new URL(input.toString());
    }
    return new URL(input.url);
  } catch {
    return null;
  }
}

function normalizeOpenAICodexHeaders(headersInit?: HeadersInit): Headers {
  const headers = new Headers(headersInit);
  deleteHeaderVariants(headers, "accept");
  deleteHeaderVariants(headers, "connection");
  deleteHeaderVariants(headers, "user-agent");
  deleteHeaderVariants(headers, "originator");
  deleteHeaderVariants(headers, "session_id");
  deleteHeaderVariants(headers, "conversation_id");
  deleteHeaderVariants(headers, "version");

  headers.set("accept", "text/event-stream");
  headers.set("originator", OPENAI_CODEX_ORIGINATOR);
  headers.set("user-agent", OPENAI_CODEX_USER_AGENT);
  headers.set("version", "");
  headers.set("x-codex-turn-metadata", "");
  headers.set("openai-beta", "responses=experimental");
  return headers;
}

function normalizeOpenAICodexRequestBody(body: BodyInit | null | undefined) {
  if (typeof body !== "string") {
    return body;
  }

  try {
    const request = JSON.parse(body) as Record<string, unknown>;
    request.stream = true;
    request.store = false;
    if (request.instructions == null) {
      request.instructions = "";
    }

    delete request.previous_response_id;
    delete request.prompt_cache_retention;
    delete request.safety_identifier;
    delete request.stream_options;
    delete request.temperature;
    delete request.max_tokens;
    delete request.max_output_tokens;
    delete request.top_p;

    stripOpenAICodexInputItemIds(request);
    return JSON.stringify(request);
  } catch {
    return body;
  }
}

function stripOpenAICodexInputItemIds(request: Record<string, unknown>): void {
  const input = request.input;
  if (!Array.isArray(input)) {
    return;
  }

  request.input = input.map((item) => {
    if (!isRecord(item) || !("id" in item)) {
      return item;
    }
    const { id: _id, ...itemWithoutId } = item;
    return itemWithoutId;
  });
}

async function logOpenAICodexResponseError(response: Response): Promise<void> {
  try {
    const responseBody = await response.clone().text();
    logger.warn("OpenAI Codex request failed", {
      status: response.status,
      statusText: response.statusText,
      body: responseBody.slice(0, 1000),
    });
  } catch {
    logger.warn("OpenAI Codex request failed", {
      status: response.status,
      statusText: response.statusText,
    });
  }
}

function deleteHeaderVariants(headers: Headers, name: string): void {
  const needle = name.toLowerCase();
  for (const key of Array.from(headers.keys())) {
    if (key.toLowerCase() === needle) {
      headers.delete(key);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function rewriteRequestInput(
  input: RequestInfo | URL,
  url: string,
): RequestInfo | URL {
  if (typeof input === "string" || input instanceof URL) {
    return url;
  }

  return new Request(url, input);
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
