import { act, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCanvasCamera } from "@/hooks/use-canvas-camera";
import {
  centerCameraOnNodes,
  centerCameraOnRect,
  getClusterBounds,
  resolveViewportSize,
  setLiveCameraState,
  useCanvasStore,
} from "@/stores/canvas-store";
import { useProjectStore } from "@/stores/project-store";
import type { ComponentNodeAny } from "@/types/builder";

function TestComponent() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const gridOverlayRef = useRef<HTMLDivElement>(null);

  useCanvasCamera({
    containerRef,
    canvasRef,
    gridOverlayRef,
    enabled: true,
  });

  return (
    <div ref={containerRef} data-canvas-container="true">
      <div ref={canvasRef} data-canvas="true">
        <div
          className="canvas-frame is-selected"
          data-node-id="node-1"
          style={{ position: "relative" }}
        >
          Selected Frame
        </div>
        <div
          className="canvas-frame"
          data-node-id="node-2"
          style={{ position: "relative" }}
        >
          Unselected Frame
        </div>
      </div>
      <div ref={gridOverlayRef} className="grid-overlay" />
    </div>
  );
}

describe("useCanvasCamera hook optimization", () => {
  beforeEach(() => {
    useCanvasStore.getState().reset();
    document.body.className = "";
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 0;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("does not write --canvas-zoom to container when is-zooming is active", () => {
    const { container } = render(<TestComponent />);
    const containerEl = container.firstElementChild as HTMLElement;

    // Initially, is-zooming is not on body, zoom is 1. --canvas-zoom is updated.
    expect(containerEl.style.getPropertyValue("--canvas-zoom")).toBe("1");

    // Enable is-zooming class
    document.body.classList.add("is-zooming");

    // Manually trigger a store update. Since is-zooming is active, the Zustand subscriber
    // should ignore this camera update and the DOM shouldn't be written with the new --canvas-zoom.
    act(() => {
      useCanvasStore.getState().setCamera(10, 20, 2.5);
    });

    // The subscription guard prevents setting live camera state and updating the DOM
    expect(containerEl.style.getPropertyValue("--canvas-zoom")).toBe("1");
  });

  it("writes --canvas-zoom when is-zooming class is removed", () => {
    const { container } = render(<TestComponent />);
    const containerEl = container.firstElementChild as HTMLElement;

    expect(containerEl.style.getPropertyValue("--canvas-zoom")).toBe("1");

    // Trigger store update when not zooming
    act(() => {
      useCanvasStore.getState().setCamera(10, 20, 2.5);
    });

    // It should update successfully
    expect(containerEl.style.getPropertyValue("--canvas-zoom")).toBe("2.5");
  });

  it("updates selection handles/borders directly during zoom gesture and cleans them up after zoom ends", () => {
    vi.useFakeTimers();
    const { container } = render(<TestComponent />);
    const containerEl = container.querySelector(
      '[data-canvas-container="true"]'
    ) as HTMLElement;
    const selectedFrameEl = container.querySelector(
      ".canvas-frame.is-selected"
    ) as HTMLElement;
    const normalFrameEl = container.querySelector(
      ".canvas-frame:not(.is-selected)"
    ) as HTMLElement;

    // Dispatch a ctrl-wheel zoom event
    const wheelEvent = new WheelEvent("wheel", {
      deltaY: 10,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });

    act(() => {
      containerEl.dispatchEvent(wheelEvent);
    });

    // Check that we are actively zooming
    expect(document.body.classList.contains("is-zooming")).toBe(true);

    // Zoom factor should have changed
    const liveZoom = selectedFrameEl.style.getPropertyValue("--canvas-zoom");
    expect(liveZoom).toBeDefined();
    expect(Number(liveZoom)).not.toBe(1);

    // The container's canvas-zoom should still be 1 (frozen during zoom)
    expect(containerEl.style.getPropertyValue("--canvas-zoom")).toBe("1");

    // The unselected frame should NOT have inline zoom (only selected or hovered frames get it)
    expect(normalFrameEl.style.getPropertyValue("--canvas-zoom")).toBe("");

    // Now advance time to trigger the debounce zoom-end logic (150ms)
    act(() => {
      vi.advanceTimersByTime(150);
    });

    // It should no longer be zooming
    expect(document.body.classList.contains("is-zooming")).toBe(false);

    // The container's canvas-zoom should now be updated to the final zoom level
    expect(containerEl.style.getPropertyValue("--canvas-zoom")).toBe(liveZoom);

    // The selected frame should have its inline canvas-zoom removed (reverts to container inheritance)
    expect(selectedFrameEl.style.getPropertyValue("--canvas-zoom")).toBe("");
  });
});

describe("cluster camera centering", () => {
  function seedNodes(
    nodes: Record<string, Partial<ComponentNodeAny> & { props: any }>
  ) {
    useProjectStore.setState({
      nodes: {
        root: { id: "root", type: "Container", props: {}, code: "" },
        ...nodes,
      } as any,
    });
  }

  beforeEach(() => {
    useProjectStore.getState().reset();
    useCanvasStore.getState().reset();
    setLiveCameraState(0, 0, 1);
    document.body.innerHTML = "";
  });

  it("computes a cluster bounding box with center", () => {
    const bounds = getClusterBounds([], {} as Record<string, any>);
    expect(bounds).toBeNull();

    const b = getClusterBounds(["n1"], {
      n1: { id: "n1", props: { x: 0, y: 0, w: 200, h: 100 } },
    } as any);
    expect(b).toEqual({
      minX: 0,
      minY: 0,
      maxX: 200,
      maxY: 100,
      centerX: 100,
      centerY: 50,
    });
  });

  it("centers the camera on a single node", () => {
    seedNodes({
      n1: { id: "n1", type: "Card", props: { x: 500, y: 400, w: 100, h: 100 } },
    });

    centerCameraOnNodes(["n1"]);

    const { panX, panY } = useCanvasStore.getState();
    // Node center is (550, 450); viewport falls back to window dimensions.
    expect(panX).toBeCloseTo(window.innerWidth / 2 - 550);
    expect(panY).toBeCloseTo(window.innerHeight / 2 - 450);
  });

  it("centers on the combined bounding box of a multi-node cluster", () => {
    seedNodes({
      a: { id: "a", type: "Card", props: { x: 0, y: 0, w: 200, h: 100 } },
      b: { id: "b", type: "Card", props: { x: 1000, y: 800, w: 200, h: 100 } },
    });

    centerCameraOnNodes(["a", "b"]);

    const { panX, panY } = useCanvasStore.getState();
    // Cluster: 0,0 → 1200,900 → center (600, 450).
    expect(panX).toBeCloseTo(window.innerWidth / 2 - 600);
    expect(panY).toBeCloseTo(window.innerHeight / 2 - 450);
  });

  it("falls back to defaults for nodes with undefined dimensions", () => {
    seedNodes({
      n1: { id: "n1", type: "Card", props: { x: 100, y: 100 } },
    });

    const bounds = getClusterBounds(["n1"]);
    // getRealNodeSize default footprint is 100x40.
    expect(bounds).toEqual({
      minX: 100,
      minY: 100,
      maxX: 200,
      maxY: 140,
      centerX: 150,
      centerY: 120,
    });
  });

  it("measures the canvas container element when available", () => {
    const container = document.createElement("div");
    container.setAttribute("data-canvas-container", "true");
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
      width: 600,
      height: 400,
      top: 0,
      left: 0,
      right: 600,
      bottom: 400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    seedNodes({
      n1: { id: "n1", type: "Card", props: { x: 0, y: 0, w: 100, h: 100 } },
    });

    centerCameraOnNodes(["n1"], { container });

    const { panX, panY } = useCanvasStore.getState();
    // Node center (50, 50) into a 600x400 viewport.
    expect(panX).toBeCloseTo(250);
    expect(panY).toBeCloseTo(150);

    expect(resolveViewportSize(container)).toEqual({
      width: 600,
      height: 400,
    });
  });

  it("is a no-op for empty or unresolved node lists", () => {
    seedNodes({});
    useCanvasStore.getState().setPan(123, 456);

    centerCameraOnNodes([]);
    centerCameraOnNodes(["does-not-exist"]);

    expect(useCanvasStore.getState().panX).toBe(123);
    expect(useCanvasStore.getState().panY).toBe(456);
  });

  it("preserves the live zoom when centering", () => {
    seedNodes({
      n1: {
        id: "n1",
        type: "Card",
        props: { x: 1000, y: 1000, w: 100, h: 100 },
      },
    });
    setLiveCameraState(0, 0, 2);

    centerCameraOnRect(
      { minX: 1000, minY: 1000, maxX: 1100, maxY: 1100 },
      { container: null }
    );

    const { panX, panY, zoom } = useCanvasStore.getState();
    expect(zoom).toBe(1);
    expect(panX).toBeCloseTo(window.innerWidth / 2 - 1050 * 2);
    expect(panY).toBeCloseTo(window.innerHeight / 2 - 1050 * 2);
  });
});
