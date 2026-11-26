import { type NextRequest, NextResponse } from "next/server";
import {
  CHATGPT_DYNAMIC_CLIENT_ID,
  CHATGPT_NONCE_COOKIE,
  CHATGPT_OPENER_ORIGIN_COOKIE,
  CHATGPT_PENDING_CLIENT_COOKIE,
  CHATGPT_PKCE_COOKIE,
  CHATGPT_REDIRECT_COOKIE,
  CHATGPT_RESOURCE,
  CHATGPT_STATE_COOKIE,
  CHATGPT_TOKEN_ENDPOINT,
  chatGptOpenerOrigin,
} from "@/lib/ai/chatgpt-auth";
import { verifyChatGptIdToken } from "@/lib/ai/chatgpt-id-token";

function postMessagePage(
  request: NextRequest,
  payload: Record<string, unknown>
): NextResponse {
  const targetOrigin = JSON.stringify(
    chatGptOpenerOrigin(
      request.url,
      request.cookies.get(CHATGPT_OPENER_ORIGIN_COOKIE)?.value
    )
  );
  const json = JSON.stringify(payload).replace(/</g, "\\u003c");
  const html = `<!doctype html><html><body><script>
(function () {
  try {
    window.opener.postMessage(${json}, ${targetOrigin});
  } catch (e) { /* popup opener already gone */ }
  window.close();
})();
</script><p style="font-family:sans-serif;font-size:14px">You can close this window.</p></body></html>`;
  const res = new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
  // Single-use OAuth cookies: clear them now that the attempt completed.
  for (const name of [
    CHATGPT_OPENER_ORIGIN_COOKIE,
    CHATGPT_PKCE_COOKIE,
    CHATGPT_STATE_COOKIE,
    CHATGPT_NONCE_COOKIE,
    CHATGPT_REDIRECT_COOKIE,
    CHATGPT_PENDING_CLIENT_COOKIE,
  ]) {
    res.cookies.set(name, "", { path: "/", maxAge: 0 });
  }
  return res;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const code = params.get("code") ?? "";
  const state = params.get("state") ?? "";
  const error = params.get("error") ?? "";
  const errorDescription = params.get("error_description") ?? "";
  const callbackClientId = params.get("client_id") ?? "";
  const callbackScope = params.get("scope") ?? "";

  if (error) {
    return postMessagePage(request, {
      type: "CHATGPT_AUTH_ERROR",
      error: errorDescription || error,
    });
  }

  const verifier = request.cookies.get(CHATGPT_PKCE_COOKIE)?.value ?? "";
  const savedState = request.cookies.get(CHATGPT_STATE_COOKIE)?.value ?? "";
  const savedNonce = request.cookies.get(CHATGPT_NONCE_COOKIE)?.value ?? "";
  const redirectUri = request.cookies.get(CHATGPT_REDIRECT_COOKIE)?.value ?? "";
  const pendingClientId =
    request.cookies.get(CHATGPT_PENDING_CLIENT_COOKIE)?.value ??
    CHATGPT_DYNAMIC_CLIENT_ID;

  if (
    !code ||
    !state ||
    !verifier ||
    !savedState ||
    !savedNonce ||
    !redirectUri
  ) {
    return postMessagePage(request, {
      type: "CHATGPT_AUTH_ERROR",
      error:
        "Sign-in session expired or cookies were blocked. Please try again.",
    });
  }

  if (state !== savedState) {
    return postMessagePage(request, {
      type: "CHATGPT_AUTH_ERROR",
      error: "State mismatch. Please try signing in again.",
    });
  }

  // Resolve the client_id for the token exchange.
  // New registration: callback supplies the issued client_id.
  // Reauthorization: callback may omit it — keep the pending issued ID.
  // A *different* issued ID must be rejected, not silently swapped.
  let clientId = pendingClientId;
  const pendingIsDynamic = pendingClientId === CHATGPT_DYNAMIC_CLIENT_ID;
  if (callbackClientId) {
    if (!pendingIsDynamic && callbackClientId !== pendingClientId) {
      return postMessagePage(request, {
        type: "CHATGPT_AUTH_ERROR",
        error: "Client mismatch during sign-in. Please try again.",
      });
    }
    clientId = callbackClientId;
  }
  if (!clientId || clientId === CHATGPT_DYNAMIC_CLIENT_ID) {
    return postMessagePage(request, {
      type: "CHATGPT_AUTH_ERROR",
      error: "Registration did not return a client ID. Please try again.",
    });
  }

  let tokenRes: Response;
  try {
    tokenRes = await fetch(CHATGPT_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        code,
        code_verifier: verifier,
        redirect_uri: redirectUri,
        resource: CHATGPT_RESOURCE,
      }),
    });
  } catch {
    return postMessagePage(request, {
      type: "CHATGPT_AUTH_ERROR",
      error: "Token exchange failed (network error). Please try again.",
    });
  }

  if (!tokenRes.ok) {
    const detail = await tokenRes.text().catch(() => "");
    return postMessagePage(request, {
      type: "CHATGPT_AUTH_ERROR",
      error: `Token exchange failed (${tokenRes.status}). ${detail.slice(0, 200)}`,
    });
  }

  const tokens = (await tokenRes.json().catch(() => null)) as null | {
    access_token?: string;
    refresh_token?: string;
    id_token?: string;
    expires_in?: number;
    scope?: string;
  };
  if (!tokens?.access_token || !tokens?.id_token) {
    return postMessagePage(request, {
      type: "CHATGPT_AUTH_ERROR",
      error: "Token response did not include an access token.",
    });
  }

  // Full ID-token validation: RS256 signature (JWKS), issuer, audience
  // (this registration's issued client_id), expiration, and nonce.
  let userEmail: string | undefined;
  try {
    const identity = await verifyChatGptIdToken(tokens.id_token, {
      clientId,
      nonce: savedNonce,
    });
    userEmail = identity.email;
  } catch (err) {
    return postMessagePage(request, {
      type: "CHATGPT_AUTH_ERROR",
      error:
        err instanceof Error
          ? `Sign-in validation failed: ${err.message}`
          : "Sign-in validation failed. Please try again.",
    });
  }

  const grantedScopes = (tokens.scope ?? callbackScope ?? "")
    .split(" ")
    .map((s) => s.trim())
    .filter(Boolean);

  return postMessagePage(request, {
    type: "CHATGPT_AUTH_SUCCESS",
    tokens: {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      idToken: tokens.id_token,
      expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
      clientId,
      userEmail,
      grantedScopes,
    },
  });
}
