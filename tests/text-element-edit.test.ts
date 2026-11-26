import { beforeEach, describe, expect, it } from "vitest";
import { useProjectStore } from "@/stores/project-store";

const setup = (type: string) => {
  useProjectStore.getState().reset();
  useProjectStore.setState({
    rootId: "root",
    layerOrder: ["t"],
    nodes: {
      root: { id: "root", type: "Container", props: {}, code: "" },
      t: { id: "t", type, props: { x: 0, y: 0, w: 200, h: 40 }, code: "" },
      e: {
        id: "e",
        kind: "captured",
        type: "Captured",
        props: { x: 0, y: 0, w: 200, h: 40 },
        code: "",
        capturedMetadata: {
          astIndex: 0,
          sourceComponentId: "t",
          hasEdits: false,
          originalRect: { x: 0, y: 0, w: 200, h: 40 },
        },
      },
    },
  } as unknown as Parameters<typeof useProjectStore.setState>[0]);
};

describe("editing a Text element in Edit mode", () => {
  beforeEach(() => setup("Text"));

  it("turns it into a regular element so text tools can't undo the edits", () => {
    useProjectStore.getState().markCapturedNodeEdited("e");
    expect(useProjectStore.getState().nodes.t.type).toBe("Container");
  });

  it("leaves other element types alone", () => {
    setup("Card");
    useProjectStore.getState().markCapturedNodeEdited("e");
    expect(useProjectStore.getState().nodes.t.type).toBe("Card");
  });
});
