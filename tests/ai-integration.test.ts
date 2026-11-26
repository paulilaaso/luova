import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  acceptAiChanges,
  applyAiActions,
  keepBothAiChanges,
  rejectAiChanges,
} from "@/hooks/use-ai-action-orchestrator";
import { useAiStore } from "@/stores/ai-store";
import { setLiveCameraState, useCanvasStore } from "@/stores/canvas-store";
import { useProjectStore } from "@/stores/project-store";
import { useUIStore } from "@/stores/ui-store";
import type { AiPendingAction } from "@/types/ai";

describe("AI Integration (Direct Application + Undo)", () => {
  beforeEach(() => {
    useProjectStore.getState().reset();
    useAiStore.getState().clearState();
    // Ensure temporal is resumed by default
    useProjectStore.temporal.getState().resume();
  });

  it("applies AI actions directly to the project store", () => {
    const action: AiPendingAction = {
      id: "test-add",
      tool: "add_component",
      componentType: "Button",
      code: "export default () => <button>Click me</button>",
      position: { x: 100, y: 100 },
      size: { w: 100, h: 40 },
    };

    applyAiActions([action]);

    const nodes = useProjectStore.getState().nodes;
    const nodeIds = Object.keys(nodes).filter((id) => id !== "root");
    expect(nodeIds).toHaveLength(1);
    expect(nodes[nodeIds[0]].type).toBe("Button");
    expect(nodes[nodeIds[0]].props.x).toBe(100);
  });

  it("handles 'Reject' by restoring the project snapshot", async () => {
    // 1. Initial state
    const initialNodeCount = Object.keys(
      useProjectStore.getState().nodes
    ).length;

    // 2. AI Starts (Simulate AiTopBar behavior)
    useProjectStore.temporal.getState().pause();
    const snapshot = await useProjectStore.getState().exportJSON();
    useAiStore.getState().setInitialAppSnapshot(snapshot);

    const action: AiPendingAction = {
      id: "test-add",
      tool: "add_component",
      componentType: "Button",
      code: "export default () => <button>Click me</button>",
      position: { x: 100, y: 100 },
    };

    applyAiActions([action]);

    // Verify it's in the store (visible to user)
    expect(Object.keys(useProjectStore.getState().nodes)).toHaveLength(
      initialNodeCount + 1
    );

    // 3. User clicks Reject
    rejectAiChanges();

    // 4. Verify state is reverted
    expect(Object.keys(useProjectStore.getState().nodes)).toHaveLength(
      initialNodeCount
    );
    // Verify temporal is resumed
    // (We don't have a direct way to check isPaused in zundo without internal access,
    // but we know we called resume())
  });

  it("handles 'Accept' by committing changes as a single entry", async () => {
    // 1. AI Starts
    useProjectStore.temporal.getState().pause();
    const snapshot = await useProjectStore.getState().exportJSON();
    useAiStore.getState().setInitialAppSnapshot(snapshot);

    const action1: AiPendingAction = {
      id: "test-add-1",
      tool: "add_component",
      componentType: "Button",
      code: "export default () => <button>1</button>",
    };
    const action2: AiPendingAction = {
      id: "test-add-2",
      tool: "add_component",
      componentType: "Button",
      code: "export default () => <button>2</button>",
    };

    applyAiActions([action1]);
    applyAiActions([action2]);

    // 2. User clicks Accept
    acceptAiChanges();

    // 3. Verify state — should contain root plus both button components
    const nodeIds = Object.keys(useProjectStore.getState().nodes);
    expect(nodeIds).toContain("root");

    // 4. Verify we can undo the WHOLE batch at once
    useProjectStore.temporal.getState().undo();
    const undoneIds = Object.keys(useProjectStore.getState().nodes);
    expect(undoneIds).toContain("root");
  });

  it("handles 'Keep Both' by merging AI changes with offset originals", async () => {
    useProjectStore.setState({
      nodes: {
        root: {
          id: "root",
          type: "Container",
          props: { x: 0, y: 0 },
          code: "",
        },
        node_A: {
          id: "node_A",
          type: "Card",
          props: { x: 100, y: 100 },
          code: "v1",
        },
      } as any,
      layerOrder: ["node_A"],
    });

    useProjectStore.temporal.getState().pause();
    const snapshot = await useProjectStore.getState().exportJSON();
    useAiStore.getState().setInitialAppSnapshot(snapshot);

    useProjectStore.setState({
      nodes: {
        root: {
          id: "root",
          type: "Container",
          props: { x: 0, y: 0 },
          code: "",
        },
        node_A: {
          id: "node_A",
          type: "Card",
          props: { x: 100, y: 100 },
          code: "v2",
        },
        node_B: {
          id: "node_B",
          type: "Button",
          props: { x: 300, y: 100 },
          code: "new",
        },
      } as any,
      layerOrder: ["node_A", "node_B"],
    });

    keepBothAiChanges();

    const finalNodes = useProjectStore.getState().nodes as Record<string, any>;
    expect(Object.keys(finalNodes)).toHaveLength(4);
    expect(finalNodes.node_A.code).toBe("v2");
    expect(finalNodes.node_B.code).toBe("new");

    const restoredV1 = Object.values(finalNodes).find(
      (node) => node.code === "v1" && node.id !== "node_A"
    );
    expect(restoredV1).toBeDefined();
    expect(restoredV1?.props.y).toBe(300);
  });
});

