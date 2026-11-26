import { beforeEach, describe, expect, it } from "vitest";
import { applyAiActions } from "@/hooks/use-ai-action-orchestrator";
import { useAiStore } from "@/stores/ai-store";
import { useCanvasStore } from "@/stores/canvas-store";
import { useProjectStore } from "@/stores/project-store";
import { useUIStore } from "@/stores/ui-store";
import type { AiPendingAddComponentAction } from "@/types/ai";
import { checkOverlap, getRealNodeSize } from "@/utils/spatial-engine";

const add = (id: string, x = 100, y = 100): AiPendingAddComponentAction => ({
  id,
  tool: "add_component",
  componentType: "Card",
  code: "export default () => <div>New</div>",
  position: { x, y },
  size: { w: 200, h: 100 },
});

function expectSeparate(a: string, b: string) {
  const nodes = useProjectStore.getState().nodes;
  const rect = (id: string) => ({
    x: nodes[id].props.x,
    y: nodes[id].props.y,
    ...getRealNodeSize(nodes[id]),
  });
  expect(checkOverlap(rect(a), rect(b), 0)).toBe(false);
}

describe("AI creation placement", () => {
  let existingId: string;
  beforeEach(() => {
    useProjectStore.getState().reset();
    useProjectStore.temporal.getState().resume();
    useAiStore.getState().clearState();
    useUIStore.getState().clearSelection();
    useCanvasStore.getState().reset();
    document.body.innerHTML = "";
    existingId = useProjectStore
      .getState()
      .addComponent("Card", { x: 100, y: 100 }, "", { w: 400, h: 300 });
  });

  it("moves colliding explicit coordinates and frames the final position", () => {
    const result = applyAiActions([add("new")], "create");
    const id = result.createdComponentId!;
    expectSeparate(existingId, id);
    expect(useProjectStore.getState().nodes[existingId].props.x).toBe(100);
    const { props } = useProjectStore.getState().nodes[id];
    expect(useCanvasStore.getState().panX).toBeCloseTo(
      window.innerWidth / 2 - props.x - 100
    );
  });

  it("keeps new components together with their requested spacing", () => {
    applyAiActions([add("first"), add("second", 100, 250)], "create");
    const created = Object.values(useProjectStore.getState().nodes).filter(
      (node) => node.id !== "root" && node.id !== existingId
    );
    expect(created).toHaveLength(2);
    expect(created[1].props.x).toBe(created[0].props.x);
    expect(created[1].props.y - created[0].props.y).toBe(150);
    for (const node of created) expectSeparate(existingId, node.id);
  });

  it("checks the live canvas between streamed batches", () => {
    const first = applyAiActions([add("first")], "create").createdComponentId!;
    const second = applyAiActions([add("second")], "create")
      .createdComponentId!;
    expectSeparate(existingId, second);
    expectSeparate(first, second);
  });

  it("honors an explicit width when the existing height is automatic", () => {
    useProjectStore.getState().updateComponentProps(existingId, {
      w: 1200,
      h: undefined,
    });
    const id = applyAiActions([add("new", 800, 100)], "create")
      .createdComponentId!;
    expect(useProjectStore.getState().nodes[id].props.x).toBeGreaterThan(1300);
  });

  it("leaves coordinates in an already empty area unchanged", () => {
    const id = applyAiActions([add("new", -500, -300)], "create")
      .createdComponentId!;
    expect(useProjectStore.getState().nodes[id].props).toMatchObject({
      x: -500,
      y: -300,
    });
  });

  it("moves draft layouts together and fulfills them before relocating", () => {
    applyAiActions(
      [
        {
          id: "layout",
          tool: "draft_layout",
          components: [
            {
              id: "draft-1",
              componentType: "Card",
              x: 100,
              y: 100,
              w: 200,
              h: 100,
            },
            {
              id: "draft-2",
              componentType: "Card",
              x: 100,
              y: 250,
              w: 200,
              h: 100,
            },
          ],
        },
        { ...add("fill"), draftId: "draft-1" },
      ],
      "create"
    );
    expectSeparate(existingId, "draft-1");
    expectSeparate(existingId, "draft-2");
    const nodes = useProjectStore.getState().nodes;
    expect(nodes["draft-1"].kind).not.toBe("draft");
    expect(nodes["draft-2"].props.y - nodes["draft-1"].props.y).toBe(150);
  });

  it("fulfills existing placeholders in place", () => {
    const [draftId] = useProjectStore
      .getState()
      .addSkeletonComponents([
        { componentType: "Card", x: 100, y: 100, w: 200, h: 100 },
      ]);
    applyAiActions([{ ...add("fill"), draftId }], "create");
    expect(useProjectStore.getState().nodes[draftId].props).toMatchObject({
      x: 100,
      y: 100,
    });
  });

  it("undoes creation and its placement together", () => {
    const id = applyAiActions([add("new")], "create").createdComponentId!;
    expectSeparate(existingId, id);
    useProjectStore.temporal.getState().undo();
    expect(useProjectStore.getState().nodes[id]).toBeUndefined();
    expect(useProjectStore.getState().nodes[existingId]).toBeDefined();
  });
});
