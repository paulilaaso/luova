import { NextResponse } from "next/server";
import { CHATGPT_OPENID_CONFIGURATION } from "@/lib/ai/chatgpt-auth";
import { forbiddenResponse, isLocalRequest } from "@/lib/local-request";

interface LogoutBody {
  refreshToken?: string;
  clientId?: string;
}

async function discoverRevocationEndpoint(): Promise<string | null> {
  try {
    const res = await fetch(CHATGPT_OPENID_CONFIGURATION);
    if (!res.ok) return null;
    const doc = (await res.json()) as { revocation_endpoint?: unknown };
    return typeof doc.revocation_endpoint === "string"
      ? doc.revocation_endpoint
      : null;
  } catch {
    return null;
  }
}

/**
 * End the renewable session (RFC 7009 revocation) before the client
 * clears its locally stored tokens.
 * POST { refreshToken, clientId }
 */
export async function POST(request: Request) {
  if (!isLocalRequest(request)) return forbiddenResponse();

  let body: LogoutBody;
  try {
    body = (await request.json()) as LogoutBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (body.refreshToken && body.clientId) {
    const endpoint = await discoverRevocationEndpoint();
    if (endpoint) {
      try {
        await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            token: body.refreshToken,
            token_type_hint: "refresh_token",
            client_id: body.clientId,
          }),
        });
      } catch {
        // Revocation is best-effort — still clear local state below.
      }
    }
  }

  return NextResponse.json({ ok: true });
}