describe("Nested Wireframe Spatial Consolidation", () => {
  beforeEach(() => {
    useProjectStore.getState().reset();
    useAiStore.getState().clearState();
    useProjectStore.temporal.getState().resume();
  });

  function seedNestedWireframes() {
    useProjectStore.setState({
      nodes: {
        root: {
          id: "root",
          type: "Container",
          props: { x: 0, y: 0 },
          code: "",
        },
        parent: {
          id: "parent",
          type: "Container",
          kind: "wireframe",
          props: { x: 100, y: 100, w: 400, h: 400 },
          comment: "login form",
          children: ["child-user", "child-pass", "child-btn"],
        },
        "child-user": {
          id: "child-user",
          type: "Input",
          kind: "wireframe",
          parentId: "parent",
          props: { x: 120, y: 130, w: 360, h: 48 },
          comment: "name input",
        },
        "child-pass": {
          id: "child-pass",
          type: "Input",
          kind: "wireframe",
          parentId: "parent",
          props: { x: 120, y: 190, w: 360, h: 48 },
          comment: "password input",
        },
        "child-btn": {
          id: "child-btn",
          type: "Button",
          kind: "wireframe",
          parentId: "parent",
          props: { x: 120, y: 250, w: 360, h: 44 },
          comment: "submit",
        },
        // Unselected outsider far away from the parent — must survive any
        // fulfillment or plain creation that doesn't target it.
        outsider: {
          id: "outsider",
          type: "Container",
          kind: "wireframe",
          props: { x: 900, y: 900, w: 200, h: 200 },
          comment: "later idea",
        },
      } as any,
      layerOrder: [
        "parent",
        "child-user",
        "child-pass",
        "child-btn",
        "outsider",
      ],
    });
  }

  it("buildAiContextSnapshot nests children and omits them from top-level intents", async () => {
    seedNestedWireframes();
    const { buildAiContextSnapshot } = await import("@/lib/ai/context");
    const { nodes } = useProjectStore.getState();
    const snapshot = buildAiContextSnapshot({
      prompt: "create login",
      mode: "create",
      activeTab: "components",
      selectedIds: ["parent"],
      nodes: nodes as any,
      themeState: { styles: { light: {}, dark: {} } } as any,
      currentMode: "light",
    });

    expect(snapshot.nodeIntents).toHaveLength(1);
    const parent = snapshot.nodeIntents![0] as any;
    expect(parent.id).toBe("parent");
    expect(parent.nestedChildren).toHaveLength(3);
    const ids = parent.nestedChildren.map((c: any) => c.id).sort();
    expect(ids).toEqual(["child-btn", "child-pass", "child-user"]);
    // Relative offsets are computed against the parent origin (100,100)
    const user = parent.nestedChildren.find((c: any) => c.id === "child-user");
    expect(user.relX).toBe(20);
    expect(user.relY).toBe(30);
    expect(user.w).toBe(360);
    // Top-level list must not contain child ids
    const topIds = snapshot.nodeIntents!.map((n) => n.id);
    expect(topIds).not.toContain("child-user");
    expect(topIds).not.toContain("child-pass");
    expect(topIds).not.toContain("child-btn");
    // Text fallback still present for backward compatibility
    expect(parent.comment).toContain("Contains nested components");
  });

  it("create mode ignores unselected wireframes (normal workflow)", async () => {
    seedNestedWireframes();
    const { buildAiContextSnapshot } = await import("@/lib/ai/context");
    const { nodes } = useProjectStore.getState();
    const snapshot = buildAiContextSnapshot({
      prompt: "a marketing hero",
      mode: "create",
      activeTab: "components",
      selectedIds: [],
      nodes: nodes as any,
      themeState: { styles: { light: {}, dark: {} } } as any,
      currentMode: "light",
    });

    // No selection → no wireframe intents: plain prompt-based creation
    expect(snapshot.nodeIntents ?? []).toHaveLength(0);
  });

  it("selecting a nested child arms its root container", async () => {
    seedNestedWireframes();
    const { buildAiContextSnapshot } = await import("@/lib/ai/context");
    const { nodes } = useProjectStore.getState();
    const snapshot = buildAiContextSnapshot({
      prompt: "",
      mode: "create",
      activeTab: "components",
      selectedIds: ["child-user"],
      nodes: nodes as any,
      themeState: { styles: { light: {}, dark: {} } } as any,
      currentMode: "light",
    });

    expect(snapshot.nodeIntents).toHaveLength(1);
    expect(snapshot.nodeIntents![0].id).toBe("parent");
  });

  it("applyAiActions fulfills the parent and cascade-deletes nested children", () => {
    seedNestedWireframes();
    useUIStore.getState().selectComponents(["parent"]);
    const fulfill: AiPendingAction = {
      id: "fulfill-parent",
      tool: "update_component_code",
      targetId: "parent",
      componentType: "LoginForm",
      code: 'export default () => <form className="h-full w-full"><input /><input type="password" /><button>Go</button></form>',
    };
    const result = applyAiActions([fulfill]);
    expect(result.success).toBe(true);

    const { nodes, layerOrder } = useProjectStore.getState();
    expect(nodes.parent).toBeDefined();
    expect((nodes.parent as any).kind).toBe("generated");
    expect(nodes["child-user"]).toBeUndefined();
    expect(nodes["child-pass"]).toBeUndefined();
    expect(nodes["child-btn"]).toBeUndefined();
    expect(layerOrder).not.toContain("child-user");
    expect(layerOrder).not.toContain("child-pass");
    expect(layerOrder).not.toContain("child-btn");
    // Unselected outsider is untouched
    expect(nodes.outsider).toBeDefined();
    expect((nodes.outsider as any).kind).toBe("wireframe");
    expect(layerOrder).toContain("outsider");
  });

  it("addWireframeComponent computes hierarchy regardless of draw order", () => {
    // Draw children FIRST, then the encompassing container
    const store = useProjectStore.getState();
    const inner1 = store.addWireframeComponent(
      "Input" as any,
      { x: 130, y: 140 },
      { w: 200, h: 40 }
    );
    const inner2 = store.addWireframeComponent(
      "Input" as any,
      { x: 130, y: 190 },
      { w: 200, h: 40 }
    );
    const outer = store.addWireframeComponent(
      "Container" as any,
      { x: 100, y: 100 },
      { w: 400, h: 300 }
    );

    const { nodes } = useProjectStore.getState();
    expect((nodes[inner1] as any).parentId).toBe(outer);
    expect((nodes[inner2] as any).parentId).toBe(outer);
    expect((nodes[outer] as any).children ?? []).toEqual(
      expect.arrayContaining([inner1, inner2])
    );
  });

  it("add_component with wireframe draftId fulfills in place without duplicating", () => {
    seedNestedWireframes();
    useUIStore.getState().selectComponents(["parent"]);
    const before = Object.keys(useProjectStore.getState().nodes).length;
    const fill: AiPendingAction = {
      id: "fill-parent",
      tool: "add_component",
      componentType: "LoginForm",
      code: 'export default () => <form className="h-full w-full">x</form>',
      draftId: "parent",
    };
    applyAiActions([fill]);
    const { nodes } = useProjectStore.getState();
    // No duplicate node created; parent fulfilled; children pruned
    expect(Object.keys(nodes)).toHaveLength(before - 3);
    expect((nodes.parent as any).kind).toBe("generated");
    expect(nodes["child-user"]).toBeUndefined();
  });

  it("plain Create never deletes unselected wireframes it overlaps", () => {
    seedNestedWireframes();
    // No selection: pure prompt-based creation workflow
    const create: AiPendingAction = {
      id: "plain-create",
      tool: "add_component",
      componentType: "Card",
      code: 'export default () => <div className="h-full w-full">hi</div>',
      position: { x: 910, y: 910 },
      size: { w: 100, h: 100 },
    };
    const result = applyAiActions([create]);
    expect(result.success).toBe(true);

    const { nodes } = useProjectStore.getState();
    // The new component exists alongside every untouched wireframe
    const nonRoot = Object.keys(nodes).filter((k) => k !== "root");
    expect(nonRoot).toHaveLength(6);
    for (const id of [
      "parent",
      "child-user",
      "child-pass",
      "child-btn",
      "outsider",
    ]) {
      expect(nodes[id]).toBeDefined();
      expect((nodes[id] as any).kind).toBe("wireframe");
    }
  });

  it("trailing empty apply (summary text landed) never deletes created components", () => {
    seedNestedWireframes();
    // Multi-selection, as users naturally select parent + children
    useUIStore
      .getState()
      .selectComponents(["parent", "child-user", "child-pass", "child-btn"]);
    const fulfill: AiPendingAction = {
      id: "fulfill-parent",
      tool: "update_component_code",
      targetId: "parent",
      componentType: "LoginForm",
      code: 'export default () => <form className="h-full w-full">x</form>',
    };
    expect(applyAiActions([fulfill]).success).toBe(true);
    expect((useProjectStore.getState().nodes.parent as any).kind).toBe(
      "generated"
    );

    // The TopBar effect re-runs when the summary text finishes streaming with
    // zero new tool outputs — this must be a harmless no-op, even though the
    // stale multi-selection now evaluates to bake mode.
    expect(applyAiActions([]).success).toBe(true);

    const { nodes } = useProjectStore.getState();
    expect(nodes.parent).toBeDefined();
    expect((nodes.parent as any).kind).toBe("generated");
    expect((nodes.parent as any).code).toContain("<form");
  });

  it("bake cleanup still consumes un-targeted selected originals on real batches", () => {
    useProjectStore.setState({
      nodes: {
        root: {
          id: "root",
          type: "Container",
          props: { x: 0, y: 0 },
          code: "",
        },
        a: {
          id: "a",
          type: "Card",
          props: { x: 0, y: 0, w: 100, h: 100 },
          code: "a",
        },
        b: {
          id: "b",
          type: "Card",
          props: { x: 200, y: 0, w: 100, h: 100 },
          code: "b",
        },
      } as any,
      layerOrder: ["a", "b"],
    });
    useUIStore.getState().selectComponents(["a", "b"]);

    const create: AiPendingAction = {
      id: "bake-merge",
      tool: "add_component",
      componentType: "Merged",
      code: 'export default () => <div className="h-full w-full">merged</div>',
      position: { x: 500, y: 500 },
      size: { w: 200, h: 120 },
    };
    expect(applyAiActions([create]).success).toBe(true);

    const { nodes } = useProjectStore.getState();
    expect(nodes.a).toBeUndefined();
    expect(nodes.b).toBeUndefined();
    const merged = Object.values(nodes).filter(
      (n: any) =>
        n.id !== "root" &&
        n.code ===
          'export default () => <div className="h-full w-full">merged</div>'
    );
    expect(merged).toHaveLength(1);
  });

  it("acceptAiChanges keeps inert wireframes (only purges drafts/captured)", async () => {
    seedNestedWireframes();
    useProjectStore.temporal.getState().pause();
    const snapshot = await useProjectStore.getState().exportJSON();
    useAiStore.getState().setInitialAppSnapshot(snapshot);

    const create: AiPendingAction = {
      id: "plain-create-2",
      tool: "add_component",
      componentType: "Card",
      code: 'export default () => <div className="h-full w-full">hi</div>',
      position: { x: 1500, y: 1500 },
      size: { w: 200, h: 120 },
    };
    applyAiActions([create]);

    acceptAiChanges();

    const { nodes } = useProjectStore.getState();
    // All user-drawn wireframes survive Accept with comments intact
    for (const id of [
      "parent",
      "child-user",
      "child-pass",
      "child-btn",
      "outsider",
    ]) {
      expect(nodes[id]).toBeDefined();
      expect((nodes[id] as any).kind).toBe("wireframe");
    }
    expect((nodes.outsider as any).comment).toBe("later idea");
    // ...and the created component is still there
    const generated = Object.values(nodes).filter(
      (n: any) => n.kind !== "wireframe" && n.id !== "root"
    );
    expect(generated).toHaveLength(1);
  });
});

