import { describe, expect, it } from "vitest";
import {
  buildMcpCanvasPayload,
  type McpSnapshotLike,
  resolveMcpEffectiveTargetId,
} from "@/lib/mcp/canvas-payload";

function bakeSnapshot(): McpSnapshotLike {
  return {
    selectedIds: ["btnR", "btnL", "in2", "in1"],
    nodes: {
      root: { id: "root", type: "Container", props: { x: 0, y: 0 } },
      in1: {
        id: "in1",
        type: "Input",
        kind: "generated",
        props: { x: 20, y: 100, w: 360, h: 48 },
        code: "in1",
      },
      in2: {
        id: "in2",
        type: "Input",
        kind: "generated",
        props: { x: 20, y: 160, w: 360, h: 48 },
        code: "in2",
      },
      btnL: {
        id: "btnL",
        type: "Button",
        kind: "generated",
        props: { x: 20, y: 300, w: 170, h: 48 },
        code: "btnL",
      },
      btnR: {
        id: "btnR",
        type: "Button",
        kind: "generated",
        props: { x: 210, y: 300, w: 170, h: 48 },
        code: "btnR",
      },
    },
  };
}

describe("buildMcpCanvasPayload", () => {
  it("sorts selection into spatial reading order, ignoring click order", () => {
    const payload = buildMcpCanvasPayload(bakeSnapshot());
    expect(payload.selectedIds).toEqual(["in1", "in2", "btnL", "btnR"]);
    expect(payload.selectedNodes.map((n) => n.id)).toEqual([
      "in1",
      "in2",
      "btnL",
      "btnR",
    ]);
  });

  it("enriches nested wireframes with topology + spatial pre-sorting", () => {
    const snapshot: McpSnapshotLike = {
      selectedIds: ["card"],
      nodes: {
        root: { id: "root", type: "Container", props: { x: 0, y: 0 } },
        card: {
          id: "card",
          type: "Container",
          kind: "wireframe",
          props: { x: 0, y: 0, w: 400, h: 400 },
          comment: "login",
          children: ["email", "password"],
        },
        email: {
          id: "email",
          type: "Input",
          kind: "wireframe",
          parentId: "card",
          props: { x: 20, y: 330, w: 360, h: 48 },
          comment: "email",
        },
        password: {
          id: "password",
          type: "Input",
          kind: "wireframe",
          parentId: "card",
          props: { x: 20, y: 120, w: 360, h: 48 },
          comment: "password",
        },
      },
    };
    const payload = buildMcpCanvasPayload(snapshot);
    expect(payload.nodeIntents).toHaveLength(1);
    const [card] = payload.nodeIntents!;
    // Draw order was email-first; spatial order is password-first.
    expect(card.nestedChildren!.map((c) => c.id)).toEqual([
      "password",
      "email",
    ]);
    expect(card.nestedChildren![0].widthPct).toBe(90);
    expect(card.comment).toMatch(/Layout structure:/);
    expect(card.comment).toMatch(/h:\w+ \/ v:\w+/);
  });
});

describe("node intent selection scoping", () => {
  function twoGroups(): McpSnapshotLike {
    return {
      selectedIds: ["a1"],
      nodes: {
        root: { id: "root", type: "Container", props: { x: 0, y: 0 } },
        a1: {
          id: "a1",
          type: "Container",
          kind: "wireframe",
          props: { x: 0, y: 0, w: 400, h: 400 },
          comment: "selected group",
          children: ["a1child"],
        },
        a1child: {
          id: "a1child",
          type: "Input",
          kind: "wireframe",
          parentId: "a1",
          props: { x: 20, y: 20, w: 360, h: 48 },
        },
        b1: {
          id: "b1",
          type: "Container",
          kind: "wireframe",
          props: { x: 900, y: 900, w: 400, h: 400 },
          comment: "inert group",
        },
      },
    };
  }

  it("marks only the selected wireframe group as armed", () => {
    const payload = buildMcpCanvasPayload(twoGroups());
    expect(payload.nodeIntents).toHaveLength(2);
    const byId = Object.fromEntries(payload.nodeIntents!.map((n) => [n.id, n]));
    expect(byId.a1.selected).toBe(true);
    expect(byId.b1.selected).toBe(false);
  });

  it("selecting a nested child arms its root container", () => {
    const snapshot = twoGroups();
    snapshot.selectedIds = ["a1child"];
    const payload = buildMcpCanvasPayload(snapshot);
    const byId = Object.fromEntries(payload.nodeIntents!.map((n) => [n.id, n]));
    expect(byId.a1.selected).toBe(true);
    expect(byId.b1.selected).toBe(false);
  });

  it("marks everything unselected when nothing is selected", () => {
    const snapshot = twoGroups();
    snapshot.selectedIds = [];
    const payload = buildMcpCanvasPayload(snapshot);
    for (const intent of payload.nodeIntents!) {
      expect(intent.selected).toBe(false);
    }
  });
});

describe("resolveMcpEffectiveTargetId", () => {
  it("falls back to the top-left selection, not click-order-first", () => {
    const { effectiveTargetId } = resolveMcpEffectiveTargetId(bakeSnapshot());
    expect(effectiveTargetId).toBe("in1");
  });

  it("respects an explicit targetId", () => {
    const { effectiveTargetId } = resolveMcpEffectiveTargetId(
      bakeSnapshot(),
      "btnR"
    );
    expect(effectiveTargetId).toBe("btnR");
  });

  it("remaps captured overlays to their source component", () => {
    const snapshot = bakeSnapshot();
    snapshot.nodes.cap = {
      id: "cap",
      type: "Container",
      kind: "captured",
      props: { x: 0, y: 0, w: 10, h: 10 },
      capturedMetadata: { sourceComponentId: "in1" },
    };
    const { effectiveTargetId } = resolveMcpEffectiveTargetId(
      { ...snapshot, selectedIds: ["cap"] },
      "cap"
    );
    expect(effectiveTargetId).toBe("in1");
  });
});
