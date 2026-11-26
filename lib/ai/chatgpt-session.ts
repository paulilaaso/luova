"use client";

import { CHATGPT_PLAN_SCOPE } from "@/lib/ai/chatgpt-auth";
import type { ChatGptAuthSession } from "@/stores/ai-settings-store";
import { useAiSettingsStore } from "@/stores/ai-settings-store";

const REFRESH_SKEW_MS = 5 * 60 * 1000;
const SETTINGS_KEY = "ai-settings";
const REFRESH_LOCK = "luova-chatgpt-refresh";

function isFresh(session: ChatGptAuthSession | null | undefined): boolean {
  return Boolean(
    session?.accessToken &&
      (!session.expiresAt || session.expiresAt - Date.now() > REFRESH_SKEW_MS)
  );
}

/** The ChatGPT session another tab may have saved since this tab loaded. */
function readStoredSession(): ChatGptAuthSession | null | undefined {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return undefined;
    return (JSON.parse(raw)?.state?.chatgptAuth ??
      null) as ChatGptAuthSession | null;
  } catch {
    return undefined;
  }
}

/** Adopt a session saved by another tab, so a stale copy is never refreshed. */
function adoptStoredSession(): void {
  const stored = readStoredSession();
  if (stored === undefined) return;
  const current = useAiSettingsStore.getState().chatgptAuth;
  if (
    stored?.refreshToken !== current?.refreshToken ||
    stored?.accessToken !== current?.accessToken
  ) {
    useAiSettingsStore.setState({ chatgptAuth: stored });
  }
}

// Keep every tab's copy current, or a tab holding an old session would write
// an already-used refresh token back to storage on its next settings change.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === SETTINGS_KEY) adoptStoredSession();
  });
}

async function refreshSession(): Promise<string | null> {
  // Another tab may have refreshed while this one waited for the lock.
  adoptStoredSession();
  const session = useAiSettingsStore.getState().chatgptAuth;
  if (isFresh(session)) return session?.accessToken ?? null;
  if (!session?.refreshToken || !session?.clientId) {
    return session?.accessToken ?? null;
  }
  try {
    const res = await fetch("/api/auth/chatgpt/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        refreshToken: session.refreshToken,
        clientId: session.clientId,
      }),
    });
    if (!res.ok) {
      const detail = await res.json().catch(() => null);
      console.error(
        "[chatgpt] Token refresh failed:",
        detail?.error ?? `HTTP ${res.status}`
      );
      return session.accessToken ?? null;
    }
    const refreshed = (await res.json()) as ChatGptAuthSession;
    if (!refreshed.accessToken) return session.accessToken ?? null;
    useAiSettingsStore.getState().setChatGptAuth({
      ...session,
      ...refreshed,
      refreshToken: refreshed.refreshToken ?? session.refreshToken,
    });
    return refreshed.accessToken;
  } catch (err) {
    console.error("[chatgpt] Token refresh failed:", err);
    return session.accessToken ?? null;
  }
}

let inFlight: Promise<string | null> | null = null;

/**
 * Resolve the ChatGPT plan access token for inference.
 * Refreshes server-side via /api/auth/chatgpt/refresh when the token
 * is missing-but-refreshable or expires within 5 minutes.
 * Returns null when the plan is not connected.
 *
 * OpenAI rotates refresh tokens and revokes the whole sign-in when a used
 * one is presented again, so only one refresh may run at a time: callers in
 * this tab share one request, and tabs take turns through a Web Lock.
 */
export async function resolveChatGptAccessToken(): Promise<string | null> {
  const session = useAiSettingsStore.getState().chatgptAuth;
  if (isFresh(session)) return session?.accessToken ?? null;
  if (!inFlight) {
    const locks =
      typeof navigator !== "undefined" ? navigator.locks : undefined;
    const run: Promise<string | null> = locks
      ? // The DOM typings don't unwrap the callback's promise; then() does.
        locks.request(REFRESH_LOCK, refreshSession).then((token) => token)
      : refreshSession();
    inFlight = run.finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

/**
 * Whether the saved session is authorized for plan-backed inference.
 * Identity-only sign-in (without `chatgpt.tokens.use.direct`) must not
 * enable plan usage.
 */
export function hasChatGptPlanUsage(
  session: ChatGptAuthSession | null | undefined
): boolean {
  return Boolean(session?.grantedScopes?.includes(CHATGPT_PLAN_SCOPE));
}

export const CHATGPT_PLAN_SCOPE_RECONNECT_MESSAGE =
  "ChatGPT plan usage is not authorized. Reconnect in AI Settings and approve plan usage.";
