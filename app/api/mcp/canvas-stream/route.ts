import type { NextRequest } from "next/server";
import { forbiddenResponse, isLocalRequest } from "@/lib/local-request";
import {
  acknowledgeActions,
  getPendingActions,
  markBrowserSeen,
  recordActionResults,
  setCanvasSnapshot,
} from "@/lib/mcp/canvas-state";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!isLocalRequest(req)) return forbiddenResponse();

  const encoder = new TextEncoder();
  let clientClosed = false;

  req.signal.addEventListener("abort", () => {
    clientClosed = true;
  });

  const stream = new ReadableStream({
    async start(controller) {
      function sendEvent(event: string, data: unknown) {
        if (clientClosed) return;
        const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(payload));
      }

      sendEvent("connected", { status: "ok" });

      // Send each queued action once per connection; the browser acks it
      // after applying. A reconnect gets a fresh set, so nothing is lost.
      const sentActionIds = new Set<string>();

      while (!clientClosed) {
        markBrowserSeen();

        const pending = getPendingActions();
        const pendingIds = new Set(pending.map((action) => action.id));
        for (const id of sentActionIds) {
          if (!pendingIds.has(id)) sentActionIds.delete(id);
        }

        const actions = pending.filter(
          (action) => !sentActionIds.has(action.id)
        );
        if (actions.length > 0) {
          for (const action of actions) sentActionIds.add(action.id);
          sendEvent("actions", actions);
        }

        await new Promise((r) => setTimeout(r, 200));
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

export async function POST(req: NextRequest) {
  if (!isLocalRequest(req)) return forbiddenResponse();

  try {
    const body = await req.json();
    // Browser reporting back compiler/validation outcomes for queued actions.
    // Record statuses BEFORE acknowledging so get_canvas_state.recentActions
    // retains the applied/failed result after the pending queue is drained.
    if (Array.isArray(body.actionResults)) {
      const results = body.actionResults
        .filter(
          (r: unknown): r is Record<string, unknown> =>
            typeof r === "object" && r !== null
        )
        .filter((r: Record<string, unknown>) => typeof r.id === "string")
        .map((r: Record<string, unknown>) => ({
          id: r.id as string,
          status:
            r.status === "failed" ? ("failed" as const) : ("applied" as const),
          error:
            typeof r.error === "string"
              ? r.error
              : r.error == null
                ? null
                : String(r.error),
          ...(typeof r.tool === "string" ? { tool: r.tool } : {}),
        }));
      if (results.length > 0) recordActionResults(results);
    }
    if (Array.isArray(body.ackActionIds)) {
      acknowledgeActions(
        body.ackActionIds.filter(
          (id: unknown): id is string => typeof id === "string"
        )
      );
      return Response.json({ ok: true });
    }

    // actionResults without ackActionIds (e.g. status-only update)
    if (Array.isArray(body.actionResults)) {
      return Response.json({ ok: true });
    }

    setCanvasSnapshot({
      nodes: body.nodes ?? {},
      selectedIds: body.selectedIds ?? [],
      customSystemPrompt:
        typeof body.customSystemPrompt === "string" &&
        body.customSystemPrompt.trim()
          ? body.customSystemPrompt
          : undefined,
    });
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }
}
