import crypto from "node:crypto";
import { CHATGPT_OPENID_CONFIGURATION } from "@/lib/ai/chatgpt-auth";

const EXPECTED_ISSUER = "https://auth.openai.com";
const CLOCK_SKEW_S = 60;
const CACHE_TTL_MS = 60 * 60 * 1000;

interface Jwk {
  kty: string;
  kid?: string;
  alg?: string;
  [key: string]: unknown;
}

let configCache: { issuer: string; jwksUri: string; fetchedAt: number } | null =
  null;
let jwksCache: { keys: Jwk[]; fetchedAt: number } | null = null;

async function getOpenIdConfig(): Promise<{
  issuer: string;
  jwksUri: string;
}> {
  if (configCache && Date.now() - configCache.fetchedAt < CACHE_TTL_MS) {
    return configCache;
  }
  const res = await fetch(CHATGPT_OPENID_CONFIGURATION);
  if (!res.ok) {
    throw new Error("Failed to fetch OpenID configuration.");
  }
  const doc = (await res.json()) as {
    issuer?: unknown;
    jwks_uri?: unknown;
  };
  if (typeof doc.issuer !== "string" || typeof doc.jwks_uri !== "string") {
    throw new Error("Invalid OpenID configuration.");
  }
  configCache = {
    issuer: doc.issuer,
    jwksUri: doc.jwks_uri,
    fetchedAt: Date.now(),
  };
  return configCache;
}

async function getJwks(): Promise<Jwk[]> {
  if (jwksCache && Date.now() - jwksCache.fetchedAt < CACHE_TTL_MS) {
    return jwksCache.keys;
  }
  const { jwksUri } = await getOpenIdConfig();
  const res = await fetch(jwksUri);
  if (!res.ok) {
    throw new Error("Failed to fetch JWKS.");
  }
  const doc = (await res.json()) as { keys?: unknown };
  if (!Array.isArray(doc.keys)) {
    throw new Error("Invalid JWKS.");
  }
  jwksCache = { keys: doc.keys as Jwk[], fetchedAt: Date.now() };
  return jwksCache.keys;
}

function decodePart(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<
    string,
    unknown
  >;
}

export interface ValidatedChatGptIdentity {
  sub: string;
  email?: string;
}

/**
 * Fully validate the ID token from the SIWC callback:
 * RS256 signature against the published JWKS, issuer, audience
 * (must be this registration's issued client_id), expiration, and —
 * for the authorization-code flow — the OIDC nonce bound to the attempt.
 * Pass `nonce: undefined` to skip the nonce check (refresh-token flow,
 * where no nonce is issued).
 *
 * Throws with a user-safe message on any failure.
 */
export async function verifyChatGptIdToken(
  idToken: string,
  expected: { clientId: string; nonce?: string }
): Promise<ValidatedChatGptIdentity> {
  const parts = idToken.split(".");
  if (parts.length !== 3) {
    throw new Error("Malformed ID token.");
  }
  const [encodedHeader, encodedPayload, encodedSignature] = parts;

  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    header = decodePart(encodedHeader);
    payload = decodePart(encodedPayload);
  } catch {
    throw new Error("Malformed ID token.");
  }

  if (header.alg !== "RS256") {
    throw new Error("Unexpected ID token signing algorithm.");
  }
  if (typeof header.kid !== "string" || !header.kid) {
    throw new Error("ID token is missing a key ID.");
  }

  const keys = await getJwks();
  const jwk = keys.find((k) => k.kid === header.kid && k.kty === "RSA");
  if (!jwk) {
    // Key rotation: drop the cache once and retry before failing.
    jwksCache = null;
    const fresh = await getJwks();
    const retry = fresh.find((k) => k.kid === header.kid && k.kty === "RSA");
    if (!retry) {
      throw new Error("ID token signing key not recognized.");
    }
    return verifyWithKey(
      retry,
      encodedHeader,
      encodedPayload,
      encodedSignature,
      payload,
      expected
    );
  }
  return verifyWithKey(
    jwk,
    encodedHeader,
    encodedPayload,
    encodedSignature,
    payload,
    expected
  );
}

function verifyWithKey(
  jwk: Jwk,
  encodedHeader: string,
  encodedPayload: string,
  encodedSignature: string,
  payload: Record<string, unknown>,
  expected: { clientId: string; nonce?: string }
): ValidatedChatGptIdentity {
  let publicKey: crypto.KeyObject;
  try {
    publicKey = crypto.createPublicKey({
      key: jwk as unknown as JsonWebKey,
      format: "jwk",
    });
  } catch {
    throw new Error("ID token signing key is invalid.");
  }

  const signature = Buffer.from(encodedSignature, "base64url");
  const valid = crypto.verify(
    "RSA-SHA256",
    Buffer.from(`${encodedHeader}.${encodedPayload}`),
    publicKey,
    signature
  );
  if (!valid) {
    throw new Error("ID token signature verification failed.");
  }

  if (payload.iss !== EXPECTED_ISSUER) {
    throw new Error("ID token issuer mismatch.");
  }

  const aud = payload.aud;
  const audOk =
    aud === expected.clientId ||
    (Array.isArray(aud) && aud.includes(expected.clientId));
  if (!audOk) {
    throw new Error("ID token audience mismatch.");
  }

  const nowS = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp + CLOCK_SKEW_S < nowS) {
    throw new Error("ID token has expired.");
  }
  if (typeof payload.iat === "number" && payload.iat - CLOCK_SKEW_S > nowS) {
    throw new Error("ID token was issued in the future.");
  }
  if (expected.nonce !== undefined && payload.nonce !== expected.nonce) {
    throw new Error("ID token nonce mismatch. Please try signing in again.");
  }
  if (typeof payload.sub !== "string" || !payload.sub) {
    throw new Error("ID token is missing a subject.");
  }

  return { sub: payload.sub, email: decodeIdTokenEmailOf(payload) };
}

function decodeIdTokenEmailOf(
  payload: Record<string, unknown>
): string | undefined {
  return typeof payload.email === "string" ? payload.email : undefined;
}
