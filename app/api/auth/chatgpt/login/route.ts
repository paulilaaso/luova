import crypto from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import {
  buildCallbackUri,
  CHATGPT_AGENT_NAME,
  CHATGPT_AUTHORIZE_ENDPOINT,
  CHATGPT_DYNAMIC_CLIENT_ID,
  CHATGPT_NONCE_COOKIE,
  CHATGPT_OPENER_ORIGIN_COOKIE,
  CHATGPT_PENDING_CLIENT_COOKIE,
  CHATGPT_PKCE_COOKIE,
  CHATGPT_REDIRECT_COOKIE,
  CHATGPT_RESOURCE,
  CHATGPT_SCOPES,
  CHATGPT_STATE_COOKIE,
  chatGptOpenerOrigin,
  isSecureRequest,
} from "@/lib/ai/chatgpt-auth";

const COOKIE_MAX_AGE = 600; // 10 minutes

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const hostId = params.get("hostId") ?? "";
  const savedClientId = params.get("clientId") ?? "";
  const idTokenHint = params.get("idTokenHint") ?? "";
  const loginHint = params.get("loginHint") ?? "";

  if (!hostId) {
    return NextResponse.json(
      { error: "Missing hostId. Open sign-in from AI Settings." },
      { status: 400 }
    );
  }

  const isReauth =
    savedClientId.length > 0 && savedClientId !== CHATGPT_DYNAMIC_CLIENT_ID;

  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto
    .createHash("sha256")
    .update(verifier)
    .digest("base64url");
  const state = crypto.randomBytes(16).toString("hex");
  const nonce = crypto.randomBytes(16).toString("hex");
  const redirectUri = buildCallbackUri(request.url);
  const clientId = isReauth ? savedClientId : CHATGPT_DYNAMIC_CLIENT_ID;

  const authUrl = new URL(CHATGPT_AUTHORIZE_ENDPOINT);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", CHATGPT_SCOPES);
  authUrl.searchParams.set("resource", CHATGPT_RESOURCE);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("nonce", nonce);
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("ext_agent_host_id", hostId);
  if (!isReauth) {
    // Display metadata for first-time dynamic registration only.
    authUrl.searchParams.set("agent_name_hint", CHATGPT_AGENT_NAME);
  } else {
    // Returning sign-in: skip the account selector when possible.
    if (idTokenHint) authUrl.searchParams.set("id_token_hint", idTokenHint);
    if (loginHint) authUrl.searchParams.set("login_hint", loginHint);
  }

  const secure = isSecureRequest(request.url);
  const cookieInit = {
    httpOnly: true as const,
    path: "/",
    maxAge: COOKIE_MAX_AGE,
    sameSite: "lax" as const,
    secure,
  };

  const res = NextResponse.redirect(authUrl.toString());
  res.cookies.set(
    CHATGPT_OPENER_ORIGIN_COOKIE,
    chatGptOpenerOrigin(request.url, params.get("openerOrigin")),
    cookieInit
  );
  res.cookies.set(CHATGPT_PKCE_COOKIE, verifier, cookieInit);
  res.cookies.set(CHATGPT_STATE_COOKIE, state, cookieInit);
  res.cookies.set(CHATGPT_NONCE_COOKIE, nonce, cookieInit);
  res.cookies.set(CHATGPT_REDIRECT_COOKIE, redirectUri, cookieInit);
  res.cookies.set(CHATGPT_PENDING_CLIENT_COOKIE, clientId, cookieInit);
  return res;
}
