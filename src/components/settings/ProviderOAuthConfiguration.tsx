import { useEffect, useState } from "react";
import {
  CheckCircle2,
  ExternalLink,
  KeyRound,
  Loader2,
  LogIn,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ipc, type ProviderOAuthProvider } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";

interface ProviderOAuthConfigurationProps {
  provider: ProviderOAuthProvider;
  providerDisplayName: string;
}

interface StartedOAuthSession {
  sessionId: string;
  authorizationUrl: string;
}

interface ProviderOAuthCopy {
  buttonLabel: string;
  connectedTitle: string;
  instructions: string;
  warning?: string;
}

export function ProviderOAuthConfiguration({
  provider,
  providerDisplayName,
}: ProviderOAuthConfigurationProps) {
  const queryClient = useQueryClient();
  const [startedSession, setStartedSession] =
    useState<StartedOAuthSession | null>(null);
  const [authorizationInput, setAuthorizationInput] = useState("");
  const [inlineError, setInlineError] = useState<string | null>(null);

  const statusQuery = useQuery({
    queryKey: queryKeys.languageModels.oauthStatus({ providerId: provider }),
    queryFn: () => ipc.oauth.getProviderOAuthStatus({ provider }),
    refetchInterval: startedSession ? 1500 : false,
  });

  const startMutation = useMutation({
    mutationFn: () => ipc.oauth.startProviderOAuth({ provider }),
    onSuccess: (result) => {
      setInlineError(null);
      setAuthorizationInput("");
      setStartedSession({
        sessionId: result.sessionId,
        authorizationUrl: result.authorizationUrl,
      });
    },
    onError: (error) => setInlineError(formatErrorMessage(error)),
  });

  const completeMutation = useMutation({
    mutationFn: (code: string) => {
      if (!startedSession) {
        throw new Error("Start sign in before completing it.");
      }
      return ipc.oauth.completeProviderOAuth({
        provider,
        sessionId: startedSession.sessionId,
        code,
      });
    },
    onSuccess: async () => {
      setInlineError(null);
      setStartedSession(null);
      setAuthorizationInput("");
      await invalidateOAuthQueries(queryClient, provider);
    },
    onError: (error) => setInlineError(formatErrorMessage(error)),
  });

  const logoutMutation = useMutation({
    mutationFn: () => ipc.oauth.logoutProviderOAuth({ provider }),
    onSuccess: async () => {
      setInlineError(null);
      setStartedSession(null);
      setAuthorizationInput("");
      await invalidateOAuthQueries(queryClient, provider);
    },
    onError: (error) => setInlineError(formatErrorMessage(error)),
  });

  const providerCopy = getProviderCopy(provider);
  const status = statusQuery.data;
  const isConnected = status?.connected === true;
  const isBusy =
    startMutation.isPending ||
    completeMutation.isPending ||
    logoutMutation.isPending ||
    statusQuery.isLoading;
  const displayedError =
    inlineError || (statusQuery.error ? statusQuery.error.message : null);

  useEffect(() => {
    if (status?.connected) {
      setStartedSession(null);
      setAuthorizationInput("");
      setInlineError(null);
    }
  }, [status?.connected]);

  const handleComplete = () => {
    const trimmedInput = authorizationInput.trim();
    if (!trimmedInput) {
      setInlineError("Paste the callback URL or authorization code first.");
      return;
    }
    completeMutation.mutate(trimmedInput);
  };

  return (
    <Accordion
      multiple
      className="w-full space-y-4 mt-4"
      defaultValue={["subscription-oauth"]}
    >
      <AccordionItem
        value="subscription-oauth"
        className="border rounded-lg px-4 bg-(--background-lightest)"
      >
        <AccordionTrigger className="text-lg font-medium hover:no-underline cursor-pointer">
          Subscription sign-in
        </AccordionTrigger>
        <AccordionContent className="pt-4 space-y-4">
          <Alert variant="default">
            <KeyRound className="h-4 w-4" />
            <AlertTitle>Advanced local sign-in option</AlertTitle>
            <AlertDescription>
              <p>
                API keys are still the official and recommended way to connect{" "}
                {providerDisplayName}. Subscription sign-in is an advanced local
                option for users who want to use their own account in this app.
              </p>
            </AlertDescription>
          </Alert>

          {providerCopy.warning && (
            <Alert variant="default" className="border-yellow-300">
              <ShieldAlert className="h-4 w-4" />
              <AlertTitle>Provider policy note</AlertTitle>
              <AlertDescription>{providerCopy.warning}</AlertDescription>
            </Alert>
          )}

          {displayedError && (
            <Alert variant="destructive">
              <AlertTitle>Sign-in error</AlertTitle>
              <AlertDescription>{displayedError}</AlertDescription>
            </Alert>
          )}

          {isConnected ? (
            <ConnectedOAuthState
              title={providerCopy.connectedTitle}
              expiresAt={status.expiresAt}
              accountId={status.accountId}
              isBusy={isBusy}
              onLogout={() => logoutMutation.mutate()}
            />
          ) : startedSession ? (
            <StartedOAuthState
              instructions={providerCopy.instructions}
              authorizationUrl={startedSession.authorizationUrl}
              authorizationInput={authorizationInput}
              isBusy={isBusy}
              onAuthorizationInputChange={(value) => {
                setInlineError(null);
                setAuthorizationInput(value);
              }}
              onComplete={handleComplete}
              onRefreshStatus={() => statusQuery.refetch()}
            />
          ) : (
            <Button
              type="button"
              onClick={() => startMutation.mutate()}
              disabled={isBusy}
              className="flex items-center gap-2"
            >
              <LogIn className="h-4 w-4" />
              {startMutation.isPending
                ? "Opening browser..."
                : providerCopy.buttonLabel}
            </Button>
          )}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

function ConnectedOAuthState({
  title,
  expiresAt,
  accountId,
  isBusy,
  onLogout,
}: {
  title: string;
  expiresAt?: number;
  accountId?: string;
  isBusy: boolean;
  onLogout: () => void;
}) {
  return (
    <Alert variant="default">
      <KeyRound className="h-4 w-4" />
      <AlertTitle className="flex justify-between items-center gap-3">
        <span>{title}</span>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          onClick={onLogout}
          disabled={isBusy}
          className="flex items-center gap-1 h-7 px-2"
        >
          <Trash2 className="h-4 w-4" />
          {isBusy ? "Disconnecting..." : "Disconnect"}
        </Button>
      </AlertTitle>
      <AlertDescription>
        {expiresAt && <p>Expires {new Date(expiresAt).toLocaleString()}.</p>}
        {accountId && <p>Account ID: {accountId}</p>}
      </AlertDescription>
    </Alert>
  );
}

function StartedOAuthState({
  instructions,
  authorizationUrl,
  authorizationInput,
  isBusy,
  onAuthorizationInputChange,
  onComplete,
  onRefreshStatus,
}: {
  instructions: string;
  authorizationUrl: string;
  authorizationInput: string;
  isBusy: boolean;
  onAuthorizationInputChange: (value: string) => void;
  onComplete: () => void;
  onRefreshStatus: () => void;
}) {
  return (
    <div className="space-y-3">
      <Alert variant="default" className="border-blue-200">
        <Loader2 className="h-4 w-4 animate-spin" />
        <AlertTitle>Waiting for browser sign-in</AlertTitle>
        <AlertDescription>
          Dyad is checking for the completed sign-in. If your browser already
          says “Sign-in complete”, the status should update in a few seconds.
        </AlertDescription>
      </Alert>
      <p className="text-sm text-muted-foreground">{instructions}</p>
      <Button
        as="a"
        href={authorizationUrl}
        target="_blank"
        rel="noreferrer"
        variant="outline"
        size="sm"
        className="flex items-center gap-2 w-fit"
      >
        <ExternalLink className="h-4 w-4" />
        Open sign-in link again
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onRefreshStatus}
        disabled={isBusy}
        className="flex items-center gap-2 w-fit"
      >
        <CheckCircle2 className="h-4 w-4" />I see “Sign-in complete” in the
        browser
      </Button>
      <div className="space-y-2">
        <label
          htmlFor="provider-oauth-code"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300"
        >
          Callback URL or authorization code
        </label>
        <div className="flex items-start gap-2">
          <Input
            id="provider-oauth-code"
            value={authorizationInput}
            onChange={(event) => onAuthorizationInputChange(event.target.value)}
            placeholder="Paste the callback URL or code here"
            className="flex-grow"
          />
          <Button
            type="button"
            onClick={onComplete}
            disabled={isBusy || !authorizationInput.trim()}
          >
            {isBusy ? "Completing..." : "Complete sign in"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function getProviderCopy(provider: ProviderOAuthProvider): ProviderOAuthCopy {
  if (provider === "anthropic") {
    return {
      buttonLabel: "Connect Claude subscription",
      connectedTitle: "Claude subscription connected",
      instructions:
        "Finish the Claude sign-in in your browser, then paste the callback URL or code here.",
      warning:
        "Anthropic may require approval for subscription login in third-party apps. If this does not work, use an Anthropic API key instead.",
    };
  }

  return {
    buttonLabel: "Connect ChatGPT/Codex subscription",
    connectedTitle: "ChatGPT/Codex subscription connected",
    instructions:
      "Finish the ChatGPT/Codex sign-in in your browser. Dyad will complete automatically when the browser reaches localhost; use the field below only if the browser shows a callback URL or code instead.",
  };
}

async function invalidateOAuthQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  provider: ProviderOAuthProvider,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: queryKeys.languageModels.oauthStatus({ providerId: provider }),
    }),
    queryClient.invalidateQueries({ queryKey: queryKeys.settings.user }),
  ]);
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
