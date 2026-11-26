import { describe, expect, it } from "vitest";
import { useProjectStore as useBuilderStore } from "@/stores/project-store";
import { MIN_COMPONENT_WIDTH } from "@/types/builder";

describe("builder-store min width normalization", () => {
  it("normalizes existing 0 width even when updating unrelated props", () => {
    useBuilderStore.getState().reset();

    useBuilderStore.setState({
      nodes: {
        root: {
          id: "root",
          type: "Container",
          props: { x: 0, y: 0, w: 1200, h: 800, positionType: "absolute" },
          code: "",
        },
        child: {
          id: "child",
          type: "Checkbox",
          props: { x: 0, y: 0, w: 0 },
          code: "",
        },
      },
      rootId: "root",
      layerOrder: [],
    } as unknown as Parameters<typeof useBuilderStore.setState>[0]);

    useBuilderStore.getState().updateComponentProps("child", { y: 10 });
    expect(useBuilderStore.getState().nodes.child.props.w).toBe(
      MIN_COMPONENT_WIDTH
    );
  });

  it("preserves undefined width (auto) when updating unrelated props", () => {
    useBuilderStore.getState().reset();

    useBuilderStore.setState({
      nodes: {
        root: {
          id: "root",
          type: "Container",
          props: { x: 0, y: 0, w: 1200, h: 800, positionType: "absolute" },
          code: "",
        },
        child: {
          id: "child",
          type: "Checkbox",
          props: { x: 0, y: 0 },
          code: "",
        },
      },
      rootId: "root",
      layerOrder: [],
    } as unknown as Parameters<typeof useBuilderStore.setState>[0]);

    useBuilderStore.getState().updateComponentProps("child", { y: 10 });
    expect(useBuilderStore.getState().nodes.child.props.w).toBeUndefined();
  });

  it("retains custom dimensions when wireframe code is updated", () => {
    useBuilderStore.getState().reset();

    useBuilderStore.setState({
      nodes: {
        root: {
          id: "root",
          type: "Container",
          props: { x: 0, y: 0, w: 1200, h: 800, positionType: "absolute" },
          code: "",
        },
        wf: {
          id: "wf",
          type: "Text",
          kind: "wireframe",
          props: {
            x: 100,
            y: 100,
            w: 600,
            h: 400,
            positionType: "absolute",
            widthMode: "fixed",
            heightMode: "fixed",
          },
          code: "",
        },
      },
      rootId: "root",
      layerOrder: ["wf"],
    } as unknown as Parameters<typeof useBuilderStore.setState>[0]);

    useBuilderStore
      .getState()
      .updateComponentCode("wf", "export default () => <div>hi</div>");

    const node = useBuilderStore.getState().nodes.wf;
    expect(node.kind).toBe("generated");
    // Drawn footprint survives promotion — no collapse to intrinsic size.
    expect(node.props.w).toBe(600);
    expect(node.props.h).toBe(400);
  });

  it("does not delete drawn dimensions for auto-sized traits on promotion", () => {
    useBuilderStore.getState().reset();

    useBuilderStore.setState({
      nodes: {
        root: {
          id: "root",
          type: "Container",
          props: { x: 0, y: 0, w: 1200, h: 800, positionType: "absolute" },
          code: "",
        },
        wf: {
          id: "wf",
          type: "Text",
          kind: "wireframe",
          props: {
            x: 50,
            y: 50,
            w: 500,
            h: 300,
            positionType: "absolute",
            widthMode: "auto",
            heightMode: "auto",
          },
          code: "",
        },
      },
      rootId: "root",
      layerOrder: ["wf"],
    } as unknown as Parameters<typeof useBuilderStore.setState>[0]);

    useBuilderStore
      .getState()
      .updateComponentCode("wf", "export default () => <span>hi</span>");

    const node = useBuilderStore.getState().nodes.wf;
    // Auto traits must not strip the drawn bounding box.
    expect(node.props.w).toBe(500);
    expect(node.props.h).toBe(300);
  });
});
