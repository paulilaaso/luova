import { render, screen } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CanvasRenderer from "@/components/builder/CanvasRenderer";
import { useProjectStore as useBuilderStore } from "@/stores/project-store";

vi.mock("next/dynamic", () => ({
  default: (loader: () => Promise<{ default: React.ComponentType<any> }>) => {
    const LazyComponent = React.lazy(loader);
    return (props: any) => <LazyComponent {...props} />;
  },
}));

vi.mock("@/components/builder/DynamicRenderer", () => ({
  default: ({
    className,
    alignmentClass,
  }: {
    className?: string;
    alignmentClass?: string;
  }) => (
    <div
      data-testid="dynamic-renderer"
      data-alignment-class={alignmentClass ?? ""}
      className={className}
    />
  ),
}));

describe("CanvasRenderer alignment", () => {
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
        child: {
          id: "child",
          type: "Checkbox",
          props: {
            x: 0,
            y: 0,
            w: 450,
            h: 200,
            widthMode: "fixed",
            heightMode: "fixed",
          },
          code: "export default () => <div />;",
        },
        slider: {
          id: "slider",
          type: "Slider",
          props: {
            x: 0,
            y: 0,
            w: 450,
            h: 200,
            widthMode: "fixed",
            heightMode: "fixed",
          },
          code: "export default () => <div />;",
        },
        autoChild: {
          id: "autoChild",
          type: "Button",
          props: {
            x: 0,
            y: 0,
            widthMode: "auto",
            heightMode: "auto",
          },
          code: "export default () => <div />;",
        },
      },
    });
  });

  it("stretches component to fill the box when alignment is not set", async () => {
    render(<CanvasRenderer nodeId="child" previewMode />);
    expect(await screen.findByTestId("dynamic-renderer")).toHaveClass("w-full");
    expect(screen.getByTestId("dynamic-renderer")).toHaveClass("h-full");
  });

  it("shrinks component to intrinsic size when alignment is set (so flex alignment is visible)", async () => {
    useBuilderStore
      .getState()
      .updateComponentProps("child", { alignment: "center" });

    render(<CanvasRenderer nodeId="child" previewMode />);
    expect(await screen.findByTestId("dynamic-renderer")).toHaveAttribute(
      "data-alignment-class",
      "justify-center items-center text-center"
    );
    expect(screen.getByTestId("dynamic-renderer")).toHaveClass("w-full");
    expect(screen.getByTestId("dynamic-renderer")).toHaveClass("h-full");
  });

  it("passes the frame width to DynamicRenderer for measurement", async () => {
    useBuilderStore
      .getState()
      .updateComponentProps("slider", { alignment: "center" });
    render(<CanvasRenderer nodeId="slider" previewMode />);
    expect(await screen.findByTestId("dynamic-renderer")).toHaveAttribute(
      "data-alignment-class",
      "justify-center items-center text-center"
    );
    expect(screen.getByTestId("dynamic-renderer")).toHaveClass("w-full");
  });

  it("enforces overflow clipping when a fixed sizing mode is active", async () => {
    render(<CanvasRenderer nodeId="child" previewMode />);
    const dynamicRenderer = await screen.findByTestId("dynamic-renderer");
    const sandboxContainer = dynamicRenderer.parentElement;
    const styleWrapper = sandboxContainer?.parentElement;
    const canvasFrameContent = styleWrapper?.parentElement;

    expect(canvasFrameContent).toHaveClass("is-clipped");
  });

  it("does not clip overflow when sizing modes are auto", async () => {
    render(<CanvasRenderer nodeId="autoChild" previewMode />);
    const dynamicRenderer = await screen.findByTestId("dynamic-renderer");
    const sandboxContainer = dynamicRenderer.parentElement;
    const styleWrapper = sandboxContainer?.parentElement;
    const canvasFrameContent = styleWrapper?.parentElement;

    expect(canvasFrameContent).not.toHaveClass("is-clipped");
  });

  it("renders root children with deterministic unique z-indexes from normalized layer order", () => {
    useBuilderStore.setState({
      layerOrder: ["slider", "missing", "child", "slider"],
    } as unknown as Parameters<typeof useBuilderStore.setState>[0]);

    const { container } = render(<CanvasRenderer nodeId="root" previewMode />);
    const frames = Array.from(container.querySelectorAll(".canvas-frame"));

    expect(frames.map((frame) => frame.getAttribute("data-node-id"))).toEqual([
      "slider",
      "child",
      "autoChild",
    ]);
    expect(frames.map((frame) => (frame as HTMLElement).style.zIndex)).toEqual([
      "11",
      "12",
      "13",
    ]);
  });
});
