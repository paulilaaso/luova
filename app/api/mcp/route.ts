/**
 * MCP Streamable HTTP endpoint
 *
 * Handles GET (SSE stream) + POST (tool calls) + DELETE (session close)
 * on a single route using the Web Standard transport — no Node http module needed.
 *
 * Requires the per-install token (see lib/mcp/token.ts). Copy the full URL
 * from Luova → AI Settings → MCP:
 *   Type: streamable-http (or mcp)
 *   URL:  http://127.0.0.1:3000/api/mcp?token=<token>
 */

import { randomUUID } from "node:crypto";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { forbiddenResponse, isLocalRequest } from "@/lib/local-request";
import { createMcpServer } from "@/lib/mcp/server";
import { hasValidMcpToken } from "@/lib/mcp/token";

// One transport + server per session, keyed by session ID
const sessions = new Map<
  string,
  { transport: WebStandardStreamableHTTPServerTransport }
>();

async function createSession() {
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (id) => {
      sessions.set(id, { transport });
    },
    onsessionclosed: (id) => {
      sessions.delete(id);
    },
  });

  const server = await createMcpServer();
  server.connect(transport);

  return { transport };
}

function jsonRpcError(status: number, code: number, message: string) {
  return Response.json(
    { jsonrpc: "2.0", error: { code, message }, id: null },
    { status }
  );
}

async function handle(req: Request): Promise<Response> {
  if (!isLocalRequest(req)) return forbiddenResponse();

  // 403 rather than 401: a 401 makes MCP clients start an OAuth flow.
  if (!hasValidMcpToken(req)) {
    return jsonRpcError(
      403,
      -32001,
      "Missing or invalid Luova MCP token. Copy the MCP URL from Luova → AI Settings → MCP."
    );
  }

  const sessionId = req.headers.get("mcp-session-id");
  if (sessionId) {
    const session = sessions.get(sessionId);
    // Unknown session (e.g. Luova restarted): 404 tells the client to
    // re-initialize instead of failing every call.
    if (!session) return jsonRpcError(404, -32001, "Session not found");
    return session.transport.handleRequest(req);
  }

  const { transport } = await createSession();
  return transport.handleRequest(req);
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