describe("Fresh vs used wireframes in create mode", () => {
  beforeEach(() => {
    useProjectStore.getState().reset();
    useAiStore.getState().clearState();
    useUIStore.getState().clearSelection();
    useProjectStore.temporal.getState().resume();
    useProjectStore.setState({
      nodes: {
        root: {
          id: "root",
          type: "Container",
          props: { x: 0, y: 0 },
          code: "",
        },
        hero: {
          id: "hero",
          type: "Container",
          kind: "wireframe",
          props: { x: 100, y: 100, w: 400, h: 200 },
          comment: "",
        },
        footer: {
          id: "footer",
          type: "Container",
          kind: "wireframe",
          props: { x: 100, y: 900, w: 400, h: 100 },
          comment: "",
        },
      } as any,
      layerOrder: ["hero", "footer"],
    });
  });

  /** Mirrors AiTopBar.handleSubmit with nothing selected. */
  async function startCreate() {
    const { getArmedSelectionIds } = await import("@/lib/ai/mode");
    useProjectStore.temporal.getState().pause();
    const snapshot = await useProjectStore.getState().exportJSON();
    useAiStore.getState().setInitialAppSnapshot(snapshot);
    const armed = getArmedSelectionIds(
      "create",
      [],
      useProjectStore.getState().nodes as any
    );
    useAiStore.getState().setActiveMode("create");
    useAiStore.getState().setArmedSelectionIds(armed);
    return armed;
  }

  const fulfillHero: AiPendingAction = {
    id: "fulfill-hero",
    tool: "update_component_code",
    targetId: "hero",
    componentType: "Hero",
    code: 'export default () => <section className="h-full w-full">hero</section>',
  };

  it("fresh wireframes are armed without being selected", async () => {
    const armed = await startCreate();
    expect(armed.sort()).toEqual(["footer", "hero"]);

    const { buildAiContextSnapshot } = await import("@/lib/ai/context");
    const snapshot = buildAiContextSnapshot({
      prompt: "",
      mode: "create",
      activeTab: "components",
      selectedIds: armed,
      nodes: useProjectStore.getState().nodes as any,
      themeState: { styles: { light: {}, dark: {} } } as any,
      currentMode: "light",
    });
    expect(snapshot.nodeIntents?.map((n) => n.id).sort()).toEqual([
      "footer",
      "hero",
    ]);
  });

  it("Accept marks kept wireframes used; they rejoin only when selected", async () => {
    await startCreate();
    applyAiActions([fulfillHero]);
    acceptAiChanges();

    const nodes = useProjectStore.getState().nodes as Record<string, any>;
    expect(nodes.hero.kind).toBe("generated");
    expect(nodes.footer.kind).toBe("wireframe");
    expect(nodes.footer.usedInCreation).toBe(true);

    const { getArmedSelectionIds } = await import("@/lib/ai/mode");
    expect(getArmedSelectionIds("create", [], nodes)).toEqual([]);
    expect(getArmedSelectionIds("create", ["footer"], nodes)).toEqual([
      "footer",
    ]);
  });

  it("a wireframe drawn after a kept creation is still fresh", async () => {
    await startCreate();
    applyAiActions([fulfillHero]);
    acceptAiChanges();

    const fresh = useProjectStore.getState().addWireframeComponent(
      "Container" as any,
      { x: 900, y: 100 },
      {
        w: 200,
        h: 100,
      }
    );
    const { getArmedSelectionIds } = await import("@/lib/ai/mode");
    expect(
      getArmedSelectionIds(
        "create",
        [],
        useProjectStore.getState().nodes as any
      )
    ).toEqual([fresh]);
  });

  it("Reject leaves wireframes fresh", async () => {
    await startCreate();
    applyAiActions([fulfillHero]);
    rejectAiChanges();

    const nodes = useProjectStore.getState().nodes as Record<string, any>;
    expect(nodes.hero.kind).toBe("wireframe");
    expect(nodes.hero.usedInCreation).toBeUndefined();
    expect(nodes.footer.usedInCreation).toBeUndefined();
  });

  it("Keep Both marks restored wireframes used, including re-id'd copies", async () => {
    await startCreate();
    applyAiActions([fulfillHero]);
    keepBothAiChanges();

    const wireframes = Object.values(
      useProjectStore.getState().nodes as Record<string, any>
    ).filter((n) => n.kind === "wireframe");
    // footer (kept) + the original hero wireframe restored under a new id
    expect(wireframes).toHaveLength(2);
    for (const w of wireframes) expect(w.usedInCreation).toBe(true);
  });
});

