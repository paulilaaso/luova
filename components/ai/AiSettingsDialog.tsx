"use client";

import {
  Check,
  Copy,
  LoaderCircle,
  MessageSquare,
  Plug,
  Save,
  Settings,
  X,
} from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/luova-ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuTrigger,
} from "@/components/luova-ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/luova-ui/dialog";
import { Input } from "@/components/luova-ui/input";
import { Label } from "@/components/luova-ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/luova-ui/select";
import { Switch } from "@/components/luova-ui/switch";
import { Textarea } from "@/components/luova-ui/textarea";
import { buildCallbackUri } from "@/lib/ai/chatgpt-auth";
import { hasChatGptPlanUsage } from "@/lib/ai/chatgpt-session";
import {
  type AiProvider,
  type ChatGptAuthSession,
  DEFAULT_MODELS,
  getCustomModelTags,
  MODEL_SUGGESTIONS,
  PROVIDER_LABELS,
  updateCustomModelTags,
  useAiSettingsStore,
} from "@/stores/ai-settings-store";
import { useProjectStore } from "@/stores/project-store";

const PROVIDERS = Object.keys(PROVIDER_LABELS) as AiProvider[];

interface DraftState {
  activeProvider: AiProvider;
  apiKeys: Partial<Record<AiProvider, string>>;
  models: Partial<Record<AiProvider, string>>;
  baseUrls: Partial<Record<AiProvider, string>>;
  customModelTags: Partial<Record<AiProvider, string[]>>;
}

