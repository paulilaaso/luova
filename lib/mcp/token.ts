/**
 * Per-install MCP token. Created on first use and kept in
 * `.luova/mcp-token` (gitignored) so it survives restarts. MCP clients send
 * it as `Authorization: Bearer <token>` or as `?token=` on the URL (for
 * clients that only take a URL).
 */

import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const TOKEN_DIR = join(process.cwd(), ".luova");
const TOKEN_FILE = join(TOKEN_DIR, "mcp-token");

let cachedToken: string | null = null;

function readTokenFile(): string | null {
  try {
    return readFileSync(TOKEN_FILE, "utf-8").trim() || null;
  } catch {
    return null;
  }
}

export function getMcpToken(): string {
  if (cachedToken) return cachedToken;
  const existing = readTokenFile();
  if (existing) {
    cachedToken = existing;
    return existing;
  }
  const token = randomBytes(32).toString("base64url");
  mkdirSync(TOKEN_DIR, { recursive: true });
  try {
    // "wx": never overwrite a token another process created first.
    writeFileSync(TOKEN_FILE, `${token}\n`, { mode: 0o600, flag: "wx" });
    cachedToken = token;
  } catch {
    cachedToken = readTokenFile() ?? token;
  }
  return cachedToken;
}

function requestToken(request: Request): string | null {
  const auth = request.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return new URL(request.url).searchParams.get("token");
}

export function hasValidMcpToken(request: Request): boolean {
  const candidate = requestToken(request);
  if (!candidate) return false;
  const expected = Buffer.from(getMcpToken());
  const actual = Buffer.from(candidate);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