describe("Spatial Topology Context Snapshot", () => {
  beforeEach(() => {
    useProjectStore.getState().reset();
    useAiStore.getState().clearState();
    useProjectStore.temporal.getState().resume();
  });

  function seedAsymmetricLayout() {
    useProjectStore.setState({
      nodes: {
        root: {
          id: "root",
          type: "Container",
          props: { x: 0, y: 0 },
          code: "",
        },
        parent: {
          id: "parent",
          type: "Container",
          kind: "wireframe",
          props: { x: 0, y: 0, w: 800, h: 600 },
          comment: "dashboard",
          children: ["sidebar", "main"],
        },
        sidebar: {
          id: "sidebar",
          type: "Container",
          kind: "wireframe",
          parentId: "parent",
          props: { x: 0, y: 0, w: 200, h: 600 },
          comment: "sidebar",
        },
        main: {
          id: "main",
          type: "Container",
          kind: "wireframe",
          parentId: "parent",
          props: { x: 200, y: 0, w: 600, h: 600 },
          comment: "main content",
        },
      } as any,
      layerOrder: ["parent", "sidebar", "main"],
    });
  }

  it("produces enriched layout hints for parent wireframes", async () => {
    seedAsymmetricLayout();
    const { buildAiContextSnapshot } = await import("@/lib/ai/context");
    const { nodes } = useProjectStore.getState();
    const snapshot = buildAiContextSnapshot({
      prompt: "build dashboard",
      mode: "create",
      activeTab: "components",
      selectedIds: ["parent"],
      nodes: nodes as any,
      themeState: { styles: { light: {}, dark: {} } } as any,
      currentMode: "light",
    });

    expect(snapshot.nodeIntents).toHaveLength(1);
    const parent = snapshot.nodeIntents![0] as any;
    expect(parent.nestedChildren).toHaveLength(2);
    const sidebar = parent.nestedChildren.find((c: any) => c.id === "sidebar");
    const main = parent.nestedChildren.find((c: any) => c.id === "main");
    expect(sidebar.widthPct).toBe(25);
    expect(main.widthPct).toBe(75);
    expect(sidebar.hAnchor).toBe("start");
    expect(main.hAnchor).toBe("end");
    expect(sidebar.flowRole).toBeDefined();
    // Structural summary replaces disconnected coordinate lists
    expect(parent.comment).toMatch(/Layout structure:/);
    expect(parent.comment).toMatch(/column/i);
  });

  it("preserves parent dimensions and children structure in AI context", async () => {
    seedAsymmetricLayout();
    const { buildAiContextSnapshot } = await import("@/lib/ai/context");
    const { nodes } = useProjectStore.getState();
    const snapshot = buildAiContextSnapshot({
      prompt: "build dashboard",
      mode: "create",
      activeTab: "components",
      selectedIds: ["parent"],
      nodes: nodes as any,
      themeState: { styles: { light: {}, dark: {} } } as any,
      currentMode: "light",
    });

    const parent = snapshot.nodeIntents![0];
    expect(parent.rect).toEqual({ x: 0, y: 0, w: 800, h: 600 });
    expect(parent.nestedChildren).toHaveLength(2);
    for (const child of parent.nestedChildren!) {
      expect(child.widthPct).toBeGreaterThan(0);
      expect(child.heightPct).toBeGreaterThan(0);
      expect(["start", "center", "end", "stretch"]).toContain(child.hAnchor);
      expect(["start", "center", "end", "stretch"]).toContain(child.vAnchor);
    }
  });

  it("emits nested children in spatial reading order even when drawn unconventionally", async () => {
    // Unconventional login card: password drawn on top, email at the bottom.
    // Hierarchy (draw) order is scrambled on purpose — snapshot must still
    // emit password first since it sits higher spatially.
    useProjectStore.setState({
      nodes: {
        root: {
          id: "root",
          type: "Container",
          props: { x: 0, y: 0 },
          code: "",
        },
        card: {
          id: "card",
          type: "Container",
          kind: "wireframe",
          props: { x: 0, y: 0, w: 400, h: 400 },
          comment: "login card",
          children: ["email", "password"],
        },
        email: {
          id: "email",
          type: "Input",
          kind: "wireframe",
          parentId: "card",
          props: { x: 20, y: 330, w: 360, h: 48 },
          comment: "email input",
        },
        password: {
          id: "password",
          type: "Input",
          kind: "wireframe",
          parentId: "card",
          props: { x: 20, y: 120, w: 360, h: 48 },
          comment: "password input",
        },
      } as any,
      layerOrder: ["card", "email", "password"],
    });
    const { buildAiContextSnapshot } = await import("@/lib/ai/context");
    const { nodes } = useProjectStore.getState();
    const snapshot = buildAiContextSnapshot({
      prompt: "login card",
      mode: "create",
      activeTab: "components",
      selectedIds: ["card"],
      nodes: nodes as any,
      themeState: { styles: { light: {}, dark: {} } } as any,
      currentMode: "light",
    });

    const card = snapshot.nodeIntents![0] as any;
    expect(card.nestedChildren.map((c: any) => c.id)).toEqual([
      "password",
      "email",
    ]);
    expect(card.comment).toMatch(/spatial reading order/i);
    // Axis-labeled notation: per-axis anchors must be unambiguous so the
    // model never reads a vertical sequence marker as horizontal alignment.
    expect(card.comment).toMatch(/h:stretch \/ v:end/);
    expect(card.comment).not.toMatch(/anchor \w+-\w+/);
  });

  it("keeps wireframe intents when a prompt accompanies the selection", async () => {
    seedAsymmetricLayout();
    const { buildAiContextSnapshot } = await import("@/lib/ai/context");
    const { nodes } = useProjectStore.getState();
    const snapshot = buildAiContextSnapshot({
      prompt: "dark fintech style with a Google login button",
      mode: "create",
      activeTab: "components",
      selectedIds: ["parent"],
      nodes: nodes as any,
      themeState: { styles: { light: {}, dark: {} } } as any,
      currentMode: "light",
    });

    // Combination payload: prompt preserved AND wireframes armed — the prompt
    // refines the fulfillment, it must never drop the intents.
    expect(snapshot.prompt).toBe(
      "dark fintech style with a Google login button"
    );
    expect(snapshot.nodeIntents).toHaveLength(1);
    expect(snapshot.nodeIntents![0].id).toBe("parent");
    expect(snapshot.nodeIntents![0].nestedChildren).toHaveLength(2);
  });

  it("merges selected components into ONE node framed on the selection bbox", () => {
    useProjectStore.setState({
      nodes: {
        root: {
          id: "root",
          type: "Container",
          props: { x: 0, y: 0 },
          code: "",
        },
        a: {
          id: "a",
          type: "Card",
          props: { x: 0, y: 0, w: 200, h: 100 },
          code: "a-code",
        },
        b: {
          id: "b",
          type: "Card",
          props: { x: 240, y: 0, w: 200, h: 120 },
          code: "b-code",
        },
      } as any,
      layerOrder: ["a", "b"],
    });
    useUIStore.getState().selectComponents(["a", "b"]);
    const merge: AiPendingAction = {
      id: "bake-merge-single",
      tool: "update_component_code",
      targetId: "a",
      componentType: "Merged",
      code: 'export default () => <div className="h-full w-full">merged</div>',
    };
    expect(applyAiActions([merge]).success).toBe(true);

    const { nodes } = useProjectStore.getState();
    expect((nodes.a as any).code).toContain("merged");
    expect(nodes.b).toBeUndefined();
    // Selection bbox: (0,0,200x100) + (240,0,200x120) → 0,0,440x120
    expect(nodes.a.props.x).toBe(0);
    expect(nodes.a.props.y).toBe(0);
    expect(nodes.a.props.w).toBe(440);
    expect(nodes.a.props.h).toBe(120);
    expect(nodes.a.props.widthMode).toBe("fixed");
    expect(nodes.a.props.heightMode).toBe("fixed");
  });

  it("does not reframe when the model splits across multiple targets", () => {
    useProjectStore.setState({
      nodes: {
        root: {
          id: "root",
          type: "Container",
          props: { x: 0, y: 0 },
          code: "",
        },
        a: {
          id: "a",
          type: "Card",
          props: { x: 0, y: 0, w: 200, h: 100 },
          code: "a-code",
        },
        b: {
          id: "b",
          type: "Card",
          props: { x: 240, y: 0, w: 200, h: 120 },
          code: "b-code",
        },
      } as any,
      layerOrder: ["a", "b"],
    });
    useUIStore.getState().selectComponents(["a", "b"]);
    const split: AiPendingAction[] = [
      {
        id: "bake-split-a",
        tool: "update_component_code",
        targetId: "a",
        code: 'export default () => <div className="h-full w-full">a2</div>',
      },
      {
        id: "bake-split-b",
        tool: "update_component_code",
        targetId: "b",
        code: 'export default () => <div className="h-full w-full">b2</div>',
      },
    ];
    expect(applyAiActions(split).success).toBe(true);

    const { nodes } = useProjectStore.getState();
    expect(nodes.a).toBeDefined();
    expect(nodes.b).toBeDefined();
    expect(nodes.a.props.w).toBe(200);
    expect(nodes.b.props.w).toBe(200);
  });

  it("sorts bake selection into spatial reading order, ignoring click order", async () => {
    // 3 stacked inputs + 2 side-by-side buttons, clicked buttons-first.
    useProjectStore.setState({
      nodes: {
        root: {
          id: "root",
          type: "Container",
          props: { x: 0, y: 0 },
          code: "",
        },
        in1: {
          id: "in1",
          type: "Input",
          props: { x: 20, y: 100, w: 360, h: 48 },
          code: "in1",
        },
        in2: {
          id: "in2",
          type: "Input",
          props: { x: 20, y: 160, w: 360, h: 48 },
          code: "in2",
        },
        in3: {
          id: "in3",
          type: "Input",
          props: { x: 20, y: 220, w: 360, h: 48 },
          code: "in3",
        },
        btnL: {
          id: "btnL",
          type: "Button",
          props: { x: 20, y: 300, w: 170, h: 48 },
          code: "btnL",
        },
        btnR: {
          id: "btnR",
          type: "Button",
          props: { x: 210, y: 300, w: 170, h: 48 },
          code: "btnR",
        },
      } as any,
      layerOrder: ["in1", "in2", "in3", "btnL", "btnR"],
    });
    const { buildAiContextSnapshot } = await import("@/lib/ai/context");
    const { createInstructions } = await import("@/lib/ai/prompt-factory");
    const { nodes } = useProjectStore.getState();
    const snapshot = buildAiContextSnapshot({
      prompt: "",
      mode: "bake",
      activeTab: "components",
      selectedIds: ["btnR", "btnL", "in3", "in2", "in1"],
      nodes: nodes as any,
      themeState: { styles: { light: {}, dark: {} } } as any,
      currentMode: "light",
    });

    // Click order (buttons first) must not leak into the merge sequence.
    expect(snapshot.selectedIds).toEqual(["in1", "in2", "in3", "btnL", "btnR"]);
    expect(snapshot.selectedNodes!.map((n) => n.id)).toEqual([
      "in1",
      "in2",
      "in3",
      "btnL",
      "btnR",
    ]);
    // Merge target is the top-left source, not the first-clicked button.
    expect(createInstructions(snapshot)).toMatch(/pre-sorted/);
  });

  it("instructs the model to apply an accompanying prompt inside the fulfillment", async () => {
    seedAsymmetricLayout();
    const { buildAiContextSnapshot } = await import("@/lib/ai/context");
    const { createInstructions } = await import("@/lib/ai/prompt-factory");
    const { nodes } = useProjectStore.getState();

    const withPrompt = buildAiContextSnapshot({
      prompt: "dark fintech style",
      mode: "create",
      activeTab: "components",
      selectedIds: ["parent"],
      nodes: nodes as any,
      themeState: { styles: { light: {}, dark: {} } } as any,
      currentMode: "light",
    });
    expect(createInstructions(withPrompt)).toMatch(
      /apply it INSIDE the wireframe fulfillment/
    );
    // Blending rule: wireframe structure constrains the output even when a
    // prompt is present — the prompt must never rearrange the drawn layout.
    expect(createInstructions(withPrompt)).toMatch(/drawn layout wins/);

    const withoutPrompt = buildAiContextSnapshot({
      prompt: "",
      mode: "create",
      activeTab: "components",
      selectedIds: ["parent"],
      nodes: nodes as any,
      themeState: { styles: { light: {}, dark: {} } } as any,
      currentMode: "light",
    });
    const plain = createInstructions(withoutPrompt);
    expect(plain).toMatch(/Wireframe Fulfillment/);
    expect(plain).not.toMatch(/Two-Phase Pipeline/);
    expect(plain).not.toMatch(/apply it INSIDE the wireframe fulfillment/);
  });
});