export default function AiSettingsDialog({
  mcpConnected = false,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: {
  mcpConnected?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const setOpen = controlledOnOpenChange ?? setInternalOpen;
  const [copied, setCopied] = useState(false);
  const [mcpUrl, setMcpUrl] = useState<string | null>(null);
  const [apiKeyFocused, setApiKeyFocused] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const authPopup = useRef<Window | null>(null);
  const store = useAiSettingsStore();
  const mcpEnabled = store.mcpEnabled;
  const showMcpConnected = mcpEnabled && mcpConnected;
  const chatgptAuth = store.chatgptAuth;
  // The system prompt is per-project: it lives in the project store and is
  // saved into / restored from the `.luova` file (not the global AI settings).
  // It commits live as you type (like canvas content) so it is never lost when
  // the dialog is dismissed without pressing Save.
  const systemPrompt = useProjectStore((s) => s.systemPrompt);
  const systemPromptEnabled = useProjectStore((s) => s.systemPromptEnabled);
  const setSystemPrompt = useProjectStore((s) => s.setSystemPrompt);
  const setSystemPromptEnabled = useProjectStore(
    (s) => s.setSystemPromptEnabled
  );

  const maskApiKey = (key: string): string => {
    if (!key) return key;
    return "*".repeat(key.length);
  };

  // MCP URL for this server (its real origin and port) with the
  // per-install token, ready to paste into an MCP client.
  useEffect(() => {
    if (!open || !mcpEnabled) return;
    let cancelled = false;
    fetch("/api/mcp/token", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { token?: string } | null) => {
        if (cancelled || !data?.token) return;
        setMcpUrl(`${window.location.origin}/api/mcp?token=${data.token}`);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, mcpEnabled]);

  const handleCopyMcpUrl = () => {
    if (!mcpUrl) return;
    navigator.clipboard.writeText(mcpUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // SIWC popup result: CHATGPT_AUTH_SUCCESS / CHATGPT_AUTH_ERROR
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (
        event.origin !== new URL(buildCallbackUri(window.location.href)).origin
      )
        return;
      if (!authPopup.current || event.source !== authPopup.current) return;
      const data = event.data as
        | { type: "CHATGPT_AUTH_SUCCESS"; tokens?: ChatGptAuthSession }
        | { type: "CHATGPT_AUTH_ERROR"; error?: string }
        | undefined;
      if (!data || typeof data !== "object" || !("type" in data)) return;
      if (data.type === "CHATGPT_AUTH_SUCCESS" && data.tokens?.accessToken) {
        useAiSettingsStore.getState().setChatGptAuth({ ...data.tokens });
        setAuthError(null);
        authPopup.current = null;
        setAuthBusy(false);
      } else if (data.type === "CHATGPT_AUTH_ERROR") {
        setAuthError(data.error || "Sign-in failed. Please try again.");
        authPopup.current = null;
        setAuthBusy(false);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // A closed or interrupted popup does not send an OAuth result. Release the
  // button in those cases as well, and never carry a pending state into a
  // reopened Settings dialog.
  useEffect(() => {
    if (!authBusy) return;
    if (!open || !authPopup.current) {
      setAuthBusy(false);
      return;
    }
    const startedAt = Date.now();
    let closedAt: number | null = null;
    const timer = window.setInterval(() => {
      if (authPopup.current?.closed) {
        // Give the callback's queued postMessage time to arrive after close().
        closedAt ??= Date.now();
        if (Date.now() - closedAt >= 1000) {
          authPopup.current = null;
          setAuthBusy(false);
          setAuthError("Sign-in window closed. Please try again.");
        }
      } else if (Date.now() - startedAt >= 10 * 60 * 1000) {
        authPopup.current = null;
        setAuthBusy(false);
        setAuthError("Sign-in timed out. Please try again.");
      }
    }, 500);
    return () => window.clearInterval(timer);
  }, [authBusy, open]);

  // Proactively refresh an expiring access token while the dialog is open.
  useEffect(() => {
    if (!open) return;
    const session = useAiSettingsStore.getState().chatgptAuth;
    if (!session?.refreshToken || !session?.clientId || !session?.expiresAt)
      return;
    if (session.expiresAt - Date.now() > 5 * 60 * 1000) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/chatgpt/refresh", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            refreshToken: session.refreshToken,
            clientId: session.clientId,
          }),
        });
        if (!res.ok) return;
        const refreshed = (await res.json()) as ChatGptAuthSession;
        if (cancelled) return;
        useAiSettingsStore.getState().setChatGptAuth({
          ...session,
          ...refreshed,
          refreshToken: refreshed.refreshToken ?? session.refreshToken,
        });
      } catch {
        // Best-effort: keep the existing session; chat will surface 401s.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const handleChatGptConnect = () => {
    setAuthError(null);
    const s = useAiSettingsStore.getState();
    // Keep OAuth cookies on the same host as the required loopback callback.
    const url = new URL(
      "/api/auth/chatgpt/login",
      buildCallbackUri(window.location.href)
    );
    url.searchParams.set("openerOrigin", window.location.origin);
    url.searchParams.set("hostId", s.chatgptHostId);
    const clientId = s.chatgptAuth?.clientId ?? s.chatgptRegistration?.clientId;
    if (clientId) url.searchParams.set("clientId", clientId);
    if (s.chatgptAuth?.idToken)
      url.searchParams.set("idTokenHint", s.chatgptAuth.idToken);
    const userEmail =
      s.chatgptAuth?.userEmail ?? s.chatgptRegistration?.userEmail;
    if (userEmail) url.searchParams.set("loginHint", userEmail);
    try {
      const popup = window.open(
        url.toString(),
        "chatgpt-auth",
        "width=600,height=750"
      );
      if (!popup) {
        setAuthBusy(false);
        setAuthError("Popup was blocked. Allow popups and try again.");
        return;
      }
      authPopup.current = popup;
      setAuthBusy(true);
    } catch {
      setAuthBusy(false);
      setAuthError("Could not open sign-in. Please try again.");
    }
  };

  const handleChatGptCancel = () => {
    try {
      authPopup.current?.close();
    } catch {
      // The browser may have severed access to the popup.
    }
    authPopup.current = null;
    setAuthBusy(false);
    setAuthError(null);
  };

  const handleChatGptDisconnect = async () => {
    const s = useAiSettingsStore.getState();
    try {
      await fetch("/api/auth/chatgpt/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          refreshToken: s.chatgptAuth?.refreshToken,
          clientId: s.chatgptAuth?.clientId,
        }),
      });
    } catch {
      // Best-effort revocation — always clear local state.
    }
    s.setChatGptAuth(null);
  };

  // Local draft — only committed on Save
  const [draft, setDraft] = useState<DraftState>({
    activeProvider: store.activeProvider,
    apiKeys: { ...store.apiKeys },
    models: { ...store.models },
    baseUrls: { ...store.baseUrls },
    customModelTags: { ...store.customModelTags },
  });

  // Reset draft to current store values whenever dialog opens
  useEffect(() => {
    if (open) {
      setDraft({
        activeProvider: store.activeProvider,
        apiKeys: { ...store.apiKeys },
        models: { ...store.models },
        baseUrls: { ...store.baseUrls },
        customModelTags: { ...store.customModelTags },
      });
    }
  }, [
    open,
    store.activeProvider,
    store.apiKeys,
    store.models,
    store.baseUrls,
    store.customModelTags,
  ]);

  const currentModel =
    draft.models[draft.activeProvider] ?? DEFAULT_MODELS[draft.activeProvider];

  const setDraftProvider = (p: AiProvider) =>
    setDraft((d) => ({ ...d, activeProvider: p }));

  const setDraftKey = (key: string) =>
    setDraft((d) => ({
      ...d,
      apiKeys: { ...d.apiKeys, [d.activeProvider]: key },
    }));

  const setDraftModel = (model: string) =>
    setDraft((d) => ({
      ...d,
      models: { ...d.models, [d.activeProvider]: model },
    }));

  const setDraftBaseUrl = (url: string) =>
    setDraft((d) => ({
      ...d,
      baseUrls: { ...d.baseUrls, [d.activeProvider]: url },
    }));

  const getDraftBaseUrl = () => draft.baseUrls[draft.activeProvider] ?? "";

  const getDraftCustomModelTags = () =>
    getCustomModelTags(draft.customModelTags, draft.activeProvider);

  const addDraftCustomModelTag = (model: string) => {
    if (!model.trim()) return;
    setDraft((d) => {
      const existing = getCustomModelTags(d.customModelTags, d.activeProvider);
      if (existing.includes(model)) return d;
      return {
        ...d,
        customModelTags: updateCustomModelTags(
          d.customModelTags,
          d.activeProvider,
          [...existing, model]
        ),
      };
    });
  };

  const removeDraftCustomModelTag = (model: string) => {
    setDraft((d) => {
      const existing = getCustomModelTags(d.customModelTags, d.activeProvider);
      return {
        ...d,
        customModelTags: updateCustomModelTags(
          d.customModelTags,
          d.activeProvider,
          existing.filter((m) => m !== model)
        ),
      };
    });
  };

  const handleSave = () => {
    store.setActiveProvider(draft.activeProvider);
    for (const p of PROVIDERS) {
      if (draft.apiKeys[p] !== undefined) store.setApiKey(p, draft.apiKeys[p]!);
      if (draft.models[p]) store.setModel(p, draft.models[p]!);
      if (draft.baseUrls[p]) store.setBaseUrl(p, draft.baseUrls[p]!);
      store.setCustomModelTags(p, draft.customModelTags[p] ?? []);
    }
    setOpen(false);
  };

  const handleCancel = () => setOpen(false);

  const suggestions = MODEL_SUGGESTIONS[draft.activeProvider] ?? [];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <ContextMenu>
        <ContextMenuTrigger
          render={
            <DialogTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="relative h-8 w-8 shrink-0 text-foreground"
                  aria-label="AI Settings"
                >
                  <Settings className="h-4 w-4" />
                  {showMcpConnected && (
                    <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-green-500" />
                  )}
                </Button>
              }
            />
          }
        />
        <ContextMenuContent className="w-48">
          <ContextMenuGroup>
            <ContextMenuLabel>AI Provider</ContextMenuLabel>
            <ContextMenuRadioGroup
              value={store.activeProvider}
              onValueChange={(value) =>
                store.setActiveProvider(value as AiProvider)
              }
            >
              {PROVIDERS.map((p) => (
                <ContextMenuRadioItem key={p} value={p}>
                  {PROVIDER_LABELS[p]}
                </ContextMenuRadioItem>
              ))}
            </ContextMenuRadioGroup>
          </ContextMenuGroup>
        </ContextMenuContent>
      </ContextMenu>
      <DialogContent className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>

        <div className="min-h-0 space-y-5 overflow-y-auto py-1 pr-1">
          {/* Provider */}
          <div className="space-y-1.5">
            <Label htmlFor="provider-select">Provider</Label>
            <Select
              value={draft.activeProvider}
              onValueChange={(v) => setDraftProvider(v as AiProvider)}
            >
              <SelectTrigger id="provider-select">
                <SelectValue>
                  {PROVIDER_LABELS[draft.activeProvider]}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {PROVIDERS.map((p) => (
                  <SelectItem key={p} value={p}>
                    {PROVIDER_LABELS[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {draft.activeProvider === "chatgpt" && (
            <div className="space-y-3">
              {chatgptAuth?.accessToken ? (
                <div className="space-y-3 rounded-xl border bg-muted/20 p-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-full border bg-background">
                      <Image
                        src="/icons/chatgpt.svg"
                        alt=""
                        width={24}
                        height={24}
                        className="invert dark:invert-0"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 text-sm font-medium">
                        ChatGPT
                        {hasChatGptPlanUsage(chatgptAuth) && (
                          <Check
                            className="size-3.5 text-emerald-600 dark:text-emerald-400"
                            aria-label="Connected"
                          />
                        )}
                      </p>
                      <p
                        className="truncate text-xs text-muted-foreground"
                        title={chatgptAuth.userEmail}
                      >
                        {chatgptAuth.userEmail || "Connected account"}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleChatGptDisconnect}
                    >
                      Disconnect
                    </Button>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t pt-3 text-xs">
                    <span className="text-muted-foreground">
                      {hasChatGptPlanUsage(chatgptAuth)
                        ? "ChatGPT plan enabled"
                        : "Plan access needs approval"}
                    </span>
                    <button
                      type="button"
                      onClick={handleChatGptConnect}
                      disabled={authBusy}
                      className="font-medium text-foreground hover:underline underline-offset-4 disabled:opacity-50"
                    >
                      {authBusy
                        ? "Connecting…"
                        : hasChatGptPlanUsage(chatgptAuth)
                          ? "Switch account"
                          : "Approve access"}
                    </button>
                    {hasChatGptPlanUsage(chatgptAuth) && (
                      <a
                        href="https://chatgpt.com/settings/usage"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-foreground hover:underline underline-offset-4"
                      >
                        Manage usage
                      </a>
                    )}
                  </div>
                </div>
              ) : (
                <Button
                  type="button"
                  className="h-11 w-full gap-3 rounded-full border-black bg-black px-5 text-sm font-medium text-white hover:bg-black/85 dark:border-white dark:bg-white dark:text-black dark:hover:bg-white/90"
                  onClick={handleChatGptConnect}
                  disabled={authBusy}
                  aria-busy={authBusy}
                >
                  {authBusy ? (
                    <LoaderCircle className="size-5 animate-spin" />
                  ) : (
                    <Image
                      src="/icons/chatgpt.svg"
                      alt=""
                      width={21}
                      height={21}
                      className="shrink-0 dark:invert"
                    />
                  )}
                  {authBusy ? "Waiting for ChatGPT…" : "Continue with ChatGPT"}
                </Button>
              )}
              {authBusy && (
                <button
                  type="button"
                  onClick={handleChatGptCancel}
                  className="block mx-auto text-xs text-muted-foreground hover:text-foreground hover:underline underline-offset-4"
                >
                  Cancel sign-in
                </button>
              )}
              {authError && (
                <p role="alert" className="text-xs text-destructive">
                  {authError}
                </p>
              )}
            </div>
          )}

          {/* Model */}
          <div className="space-y-1.5">
            <Label htmlFor="model-input">Model</Label>
            <div className="relative">
              <Input
                id="model-input"
                placeholder={DEFAULT_MODELS[draft.activeProvider]}
                value={currentModel}
                onChange={(e) => setDraftModel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && currentModel.trim()) {
                    e.preventDefault();
                    addDraftCustomModelTag(currentModel.trim());
                  }
                }}
                autoComplete="off"
                className="font-mono text-sm pr-10"
              />
              <button
                type="button"
                onClick={() => addDraftCustomModelTag(currentModel.trim())}
                disabled={
                  !currentModel.trim() ||
                  getDraftCustomModelTags().includes(currentModel.trim())
                }
                className="absolute right-1 top-1/2 -translate-y-1/2 p-3 text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label="Save model as tag"
              >
                <Save className="h-4 w-4" />
              </button>
            </div>
            <div className="flex flex-wrap gap-1 pt-0.5">
              {getDraftCustomModelTags().map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => setDraftModel(tag)}
                  className="inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 font-mono text-[length:calc(0.6875rem*var(--font-scale,1))] text-foreground bg-muted/50 hover:bg-muted hover:text-foreground transition-colors"
                >
                  {tag}
                  {/* biome-ignore lint/a11y/noStaticElementInteractions: remove button inside button avoids nested <button> */}
                  {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: span inside button, role="button" would be redundant */}
                  {/* biome-ignore lint/a11y/useKeyWithClickEvents: span inside button, keyboard handled by parent */}
                  <span
                    className="ml-0.5 hover:text-destructive cursor-pointer inline-flex items-center"
                    aria-label={`Remove ${tag}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      removeDraftCustomModelTag(tag);
                    }}
                  >
                    <X className="h-3 w-3" />
                  </span>
                </button>
              ))}
              {suggestions
                .filter((s) => s && !getDraftCustomModelTags().includes(s))
                .map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setDraftModel(s)}
                    className="rounded border px-1.5 py-0.5 font-mono text-[length:calc(0.6875rem*var(--font-scale,1))] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  >
                    {s}
                  </button>
                ))}
            </div>
          </div>

          {/* API Key - not shown for chatgpt (OAuth); optional for local */}
          {draft.activeProvider !== "chatgpt" && (
            <div className="space-y-1.5">
              <Label htmlFor="api-key-input">API Key</Label>
              <Input
                id="api-key-input"
                type="text"
                placeholder={
                  draft.activeProvider === "local"
                    ? "Leave empty if not required"
                    : "Enter your API key"
                }
                value={
                  apiKeyFocused
                    ? (draft.apiKeys[draft.activeProvider] ?? "")
                    : maskApiKey(draft.apiKeys[draft.activeProvider] ?? "")
                }
                onChange={(e) => setDraftKey(e.target.value)}
                onFocus={() => setApiKeyFocused(true)}
                onBlur={() => setApiKeyFocused(false)}
                autoComplete="off"
              />
            </div>
          )}

          {/* Base URL - only for local provider */}
          {draft.activeProvider === "local" && (
            <div className="space-y-1.5">
              <Label htmlFor="base-url-input">
                Base URL
                <span className="ml-1 text-xs text-muted-foreground">
                  (e.g., http://localhost:1234/v1)
                </span>
              </Label>
              <Input
                id="base-url-input"
                placeholder="http://localhost:1234/v1"
                value={getDraftBaseUrl()}
                onChange={(e) => setDraftBaseUrl(e.target.value)}
                autoComplete="off"
              />
            </div>
          )}

          {/* System Prompt — per-project, saved into the .luova file */}
          <div className="space-y-3 rounded-xl border bg-muted/20 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
                <Label
                  htmlFor="system-prompt-toggle"
                  className="cursor-pointer"
                >
                  System Prompt
                </Label>
              </div>
              <Switch
                id="system-prompt-toggle"
                checked={systemPromptEnabled}
                onCheckedChange={setSystemPromptEnabled}
              />
            </div>

            {systemPromptEnabled && (
              <>
                <Textarea
                  id="system-prompt-input"
                  placeholder="Additional instructions injected into every Create prompt…"
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  rows={4}
                  className="font-mono text-xs resize-none max-h-64 overflow-y-auto"
                />
                <p className="text-[length:calc(0.6875rem*var(--font-scale,1))] text-muted-foreground">
                  Extra instructions for AI generation. Saved with this project.
                </p>
              </>
            )}
          </div>

          {/* MCP */}
          <div className="space-y-3 rounded-xl border bg-muted/20 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Plug className="h-3.5 w-3.5 text-muted-foreground" />
                <Label htmlFor="mcp-toggle" className="cursor-pointer">
                  Model Context Protocol (MCP)
                </Label>
              </div>
              <Switch
                id="mcp-toggle"
                checked={mcpEnabled}
                onCheckedChange={(v) => store.setMcpEnabled(v)}
              />
            </div>

            {mcpEnabled && (
              <div className="space-y-2 pt-1">
                <div className="flex items-center gap-1.5">
                  <code className="flex-1 rounded bg-muted px-2 py-1 font-mono text-xs truncate">
                    {mcpUrl
                      ? mcpUrl.replace(/token=.*$/, "token=••••••••")
                      : "Loading…"}
                  </code>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    onClick={handleCopyMcpUrl}
                    disabled={!mcpUrl}
                    aria-label="Copy MCP URL"
                  >
                    {copied ? (
                      <Check className="h-3.5 w-3.5 text-green-500" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
                <p className="text-[length:calc(0.6875rem*var(--font-scale,1))] text-muted-foreground">
                  Paste this URL into your MCP client.
                </p>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
