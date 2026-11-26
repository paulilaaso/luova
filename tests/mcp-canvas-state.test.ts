import { describe, expect, it, vi } from "vitest";
import {
  acknowledgeActions,
  enqueueAction,
  getPendingActions,
  getRecentActionStatuses,
  isCanvasConnected,
  markBrowserSeen,
  recordActionResults,
} from "@/lib/mcp/canvas-state";

describe("action status tracking", () => {
  it("tracks pending then failed with compiler error", () => {
    enqueueAction({
      id: "test-action-1",
      tool: "add_component",
      componentType: "Card",
      code: "export default () => <div>hi</div>",
    });
    expect(getPendingActions().some((a) => a.id === "test-action-1")).toBe(
      true
    );
    expect(
      getRecentActionStatuses().find((s) => s.id === "test-action-1")?.status
    ).toBe("pending");

    recordActionResults([
      {
        id: "test-action-1",
        tool: "add_component",
        status: "failed",
        error: "SyntaxError: Unexpected token '<' at line 14",
      },
    ]);
    const entry = getRecentActionStatuses().find(
      (s) => s.id === "test-action-1"
    );
    expect(entry?.status).toBe("failed");
    expect(entry?.error).toContain("SyntaxError");

    // Acknowledging drains the pending queue but retains history for agents.
    acknowledgeActions(["test-action-1"]);
    expect(getPendingActions().some((a) => a.id === "test-action-1")).toBe(
      false
    );
    expect(
      getRecentActionStatuses().find((s) => s.id === "test-action-1")?.status
    ).toBe("failed");
  });

  it("tracks applied status", () => {
    enqueueAction({
      id: "test-action-2",
      tool: "update_component_code",
      targetId: "node-1",
      code: "export default () => <div>hi</div>",
    });
    recordActionResults([
      { id: "test-action-2", status: "applied", error: null },
    ]);
    const entry = getRecentActionStatuses().find(
      (s) => s.id === "test-action-2"
    );
    expect(entry?.status).toBe("applied");
    acknowledgeActions(["test-action-1", "test-action-2"]);
  });
});

describe("canvas connection and stale actions", () => {
  it("expires actions the canvas never picked up", () => {
    vi.useFakeTimers();
    try {
      markBrowserSeen();
      expect(isCanvasConnected()).toBe(true);

      enqueueAction({
        id: "stale-1",
        toolCallId: "tc-stale-1",
        tool: "update_theme",
        patch: {},
      } as never);
      vi.advanceTimersByTime(61_000);

      expect(isCanvasConnected()).toBe(false);
      expect(getPendingActions().some((a) => a.id === "stale-1")).toBe(false);
      const entry = getRecentActionStatuses().find((a) => a.id === "stale-1");
      expect(entry?.status).toBe("failed");
      expect(entry?.error).toContain("Expired");
    } finally {
      vi.useRealTimers();
    }
  });
});