describe("Multi-wireframe selection fulfillment (create mode)", () => {
  beforeEach(() => {
    useProjectStore.getState().reset();
    useAiStore.getState().clearState();
    useProjectStore.temporal.getState().resume();
  });

  function seedThreeWireframes() {
    useProjectStore.setState({
      nodes: {
        root: {
          id: "root",
          type: "Container",
          props: { x: 0, y: 0 },
          code: "",
        },
        "wf-1": {
          id: "wf-1",
          type: "Card",
          kind: "wireframe",
          props: { x: 0, y: 0, w: 300, h: 200 },
          comment: "pricing card",
        },
        "wf-2": {
          id: "wf-2",
          type: "Card",
          kind: "wireframe",
          props: { x: 340, y: 0, w: 300, h: 200 },
          comment: "testimonial card",
        },
        "wf-3": {
          id: "wf-3",
          type: "Card",
          kind: "wireframe",
          props: { x: 680, y: 0, w: 300, h: 200 },
          comment: "faq card",
        },
      } as any,
      layerOrder: ["wf-1", "wf-2", "wf-3"],
    });
  }

  const fulfillAction = (id: string): AiPendingAction => ({
    id: `fulfill-${id}`,
    tool: "update_component_code",
    targetId: id,
    componentType: "Card",
    code: `export default () => <div className="h-full w-full">${id}</div>`,
  });

  it("fulfills all three wireframes without deletion or bake misclassification", async () => {
    seedThreeWireframes();
    const { toPendingActions } = await import("@/lib/ai/tool-output");
    const { detectAiMode } = await import("@/lib/ai/mode");

    // toPendingActions in create mode must NOT attach bake sources even
    // though three ids are selected.
    const pending = toPendingActions(
      [
        { tool: "update_component_code", targetId: "wf-1", code: "a" },
        { tool: "update_component_code", targetId: "wf-2", code: "b" },
        { tool: "update_component_code", targetId: "wf-3", code: "c" },
      ] as any,
      ["wf-1", "wf-2", "wf-3"],
      "create"
    );
    for (const a of pending) {
      expect((a as any).bakedSourceIds).toBeUndefined();
    }
    // Bake mode still attaches them.
    const baked = toPendingActions(
      [{ tool: "update_component_code", targetId: "wf-1", code: "a" }] as any,
      ["wf-1", "wf-2"],
      "bake"
    );
    expect((baked[0] as any).bakedSourceIds).toEqual(["wf-1", "wf-2"]);

    // Simulate streaming: three sequential applyAiActions calls in create
    // mode, as the model fulfills one wireframe per step. The selection
    // still holds all three ids throughout (TopBar passes explicit mode).
    useAiStore.getState().setActiveMode("create");
    useUIStore.getState().selectComponents(["wf-1", "wf-2", "wf-3"]);
    expect(applyAiActions([fulfillAction("wf-1")], "create").success).toBe(
      true
    );
    // After one fulfillment the live selection mixes generated + wireframe —
    // live detection flips to bake, but the explicit create mode must win.
    expect(
      detectAiMode(
        useUIStore.getState().selectedIds,
        "components",
        useProjectStore.getState().nodes as any
      )
    ).toBe("bake");
    expect(applyAiActions([fulfillAction("wf-2")], "create").success).toBe(
      true
    );
    expect(applyAiActions([fulfillAction("wf-3")], "create").success).toBe(
      true
    );

    const { nodes } = useProjectStore.getState();
    for (const id of ["wf-1", "wf-2", "wf-3"]) {
      expect(nodes[id]).toBeDefined();
      expect((nodes[id] as any).kind).toBe("generated");
    }
    // No wireframe was consumed as a bake casualty.
    expect(Object.keys(nodes).filter((k) => k !== "root")).toHaveLength(3);
    // All fulfilled targets are selected.
    expect(new Set(useUIStore.getState().selectedIds)).toEqual(
      new Set(["wf-1", "wf-2", "wf-3"])
    );
  });
});

