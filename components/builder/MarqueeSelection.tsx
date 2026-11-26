"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getLiveCameraState } from "@/stores/canvas-store";
import type { ProjectStore } from "@/stores/project-store";
import { useProjectStore } from "@/stores/project-store";
import { useUIStore } from "@/stores/ui-store";
import { getRelativeCoords } from "@/utils/get-relative-coords";
import { getRealNodeSize } from "@/utils/spatial-engine";

interface SelectionBox {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

interface MarqueeSelectionProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  canvasRef: React.RefObject<HTMLDivElement | null>;
}

export default function MarqueeSelection({
  containerRef,
}: MarqueeSelectionProps) {
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const dragMovedRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const isSelectingRef = useRef(false);
  const selectionBoxRef = useRef<SelectionBox | null>(null);

  const nodes = useProjectStore((state: ProjectStore) => state.nodes);
  const rootId = useProjectStore((state: ProjectStore) => state.rootId);
  const bringToFront = useProjectStore((state: any) => state.bringToFront);
  const selectComponents = useUIStore((state) => state.selectComponents);
  const clearSelection = useUIStore((state) => state.clearSelection);

  // Convert screen coordinates to canvas coordinates using the viewport container
  const getCanvasCoordinates = useCallback(
    (clientX: number, clientY: number) => {
      if (!containerRef.current) return { x: 0, y: 0 };

      const { zoom, panX, panY } = getLiveCameraState();

      return getRelativeCoords({ clientX, clientY }, containerRef.current, {
        zoom,
        panX,
        panY,
      });
    },
    [containerRef]
  );

  const getIntersectingComponents = useCallback(
    (box: SelectionBox) => {
      const left = Math.min(box.startX, box.currentX);
      const right = Math.max(box.startX, box.currentX);
      const top = Math.min(box.startY, box.currentY);
      const bottom = Math.max(box.startY, box.currentY);

      const intersecting: string[] = [];

      for (const nodeId of Object.keys(nodes)) {
        if (nodeId === rootId) continue;

        const node = nodes[nodeId];
        if (!node) continue;
        if (node.kind === "captured" || node.kind === "draft") continue;

        const { x: nodeX, y: nodeY } = node.props;
        // Use real DOM bounds instead of defaulting to hardcoded MIN_COMPONENT_WIDTH
        const { w: nodeW, h: nodeH } = getRealNodeSize(node);

        const nodeRight = nodeX + nodeW;
        const nodeBottom = nodeY + nodeH;

        if (
          nodeX < right &&
          nodeRight > left &&
          nodeY < bottom &&
          nodeBottom > top
        ) {
          intersecting.push(nodeId);
        }
      }

      return intersecting;
    },
    [nodes, rootId]
  );

  const handleMouseDown = useCallback(
    (e: MouseEvent) => {
      // Only start selection on plain left click (Alt+click is reserved for wireframe drawing)
      if (e.button !== 0) return;
      if (e.altKey) return;

      const target = e.target as HTMLElement;

      // Allow interaction with annotation bubbles (text editing)
      if (target.closest("[data-annotation-bubble]")) {
        return;
      }

      // Don't start if clicking on a component or control
      if (
        target.closest("[data-component-id]") ||
        target.closest(".moveable-control") ||
        target.closest("[data-popper-popup], [data-base-ui-popup]")
      ) {
        return;
      }

      // Start on canvas or container background
      const isOnCanvas =
        target.hasAttribute("data-canvas") ||
        target.hasAttribute("data-canvas-container") ||
        target.closest("[data-canvas]") !== null;
      if (!isOnCanvas) return;

      const coords = getCanvasCoordinates(e.clientX, e.clientY);

      const box: SelectionBox = {
        startX: coords.x,
        startY: coords.y,
        currentX: coords.x,
        currentY: coords.y,
      };
      setSelectionBox(box);
      selectionBoxRef.current = box;
      setIsSelecting(true);
      isSelectingRef.current = true;
      dragMovedRef.current = false;

      // Blur any focused input inside a canvas component FIRST, so the text
      // editor commits its content before clearSelection() unmounts it.
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }

      // Clear existing selection when starting a new marquee
      clearSelection();

      // Prevent default to avoid text selection
      e.preventDefault();
    },
    [getCanvasCoordinates, clearSelection]
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isSelectingRef.current) return;

      dragMovedRef.current = true;

      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }

      rafRef.current = requestAnimationFrame(() => {
        const coords = getCanvasCoordinates(e.clientX, e.clientY);

        setSelectionBox((prev) => {
          if (!prev) return null;
          const next = {
            ...prev,
            currentX: coords.x,
            currentY: coords.y,
          };
          selectionBoxRef.current = next;
          return next;
        });
      });
    },
    [getCanvasCoordinates]
  );

  const handleMouseUp = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    const box = selectionBoxRef.current;
    selectionBoxRef.current = null;
    isSelectingRef.current = false;

    if (!box) {
      setIsSelecting(false);
      setSelectionBox(null);
      return;
    }

    // Find intersecting components
    const intersecting = getIntersectingComponents(box);

    if (intersecting.length > 0) {
      selectComponents(intersecting);
      bringToFront(intersecting);
    }

    setIsSelecting(false);
    setSelectionBox(null);
  }, [getIntersectingComponents, selectComponents, bringToFront]);

  // Intercept click to prevent clearing selection after dragging
  const handleClick = useCallback((e: MouseEvent) => {
    if (dragMovedRef.current) {
      e.stopPropagation();
      dragMovedRef.current = false;
    }
  }, []);

  // Attach global mouse listeners
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener("mousedown", handleMouseDown);
    // Use capture to intercept the click before it reaches the Canvas onClick handler
    container.addEventListener("click", handleClick, { capture: true });
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
      container.removeEventListener("mousedown", handleMouseDown);
      container.removeEventListener("click", handleClick, { capture: true });
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [
    containerRef,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleClick,
  ]);

  if (!selectionBox || !isSelecting) return null;

  const left = Math.min(selectionBox.startX, selectionBox.currentX);
  const top = Math.min(selectionBox.startY, selectionBox.currentY);
  const width = Math.abs(selectionBox.currentX - selectionBox.startX);
  const height = Math.abs(selectionBox.currentY - selectionBox.startY);

  const screenWidth = width * getLiveCameraState().zoom;
  const screenHeight = height * getLiveCameraState().zoom;
  if (screenWidth < 5 && screenHeight < 5) return null;

  // Render in canvas coordinates (no zoom multiplication - we're inside the zoomed div)
  return (
    <div
      data-app-chrome="true"
      className="absolute pointer-events-none bg-primary/10 z-50"
      style={{
        left: `${left}px`,
        top: `${top}px`,
        width: `${width}px`,
        height: `${height}px`,
        border: `calc(2px / var(--canvas-zoom, 1)) solid oklch(0.7 0.02 250 / 0.6)`,
      }}
    />
  );
}
