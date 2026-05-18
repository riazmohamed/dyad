import { z } from "zod";
import { createClient, defineContract } from "../contracts/core";

export const ProviderOAuthProviderSchema = z.enum(["anthropic", "openai"]);

const StartProviderOAuthInputSchema = z.object({
  provider: ProviderOAuthProviderSchema,
});

const StartProviderOAuthOutputSchema = z.object({
  authorizationUrl: z.string(),
  sessionId: z.string(),
  provider: ProviderOAuthProviderSchema,
});

const CompleteProviderOAuthInputSchema = z.object({
  provider: ProviderOAuthProviderSchema,
  sessionId: z.string(),
  code: z.string(),
});

const CompleteProviderOAuthOutputSchema = z.object({
  connected: z.literal(true),
  expiresAt: z.number(),
  accountId: z.string().optional(),
});

const LogoutProviderOAuthInputSchema = z.object({
  provider: ProviderOAuthProviderSchema,
});

const GetProviderOAuthStatusInputSchema = z.object({
  provider: ProviderOAuthProviderSchema,
});

const GetProviderOAuthStatusOutputSchema = z.object({
  connected: z.boolean(),
  expiresAt: z.number().optional(),
  accountId: z.string().optional(),
});

export const oauthContracts = {
  startProviderOAuth: defineContract({
    channel: "provider-oauth:start",
    input: StartProviderOAuthInputSchema,
    output: StartProviderOAuthOutputSchema,
  }),
  completeProviderOAuth: defineContract({
    channel: "provider-oauth:complete",
    input: CompleteProviderOAuthInputSchema,
    output: CompleteProviderOAuthOutputSchema,
  }),
  logoutProviderOAuth: defineContract({
    channel: "provider-oauth:logout",
    input: LogoutProviderOAuthInputSchema,
    output: z.void(),
  }),
  getProviderOAuthStatus: defineContract({
    channel: "provider-oauth:status",
    input: GetProviderOAuthStatusInputSchema,
    output: GetProviderOAuthStatusOutputSchema,
  }),
} as const;

export const oauthClient = createClient(oauthContracts);

export type ProviderOAuthProvider = z.infer<typeof ProviderOAuthProviderSchema>;
export type StartProviderOAuthInput = z.infer<
  typeof StartProviderOAuthInputSchema
>;
export type StartProviderOAuthOutput = z.infer<
  typeof StartProviderOAuthOutputSchema
>;
export type CompleteProviderOAuthInput = z.infer<
  typeof CompleteProviderOAuthInputSchema
>;
export type CompleteProviderOAuthOutput = z.infer<
  typeof CompleteProviderOAuthOutputSchema
>;
export type LogoutProviderOAuthInput = z.infer<
  typeof LogoutProviderOAuthInputSchema
>;
export type GetProviderOAuthStatusInput = z.infer<
  typeof GetProviderOAuthStatusInputSchema
>;
export type GetProviderOAuthStatusOutput = z.infer<
  typeof GetProviderOAuthStatusOutputSchema
>;
