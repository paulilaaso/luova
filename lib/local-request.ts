/**
 * Guard for Luova's API routes. The server binds to 127.0.0.1, so the only
 * callers are the Luova page itself and local tools (MCP agents). Browsers
 * on other sites can still reach loopback, so reject:
 * - a Host that isn't a loopback name (DNS rebinding), and
 * - an Origin other than this page — including other apps on other
 *   localhost ports.
 * Non-browser clients send no Origin and pass.
 */

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export function isLocalRequest(request: Request): boolean {
  const hostHeader = request.headers.get("host") ?? new URL(request.url).host;
  const host = parseUrl(`http://${hostHeader}`);
  if (!host || !LOOPBACK_HOSTNAMES.has(host.hostname)) return false;

  const originHeader = request.headers.get("origin");
  if (!originHeader) return true;
  const origin = parseUrl(originHeader);
  return (
    origin !== null &&
    (origin.protocol === "http:" || origin.protocol === "https:") &&
    LOOPBACK_HOSTNAMES.has(origin.hostname) &&
    origin.port === host.port
  );
}

export function forbiddenResponse(): Response {
  return new Response(
    "Forbidden: Luova only accepts requests from its own page and local tools.",
    { status: 403 }
  );
}
