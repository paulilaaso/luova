import type { AiPendingAction } from "@/types/ai";
import type { ComponentNodeAny } from "@/types/builder";

export interface CanvasSnapshot {
  nodes: Record<string, ComponentNodeAny>;
  selectedIds: string[];
  customSystemPrompt?: string;
}

export interface ActionStatusEntry {
  id: string;
  tool: string;
  status: "pending" | "applied" | "failed";
  error?: string | null;
  timestamp: number;
}

const MAX_ACTION_HISTORY = 20;
/** Queued actions the canvas hasn't picked up by then are dropped as failed. */
const PENDING_ACTION_TTL_MS = 60_000;
/**
 * The browser's canvas-stream loop checks in every 200 ms. Longer silence
 * (beyond an EventSource reconnect) means no canvas is connected.
 */
const BROWSER_STALE_MS = 5_000;

interface CanvasStateStore {
  snapshot: CanvasSnapshot | null;
  pendingActions: AiPendingAction[];
  pendingSince: Map<string, number>;
  actionHistory: Map<string, ActionStatusEntry>;
  lastBrowserSeenAt: number;
}

// Kept on globalThis so a dev-mode module reload can't split the state
// between the MCP route and the canvas-stream route.
const globalForCanvas = globalThis as typeof globalThis & {
  __luovaCanvasState?: CanvasStateStore;
};
if (!globalForCanvas.__luovaCanvasState) {
  globalForCanvas.__luovaCanvasState = {
    snapshot: null,
    pendingActions: [],
    pendingSince: new Map(),
    actionHistory: new Map(),
    lastBrowserSeenAt: 0,
  };
}
const canvasState: CanvasStateStore = globalForCanvas.__luovaCanvasState;

export function setCanvasSnapshot(snapshot: CanvasSnapshot) {
  canvasState.snapshot = snapshot;
}

export function getCanvasSnapshot(): CanvasSnapshot | null {
  return canvasState.snapshot;
}

export function markBrowserSeen() {
  canvasState.lastBrowserSeenAt = Date.now();
}

/** True while a Luova tab with MCP enabled is connected to canvas-stream. */
export function isCanvasConnected(): boolean {
  return Date.now() - canvasState.lastBrowserSeenAt < BROWSER_STALE_MS;
}

export function enqueueAction(action: AiPendingAction) {
  canvasState.pendingActions.push(action);
  canvasState.pendingSince.set(action.id, Date.now());
  canvasState.actionHistory.set(action.id, {
    id: action.id,
    tool: action.tool,
    status: "pending",
    error: null,
    timestamp: Date.now(),
  });
  pruneActionHistory();
}

function pruneActionHistory() {
  while (canvasState.actionHistory.size > MAX_ACTION_HISTORY) {
    const oldestKey = canvasState.actionHistory.keys().next().value;
    if (oldestKey === undefined) break;
    canvasState.actionHistory.delete(oldestKey);
  }
}

export function recordActionResults(
  results: Array<{
    id: string;
    status: "applied" | "failed";
    error?: string | null;
    tool?: string;
  }>
) {
  for (const result of results) {
    const existing = canvasState.actionHistory.get(result.id);
    canvasState.actionHistory.set(result.id, {
      id: result.id,
      tool: result.tool ?? existing?.tool ?? "unknown",
      status: result.status,
      error: result.error ?? null,
      timestamp: Date.now(),
    });
  }
  pruneActionHistory();
}

export function getRecentActionStatuses(
  limit = MAX_ACTION_HISTORY
): ActionStatusEntry[] {
  return [...canvasState.actionHistory.values()]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);
}

/**
 * Drop actions that waited longer than the TTL, so a canvas that connects
 * later never receives a burst of stale edits.
 */
function expireStaleActions() {
  const cutoff = Date.now() - PENDING_ACTION_TTL_MS;
  const expired = canvasState.pendingActions.filter(
    (action) => (canvasState.pendingSince.get(action.id) ?? 0) < cutoff
  );
  if (expired.length === 0) return;
  acknowledgeActions(expired.map((action) => action.id));
  recordActionResults(
    expired.map((action) => ({
      id: action.id,
      tool: action.tool,
      status: "failed" as const,
      error:
        "Expired: the Luova canvas did not pick up this action within 60 seconds.",
    }))
  );
}

export function getPendingActions(): AiPendingAction[] {
  expireStaleActions();
  return [...canvasState.pendingActions];
}

export function acknowledgeActions(actionIds: string[]) {
  const acknowledged = new Set(actionIds);
  canvasState.pendingActions = canvasState.pendingActions.filter(
    (action) => !acknowledged.has(action.id)
  );
  for (const id of acknowledged) canvasState.pendingSince.delete(id);
}
