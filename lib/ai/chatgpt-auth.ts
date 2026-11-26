/**
 * Shared constants + helpers for Sign in with ChatGPT (SIWC) token-sharing flow.
 *
 * Spec: https://developers.openai.com/siwc/token-sharing-open-source
 * - Dynamic registration entrypoint client_id = `dynamic_agent_client`
 * - Loopback redirect on 127.0.0.1 (never `localhost`)
 * - resource = https://api.openai.com/v1
 * - Scopes: openid profile email offline_access resource.invoke chatgpt.tokens.use.direct
 */

export const CHATGPT_AUTHORIZE_ENDPOINT =
  "https://auth.openai.com/api/accounts/authorize";
export const CHATGPT_TOKEN_ENDPOINT =
  "https://auth.openai.com/api/accounts/oauth/token";
export const CHATGPT_OPENID_CONFIGURATION =
  "https://auth.openai.com/.well-known/openid-configuration";
export const CHATGPT_RESOURCE = "https://api.openai.com/v1";
export const CHATGPT_DYNAMIC_CLIENT_ID = "dynamic_agent_client";
export const CHATGPT_AGENT_NAME = "Luova";
/** Scope that authorizes plan-backed inference; must be granted + enforced. */
export const CHATGPT_PLAN_SCOPE = "chatgpt.tokens.use.direct";
export const CHATGPT_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "resource.invoke",
  "chatgpt.tokens.use.direct",
].join(" ");

export const CHATGPT_PKCE_COOKIE = "chatgpt_pkce_verifier";
export const CHATGPT_STATE_COOKIE = "chatgpt_oauth_state";
export const CHATGPT_NONCE_COOKIE = "chatgpt_oauth_nonce";
export const CHATGPT_REDIRECT_COOKIE = "chatgpt_redirect_uri";
export const CHATGPT_OPENER_ORIGIN_COOKIE = "chatgpt_opener_origin";
export const CHATGPT_PENDING_CLIENT_COOKIE = "chatgpt_pending_client_id";

/** Derive a loopback redirect_uri for this host (127.0.0.1, same port). */
export function buildCallbackUri(requestUrl: string): string {
  const url = new URL(requestUrl);
  // OpenAI requires an HTTP loopback callback on 127.0.0.1 — `localhost`
  // is explicitly rejected. Next dev binds to 127.0.0.1 (see package.json).
  const host = url.host.replace("localhost", "127.0.0.1");
  return `${url.protocol}//${host}/api/auth/chatgpt/callback`;
}

/** Only permit the initiating app origin or its equivalent loopback hostname. */
export function chatGptOpenerOrigin(
  requestUrl: string,
  candidate?: string | null
): string {
  const request = new URL(requestUrl);
  if (!candidate) return request.origin;
  try {
    const opener = new URL(candidate);
    const loopback = new Set(["localhost", "127.0.0.1"]);
    if (
      opener.origin === request.origin ||
      (loopback.has(request.hostname) &&
        loopback.has(opener.hostname) &&
        opener.protocol === request.protocol &&
        opener.port === request.port)
    )
      return opener.origin;
  } catch {
    // An invalid origin must never become a postMessage destination.
  }
  return request.origin;
}

export function isSecureRequest(requestUrl: string): boolean {
  return new URL(requestUrl).protocol === "https:";
}

/** Minimal JWT payload decode (no signature verification). */
export function decodeIdTokenEmail(idToken?: string): string | undefined {
  if (!idToken) return undefined;
  const parts = idToken.split(".");
  if (parts.length < 2) return undefined;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8")
    ) as { email?: unknown };
    return typeof payload.email === "string" ? payload.email : undefined;
  } catch {
    return undefined;
  }
}
