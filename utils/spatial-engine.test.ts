import { describe, expect, it } from "vitest";
import {
  analyzeSpatialTopology,
  type BoundingRect,
  checkOverlap,
  findFreeSpace,
  sortByReadingOrder,
  sortIdsByReadingOrder,
} from "@/utils/spatial-engine";

describe("checkOverlap", () => {
  it("returns true for overlapping rects", () => {
    const a: BoundingRect = { x: 0, y: 0, w: 50, h: 50 };
    const b: BoundingRect = { x: 25, y: 25, w: 50, h: 50 };
    expect(checkOverlap(a, b, 0)).toBe(true);
  });

  it("returns false for non-overlapping rects", () => {
    const a: BoundingRect = { x: 0, y: 0, w: 50, h: 50 };
    const b: BoundingRect = { x: 100, y: 100, w: 50, h: 50 };
    expect(checkOverlap(a, b, 0)).toBe(false);
  });

  it("respects padding parameter", () => {
    const a: BoundingRect = { x: 0, y: 0, w: 50, h: 50 };
    const b: BoundingRect = { x: 60, y: 60, w: 50, h: 50 };
    expect(checkOverlap(a, b, 0)).toBe(false);
    expect(checkOverlap(a, b, 20)).toBe(true);
  });
});

describe("findFreeSpace", () => {
  it("returns start position when no existing nodes", () => {
    const result = findFreeSpace([], 100, 100, 200, 200, {
      gridSize: 16,
      snapToGrid: true,
    });
    expect(result.x).toBe(208);
    expect(result.y).toBe(208);
  });

  it("finds a free position when start is blocked", () => {
    const nodes: BoundingRect[] = [{ x: 200, y: 200, w: 100, h: 100 }];
    const result = findFreeSpace(nodes, 100, 100, 200, 200, {
      gridSize: 16,
      snapToGrid: true,
    });
    const candidate: BoundingRect = {
      x: result.x,
      y: result.y,
      w: 100,
      h: 100,
    };
    const hasOverlap = nodes.some((n) => checkOverlap(candidate, n));
    expect(hasOverlap).toBe(false);
  });

  it("falls back to stacking below nodes when no free space in rings", () => {
    const nodes: BoundingRect[] = Array.from({ length: 20 }, (_, i) => ({
      x: i * 120,
      y: 0,
      w: 100,
      h: 100,
    }));
    const result = findFreeSpace(nodes, 100, 100, 0, 0, {
      gridSize: 16,
      snapToGrid: true,
    });
    expect(result.y).toBeGreaterThanOrEqual(120);
  });

  it("works without grid snapping", () => {
    const nodes: BoundingRect[] = [{ x: 200, y: 200, w: 100, h: 100 }];
    const result = findFreeSpace(nodes, 100, 100, 200, 200, {
      gridSize: 16,
      snapToGrid: false,
    });
    const candidate: BoundingRect = {
      x: result.x,
      y: result.y,
      w: 100,
      h: 100,
    };
    const hasOverlap = nodes.some((n) => checkOverlap(candidate, n));
    expect(hasOverlap).toBe(false);
  });
});

