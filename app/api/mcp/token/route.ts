import { forbiddenResponse, isLocalRequest } from "@/lib/local-request";
import { getMcpToken } from "@/lib/mcp/token";

export const dynamic = "force-dynamic";

/**
 * Hands the MCP token to the Luova settings dialog so it can show a
 * copy-ready MCP URL. Browsers always send Sec-Fetch-Site; requiring
 * same-origin keeps other pages from reading it.
 */
export async function GET(req: Request) {
  if (
    !isLocalRequest(req) ||
    req.headers.get("sec-fetch-site") !== "same-origin"
  ) {
    return forbiddenResponse();
  }
  return Response.json(
    { token: getMcpToken() },
    { headers: { "Cache-Control": "no-store" } }
  );
}
