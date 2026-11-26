import { NextResponse } from "next/server";
import {
  CHATGPT_RESOURCE,
  CHATGPT_TOKEN_ENDPOINT,
  decodeIdTokenEmail,
} from "@/lib/ai/chatgpt-auth";
import { verifyChatGptIdToken } from "@/lib/ai/chatgpt-id-token";
import { forbiddenResponse, isLocalRequest } from "@/lib/local-request";

interface RefreshBody {
  refreshToken?: string;
  clientId?: string;
}

/**
 * Exchange a saved refresh token for a fresh access token.
 * POST { refreshToken, clientId } — keeps the refresh_token off the
 * authorization URL and proxies the token endpoint to avoid CORS.
 */
export async function POST(request: Request) {
  if (!isLocalRequest(request)) return forbiddenResponse();

  let body: RefreshBody;
  try {
    body = (await request.json()) as RefreshBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body.refreshToken || !body.clientId) {
    return NextResponse.json(
      { error: "refreshToken and clientId are required." },
      { status: 400 }
    );
  }

  let tokenRes: Response;
  try {
    tokenRes = await fetch(CHATGPT_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: body.clientId,
        refresh_token: body.refreshToken,
        resource: CHATGPT_RESOURCE,
      }),
    });
  } catch {
    return NextResponse.json(
      { error: "Token refresh failed (network error)." },
      { status: 502 }
    );
  }

  if (!tokenRes.ok) {
    const detail = await tokenRes.text().catch(() => "");
    console.error(
      `[chatgpt] Token refresh rejected (${tokenRes.status}): ${detail.slice(0, 500)}`
    );
    return NextResponse.json(
      {
        error: `Token refresh failed (${tokenRes.status}). ${detail.slice(0, 200)}`,
      },
      { status: 401 }
    );
  }

  const tokens = (await tokenRes.json().catch(() => null)) as null | {
    access_token?: string;
    refresh_token?: string;
    id_token?: string;
    expires_in?: number;
    scope?: string;
  };
  if (!tokens?.access_token) {
    return NextResponse.json(
      { error: "Refresh response did not include an access token." },
      { status: 401 }
    );
  }

  // Validate a rotated ID token when one is issued (signature, issuer,
  // audience, expiration; no nonce in the refresh flow). A missing
  // id_token keeps the previously validated identity client-side.
  let userEmail: string | undefined;
  if (tokens.id_token) {
    try {
      const identity = await verifyChatGptIdToken(tokens.id_token, {
        clientId: body.clientId,
      });
      userEmail = identity.email;
    } catch (err) {
      return NextResponse.json(
        {
          error:
            err instanceof Error
              ? `Sign-in validation failed: ${err.message}`
              : "Sign-in validation failed. Please reconnect.",
        },
        { status: 401 }
      );
    }
  }

  return NextResponse.json({
    accessToken: tokens.access_token,
    // Some rotations omit a new refresh token — caller must retain the old one.
    refreshToken: tokens.refresh_token,
    idToken: tokens.id_token,
    expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
    clientId: body.clientId,
    userEmail: userEmail ?? decodeIdTokenEmail(tokens.id_token),
    // Omit scopes when the response carries none so callers retain the
    // previously granted set instead of overwriting it with [].
    ...(tokens.scope
      ? { grantedScopes: tokens.scope.split(" ").filter(Boolean) }
      : {}),
  });
}