describe("analyzeSpatialTopology", () => {
  it("detects asymmetrical two-column layout with proportional shares", () => {
    const parent: BoundingRect = { x: 0, y: 0, w: 800, h: 600 };
    const children: BoundingRect[] = [
      { x: 0, y: 0, w: 200, h: 600 }, // 25% sidebar
      { x: 200, y: 0, w: 600, h: 600 }, // 75% content
    ];
    const result = analyzeSpatialTopology(parent, children);
    expect(result.flow).toBe("row");
    expect(result.asymmetric).toBe(true);
    expect(result.children[0].widthPct).toBe(25);
    expect(result.children[1].widthPct).toBe(75);
    expect(result.children[0].hAnchor).toBe("start");
    expect(result.children[1].hAnchor).toBe("end");
    expect(result.description).toMatch(/column/i);
  });

  it("resolves alignment anchors for offset children", () => {
    const parent: BoundingRect = { x: 100, y: 100, w: 400, h: 400 };
    const children: BoundingRect[] = [
      { x: 380, y: 110, w: 100, h: 40 }, // top-right badge
      { x: 230, y: 420, w: 140, h: 44 }, // bottom-centered button
    ];
    const result = analyzeSpatialTopology(parent, children);
    // Top-right badge pinned to the end edge
    expect(result.children[0].hAnchor).toBe("end");
    expect(result.children[0].vAnchor).toBe("start");
    // Bottom-centered button centered horizontally, pinned to bottom
    expect(result.children[1].hAnchor).toBe("center");
    expect(result.children[1].vAnchor).toBe("end");
  });

  it("detects vertical stacks with varying heights", () => {
    const parent: BoundingRect = { x: 0, y: 0, w: 400, h: 600 };
    const children: BoundingRect[] = [
      { x: 20, y: 10, w: 360, h: 48 },
      { x: 20, y: 70, w: 360, h: 200 },
      { x: 20, y: 280, w: 360, h: 44 },
    ];
    const result = analyzeSpatialTopology(parent, children);
    expect(result.flow).toBe("column");
    expect(result.children.every((c) => c.flowRole === "row-item")).toBe(true);
    // Varying heights flag asymmetry
    expect(result.asymmetric).toBe(true);
  });

  it("snaps centered elements with hand jitter to center (no invented offsets)", () => {
    const parent: BoundingRect = { x: 0, y: 0, w: 800, h: 600 };
    // Perfectly centered 400px child starts at x=200 / y=250; jitter ±30px
    // is sloppy drawing, not intent.
    const jittered: BoundingRect[] = [{ x: 170, y: 240, w: 400, h: 100 }];
    const snapped = analyzeSpatialTopology(parent, jittered);
    expect(snapped.children[0].hAnchor).toBe("center");
    expect(snapped.children[0].vAnchor).toBe("center");
    expect(snapped.children[0].isOffset).toBe(false);

    // Clearly deliberate placement far from center is still preserved.
    const deliberate: BoundingRect[] = [{ x: 0, y: 250, w: 400, h: 100 }];
    const kept = analyzeSpatialTopology(parent, deliberate);
    expect(kept.children[0].hAnchor).toBe("start");
    expect(kept.children[0].isOffset).toBe(true);
  });

  it("does not flag symmetric equal columns as asymmetric", () => {
    const parent: BoundingRect = { x: 0, y: 0, w: 800, h: 600 };
    const children: BoundingRect[] = [
      { x: 0, y: 0, w: 400, h: 600 },
      { x: 400, y: 0, w: 400, h: 600 },
    ];
    const result = analyzeSpatialTopology(parent, children);
    expect(result.flow).toBe("row");
    expect(result.asymmetric).toBe(false);
  });

  it("marks column-stack sequence on the vertical axis only", () => {
    // Five uniform centered children: horizontal anchors must ALL be center
    // (uniform siblings), while vertical anchors record top-to-bottom order.
    const parent: BoundingRect = { x: 0, y: 0, w: 400, h: 400 };
    const children: BoundingRect[] = [20, 100, 180, 260, 330].map((y) => ({
      x: 112,
      y,
      w: 176,
      h: 32,
    }));
    const result = analyzeSpatialTopology(parent, children);
    expect(result.flow).toBe("column");
    expect(result.children.map((c) => c.hAnchor)).toEqual([
      "center",
      "center",
      "center",
      "center",
      "center",
    ]);
    expect(result.children[0].vAnchor).toBe("start");
    expect(result.children[result.children.length - 1].vAnchor).toBe("end");
  });

  it("marks row sequence on the horizontal axis only", () => {
    const parent: BoundingRect = { x: 0, y: 0, w: 800, h: 200 };
    const children: BoundingRect[] = [
      { x: 0, y: 50, w: 200, h: 100 },
      { x: 300, y: 50, w: 200, h: 100 },
      { x: 600, y: 50, w: 200, h: 100 },
    ];
    const result = analyzeSpatialTopology(parent, children);
    expect(result.flow).toBe("row");
    expect(result.children.map((c) => c.vAnchor)).toEqual([
      "center",
      "center",
      "center",
    ]);
    expect(result.children[0].hAnchor).toBe("start");
    expect(result.children[result.children.length - 1].hAnchor).toBe("end");
  });
});

describe("sortByReadingOrder", () => {
  it("orders stacked items top-to-bottom regardless of input order", () => {
    const bottom = { x: 20, y: 200, w: 360, h: 48, id: "bottom" };
    const top = { x: 20, y: 100, w: 360, h: 48, id: "top" };
    const sorted = sortByReadingOrder([bottom, top]);
    expect(sorted.map((c) => c.id)).toEqual(["top", "bottom"]);
  });

  it("keeps side-by-side left-to-right despite y jitter", () => {
    const right = { x: 410, y: 4, w: 390, h: 100, id: "right" };
    const left = { x: 0, y: 0, w: 390, h: 100, id: "left" };
    const sorted = sortByReadingOrder([right, left]);
    expect(sorted.map((c) => c.id)).toEqual(["left", "right"]);
  });
});

describe("sortIdsByReadingOrder", () => {
  it("orders ids spatially regardless of click order", () => {
    const rects: Record<string, BoundingRect> = {
      btnR: { x: 220, y: 300, w: 180, h: 48 },
      input1: { x: 20, y: 100, w: 360, h: 48 },
      btnL: { x: 20, y: 300, w: 180, h: 48 },
      input2: { x: 20, y: 160, w: 360, h: 48 },
    };
    // Click order: buttons first, then inputs — layout must ignore it.
    const sorted = sortIdsByReadingOrder(
      ["btnR", "btnL", "input2", "input1"],
      (id) => rects[id]
    );
    expect(sorted).toEqual(["input1", "input2", "btnL", "btnR"]);
  });

  it("appends ids without rects in original relative order", () => {
    const rects: Record<string, BoundingRect> = {
      b: { x: 0, y: 200, w: 100, h: 40 },
      a: { x: 0, y: 100, w: 100, h: 40 },
    };
    expect(
      sortIdsByReadingOrder(["b", "ghost", "a"], (id) => rects[id])
    ).toEqual(["a", "b", "ghost"]);
  });
});
