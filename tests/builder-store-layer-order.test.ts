import { beforeEach, describe, expect, it } from "vitest";
import { useProjectStore as useBuilderStore } from "@/stores/project-store";
import { normalizeLayerOrder } from "@/stores/slices/canvas-hierarchy-slice";

describe("builder-store layer ordering", () => {
  beforeEach(() => {
    useBuilderStore.getState().reset();
    useBuilderStore.setState({
      rootId: "root",
      layerOrder: [],
      nodes: {
        root: {
          id: "root",
          type: "Container",
          props: { x: 0, y: 0, w: 1200, h: 800, positionType: "absolute" },
          code: "",
        },
        a: {
          id: "a",
          type: "Checkbox",
          props: { x: 0, y: 0, w: 450, h: 120 },
          code: "",
        },
        b: {
          id: "b",
          type: "Slider",
          props: { x: 10, y: 10, w: 450, h: 120 },
          code: "",
        },
        c: {
          id: "c",
          type: "Button",
          props: { x: 20, y: 20, w: 450, h: 120 },
          code: "",
        },
      },
    } as unknown as Parameters<typeof useBuilderStore.setState>[0]);
  });

  it("keeps a bounded layer stack when toggling bringToFront many times", () => {
    const store = useBuilderStore.getState();

    for (let i = 0; i < 1000; i += 1) {
      store.bringToFront([i % 2 === 0 ? "a" : "b"]);
    }

    const { layerOrder } = useBuilderStore.getState();
    expect(layerOrder).toHaveLength(3);
    expect(new Set(layerOrder).size).toBe(3);
    expect(layerOrder.at(-1)).toBe("b");
  });

  it("supports explicit bring-to-front and send-to-back", () => {
    const store = useBuilderStore.getState();
    store.bringToFront(["a"]);
    expect(useBuilderStore.getState().layerOrder).toEqual(["b", "c", "a"]);

    store.sendToBack(["a"]);
    expect(useBuilderStore.getState().layerOrder).toEqual(["a", "b", "c"]);

    store.bringToFront(["b", "a"]);
    expect(useBuilderStore.getState().layerOrder).toEqual(["c", "a", "b"]);
  });

  it("normalizes incomplete and duplicate layer arrays for large scenes", () => {
    const nodes = {
      root: useBuilderStore.getState().nodes.root,
      ...Object.fromEntries(
        Array.from({ length: 250 }, (_, index) => {
          const id = `node-${index}`;
          return [
            id,
            {
              id,
              type: "Container",
              props: { x: index, y: index, w: 10, h: 10 },
              code: "",
            },
          ];
        })
      ),
    };

    const rawLayerOrder = [
      "root",
      "missing",
      "node-10",
      "node-4",
      "node-10",
      "node-249",
    ];

    const normalized = normalizeLayerOrder(rawLayerOrder, nodes, "root");

    expect(normalized).toHaveLength(250);
    expect(new Set(normalized).size).toBe(250);
    expect(normalized.slice(0, 3)).toEqual(["node-10", "node-4", "node-249"]);
    expect(normalized).not.toContain("root");
    expect(normalized).not.toContain("missing");
  });

  it("setNodeZIndex reorders layerOrder and syncs props.zIndex on all nodes", () => {
    useBuilderStore.setState({ layerOrder: ["a", "b", "c"] } as any);
    const before = useBuilderStore.getState().pendingVersion;

    (useBuilderStore.getState() as any).setNodeZIndex("a", 3);

    const st = useBuilderStore.getState();
    expect(st.layerOrder).toEqual(["b", "c", "a"]);
    expect((st.nodes.b.props as any).zIndex).toBe(1);
    expect((st.nodes.c.props as any).zIndex).toBe(2);
    expect((st.nodes.a.props as any).zIndex).toBe(3);
    expect(st.pendingVersion).toBeGreaterThan(before);
  });

  it("setNodeZIndex clamps out-of-range values to a valid 1-based range", () => {
    useBuilderStore.setState({ layerOrder: ["a", "b", "c"] } as any);

    (useBuilderStore.getState() as any).setNodeZIndex("c", 99);
    expect(useBuilderStore.getState().layerOrder.at(-1)).toBe("c");

    (useBuilderStore.getState() as any).setNodeZIndex("c", 0);
    expect(useBuilderStore.getState().layerOrder[0]).toBe("c");
    expect((useBuilderStore.getState().nodes.c.props as any).zIndex).toBe(1);
  });

  it("setNodeZIndex ignores unknown or root nodes", () => {
    useBuilderStore.setState({ layerOrder: ["a", "b", "c"] } as any);
    const snapshot = [...useBuilderStore.getState().layerOrder];

    (useBuilderStore.getState() as any).setNodeZIndex("missing", 1);
    (useBuilderStore.getState() as any).setNodeZIndex("root", 1);
    expect(useBuilderStore.getState().layerOrder).toEqual(snapshot);
  });
});