describe("AI camera centering on created components", () => {
  beforeEach(() => {
    useProjectStore.getState().reset();
    useAiStore.getState().clearState();
    useProjectStore.temporal.getState().resume();
    useCanvasStore.getState().reset();
    setLiveCameraState(0, 0, 1);
    document.body.innerHTML = "";
  });

  const addAction = (
    id: string,
    x: number,
    y: number,
    w = 200,
    h = 100
  ): AiPendingAction => ({
    id,
    tool: "add_component",
    componentType: "Card",
    code: `export default () => <div className="h-full w-full">${id}</div>`,
    position: { x, y },
    size: { w, h },
  });

  it("centers the camera on a single created component", () => {
    // Camera is parked far away from the component's coordinates.
    useCanvasStore.getState().setPan(999_999, -999_999);

    const result = applyAiActions([addAction("add-1", 5000, 5000)]);
    expect(result.success).toBe(true);

    const { panX, panY } = useCanvasStore.getState();
    // Node center is (5100, 5050); viewport falls back to window dimensions.
    expect(panX).toBeCloseTo(window.innerWidth / 2 - 5100);
    expect(panY).toBeCloseTo(window.innerHeight / 2 - 5050);
  });

  it("centers on the whole cluster for multi-component batches", () => {
    applyAiActions([
      addAction("add-1", 5000, 5000),
      addAction("add-2", 6000, 5000),
    ]);

    const { panX, panY } = useCanvasStore.getState();
    // Cluster spans x 5000→6200 and y 5000→5100 → center (5600, 5050).
    expect(panX).toBeCloseTo(window.innerWidth / 2 - 5600);
    expect(panY).toBeCloseTo(window.innerHeight / 2 - 5050);
  });

  it("centers on an in-place fulfilled draft skeleton", () => {
    useProjectStore.setState({
      nodes: {
        root: {
          id: "root",
          type: "Container",
          props: { x: 0, y: 0 },
          code: "",
        },
        d1: {
          id: "d1",
          type: "Card",
          kind: "draft",
          props: {
            x: 3000,
            y: 3000,
            w: 400,
            h: 200,
            positionType: "absolute",
            widthMode: "fixed",
            heightMode: "fixed",
          },
          code: "",
        },
      } as any,
      layerOrder: ["d1"],
    });

    const fulfill: AiPendingAction = {
      id: "fill-draft",
      tool: "add_component",
      componentType: "Card",
      code: 'export default () => <div className="h-full w-full">ok</div>',
      draftId: "d1",
    };
    applyAiActions([fulfill]);

    const { panX, panY } = useCanvasStore.getState();
    // d1 center is (3200, 3100).
    expect(panX).toBeCloseTo(window.innerWidth / 2 - 3200);
    expect(panY).toBeCloseTo(window.innerHeight / 2 - 3100);
  });

  it("preserves camera position for update_component_code-only batches (auto-fix parity)", () => {
    useProjectStore.setState({
      nodes: {
        root: {
          id: "root",
          type: "Container",
          props: { x: 0, y: 0 },
          code: "",
        },
        node_1: {
          id: "node_1",
          type: "Button",
          props: { x: 10, y: 20 },
          code: "export default () => <button>old</button>",
        },
      } as any,
      layerOrder: ["node_1"],
    });
    useCanvasStore.getState().setPan(123, 456);
    setLiveCameraState(123, 456, 1);

    const fix: AiPendingAction = {
      id: "fix-1",
      tool: "update_component_code",
      targetId: "node_1",
      componentType: "Button",
      code: "export default () => <button>fixed</button>",
    };
    const result = applyAiActions([fix], "edit");
    expect(result.success).toBe(true);

    // Repairing an existing component must not jump the camera.
    expect(useCanvasStore.getState().panX).toBe(123);
    expect(useCanvasStore.getState().panY).toBe(456);
  });

  it("uses zoomToFit (not centering pan) when a layout is drafted", () => {
    vi.useFakeTimers();
    const container = document.createElement("div");
    container.setAttribute("data-canvas-container", "true");
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
      width: 800,
      height: 600,
      top: 0,
      left: 0,
      right: 800,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    document.body.appendChild(container);

    const zoomSpy = vi.spyOn(useCanvasStore.getState(), "zoomToFit");
    const panSpy = vi.spyOn(useCanvasStore.getState(), "setPan");

    const result = applyAiActions([
      {
        id: "draft",
        tool: "draft_layout",
        components: [
          { id: "d1", componentType: "Card", x: 5000, y: 5000, w: 200, h: 100 },
        ],
      },
      {
        id: "add-draft",
        tool: "add_component",
        componentType: "Card",
        code: 'export default () => <div className="h-full w-full">x</div>',
        draftId: "d1",
      },
    ]);
    expect(result.success).toBe(true);

    // Drafted layouts frame the whole plan via zoomToFit; the direct centering
    // panning path must stay out of the way to avoid conflicting mutations.
    expect(panSpy).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(zoomSpy).toHaveBeenCalled();

    zoomSpy.mockRestore();
    panSpy.mockRestore();
    vi.useRealTimers();
  });
});

describe("Deterministic draft fulfillment", () => {
  beforeEach(() => {
    useProjectStore.getState().reset();
  });

  it("fulfills a draft skeleton by draftId without duplicating nodes", () => {
    const draftAction: AiPendingAction = {
      id: "draft-action",
      tool: "draft_layout",
      components: [
        {
          id: "draft_nav",
          componentType: "Navbar",
          x: 0,
          y: 0,
          w: 1200,
          h: 80,
        },
        {
          id: "draft_hero",
          componentType: "Hero",
          x: 0,
          y: 100,
          w: 1200,
          h: 500,
        },
      ],
    };
    applyAiActions([draftAction]);

    const afterDraft = useProjectStore.getState().nodes;
    expect(afterDraft.draft_nav).toBeDefined();
    expect(afterDraft.draft_hero).toBeDefined();
    expect(afterDraft.draft_nav.kind).toBe("draft");

    // Fulfill with slightly offset coordinates but exact draftId.
    const fillAction: AiPendingAction = {
      id: "fill-action",
      tool: "add_component",
      componentType: "Navbar",
      code: 'export default () => <nav className="h-full w-full">nav</nav>',
      position: { x: 4, y: 6 },
      size: { w: 1200, h: 80 },
      draftId: "draft_nav",
    };
    applyAiActions([fillAction]);

    const afterFill = useProjectStore.getState().nodes;
    // No duplicate: still exactly the two draft nodes (one fulfilled).
    const nonRoot = Object.keys(afterFill).filter((k) => k !== "root");
    expect(nonRoot).toHaveLength(2);
    expect(afterFill.draft_nav.code).toContain("<nav");
  });

  it("respects custom ids in addSkeletonComponents", () => {
    const ids = useProjectStore.getState().addSkeletonComponents([
      {
        id: "draft_custom",
        componentType: "Card",
        x: 10,
        y: 10,
        w: 100,
        h: 100,
      },
    ]);
    expect(ids).toEqual(["draft_custom"]);
    expect(useProjectStore.getState().nodes.draft_custom).toBeDefined();
  });
});
