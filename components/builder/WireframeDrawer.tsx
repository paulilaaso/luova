"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useNodeOperations } from "@/hooks/use-node-operations";
import { getLiveCameraState, useCanvasStore } from "@/stores/canvas-store";
import type { ProjectStore } from "@/stores/project-store";
import { useProjectStore } from "@/stores/project-store";
import { useUIStore } from "@/stores/ui-store";
import { getRelativeCoords } from "@/utils/get-relative-coords";

const MIN_DRAW_SIZE = 10;

interface DrawingBox {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

interface WireframeDrawerProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  canvasRef: React.RefObject<HTMLDivElement | null>;
}

export default function WireframeDrawer({
  containerRef,
}: WireframeDrawerProps) {
  const [drawingBox, setDrawingBox] = useState<DrawingBox | null>(null);
  const isDrawingRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const rightDragOccurredRef = useRef(false);
  const rightDragStartRef = useRef<{ x: number; y: number } | null>(null);

  // Drag-move state for existing wireframe nodes
  const isDraggingWireframeRef = useRef(false);
  const draggingIdRef = useRef<string | null>(null);
  const dragStartCanvasRef = useRef({ x: 0, y: 0 });
  const dragStartNodeRef = useRef({ x: 0, y: 0 });

  const addWireframeComponent = useProjectStore(
    (state: ProjectStore) => state.addWireframeComponent
  );
  const { moveComponent } = useNodeOperations();
  const selectComponent = useUIStore((state) => state.selectComponent);
  const clearSelection = useUIStore((state) => state.clearSelection);

  const snapToGrid = useCallback((value: number) => {
    const { snapToGrid, gridSize } = useCanvasStore.getState().gridConfig;
    if (!snapToGrid || gridSize <= 0) return value;
    return Math.round(value / gridSize) * gridSize;
  }, []);

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

  const handleMouseDown = useCallback(
    (e: MouseEvent) => {
      if (e.button !== 0 && e.button !== 2) return;

      const target = e.target as HTMLElement;

      // Allow interaction with annotation bubbles (text editing)
      if (target.closest("[data-annotation-bubble]")) {
        return;
      }

      // Skip moveable handles and popovers
      if (
        target.closest(".moveable-control") ||
        target.closest(".moveable-control-box") ||
        target.closest("[data-popper-popup], [data-base-ui-popup]")
      )
        return;

      // ── RIGHT-CLICK: intercept before Base UI opens the context menu ──
      if (e.button === 2) {
        // Must be somewhere inside the canvas area
        if (
          !target.closest("[data-canvas-container]") &&
          !target.closest("[data-canvas]")
        )
          return;

        // Allow right-click interactions on selected non-wireframe components (e.g. ContextMenu)
        // but always allow drawing inside wireframes
        const frame = target.closest<HTMLElement>(".canvas-frame");
        if (frame) {
          const nodeId = frame.getAttribute("data-node-id");
          const nodeKind = frame.getAttribute("data-node-kind");
          const selectedIds = useUIStore.getState().selectedIds;
          if (
            nodeId &&
            selectedIds.includes(nodeId) &&
            nodeKind !== "wireframe"
          )
            return;
        }

        // Block the native contextmenu (handled by document capture listener above).
        // Do NOT stopPropagation here — we let mousedown bubble normally.
        e.preventDefault();

        // Record start position so we can detect drag vs static click
        rightDragStartRef.current = { x: e.clientX, y: e.clientY };
        rightDragOccurredRef.current = false;

        clearSelection();

        const coords = getCanvasCoordinates(e.clientX, e.clientY);
        const snappedX = snapToGrid(coords.x);
        const snappedY = snapToGrid(coords.y);
        isDrawingRef.current = true;
        setDrawingBox({
          startX: snappedX,
          startY: snappedY,
          currentX: snappedX,
          currentY: snappedY,
        });
        return;
      }
      // ── LEFT-CLICK: drag an existing wireframe, or Alt+click to draw ──
      const componentEl = target.closest<HTMLElement>("[data-component-id]");
      const isOnWireframe =
        componentEl?.getAttribute("data-node-kind") === "wireframe";

      // Left-click on a non-wireframe component — let DnD/Marquee handle it
      if (componentEl && !isOnWireframe) return;

      // Left-click on an existing wireframe — drag it
      if (isOnWireframe && componentEl) {
        const nodeId = componentEl.getAttribute("data-component-id")!;
        const node = useProjectStore.getState().nodes[nodeId];
        if (!node) return;

        e.preventDefault();
        e.stopPropagation();

        selectComponent(nodeId);
        isDraggingWireframeRef.current = true;
        draggingIdRef.current = nodeId;

        const coords = getCanvasCoordinates(e.clientX, e.clientY);
        dragStartCanvasRef.current = coords;
        dragStartNodeRef.current = { x: node.props.x, y: node.props.y };
        return;
      }

      // Alt+left-click on bare canvas — draw a new wireframe (fallback gesture)
      if (e.altKey) {
        if (
          !target.closest("[data-canvas-container]") &&
          !target.closest("[data-canvas]")
        )
          return;

        e.preventDefault();
        e.stopPropagation();
        clearSelection();

        const coords = getCanvasCoordinates(e.clientX, e.clientY);
        const snappedX = snapToGrid(coords.x);
        const snappedY = snapToGrid(coords.y);
        isDrawingRef.current = true;
        setDrawingBox({
          startX: snappedX,
          startY: snappedY,
          currentX: snappedX,
          currentY: snappedY,
        });
      }
    },
    [clearSelection, getCanvasCoordinates, selectComponent, snapToGrid]
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      // Handle drag-move of existing wireframe
      if (isDraggingWireframeRef.current && draggingIdRef.current) {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(() => {
          const coords = getCanvasCoordinates(e.clientX, e.clientY);
          const dx = coords.x - dragStartCanvasRef.current.x;
          const dy = coords.y - dragStartCanvasRef.current.y;
          const rawX = dragStartNodeRef.current.x + dx;
          const rawY = dragStartNodeRef.current.y + dy;
          const nextX = snapToGrid(rawX);
          const nextY = snapToGrid(rawY);

          const el = document.querySelector<HTMLElement>(
            `[data-component-id="${draggingIdRef.current}"]`
          );
          if (el) {
            el.style.left = `${nextX}px`;
            el.style.top = `${nextY}px`;
          }
        });
        return;
      }

      // Handle drawing new wireframe
      if (!isDrawingRef.current) return;

      // Track whether the right-click drag moved enough to count as a draw gesture
      if (rightDragStartRef.current) {
        const dx = e.clientX - rightDragStartRef.current.x;
        const dy = e.clientY - rightDragStartRef.current.y;
        if (Math.sqrt(dx * dx + dy * dy) > 5) {
          rightDragOccurredRef.current = true;
        }
      }

      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        const coords = getCanvasCoordinates(e.clientX, e.clientY);
        const snappedX = snapToGrid(coords.x);
        const snappedY = snapToGrid(coords.y);
        setDrawingBox((prev) => {
          if (!prev) return null;
          return { ...prev, currentX: snappedX, currentY: snappedY };
        });
      });
    },
    [getCanvasCoordinates, snapToGrid]
  );

  const handleMouseUp = useCallback(
    (e: MouseEvent) => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }

      // Commit drag-move of existing wireframe
      if (isDraggingWireframeRef.current && draggingIdRef.current) {
        const el = document.querySelector<HTMLElement>(
          `[data-component-id="${draggingIdRef.current}"]`
        );
        if (el) {
          const x = parseFloat(el.style.left) || 0;
          const y = parseFloat(el.style.top) || 0;
          moveComponent(
            draggingIdRef.current,
            x,
            y,
            useCanvasStore.getState().gridConfig
          );
        }
        isDraggingWireframeRef.current = false;
        draggingIdRef.current = null;
        return;
      }

      // Commit new wireframe draw
      if (!isDrawingRef.current || !drawingBox) {
        isDrawingRef.current = false;
        setDrawingBox(null);
        return;
      }

      isDrawingRef.current = false;

      const x = snapToGrid(Math.min(drawingBox.startX, drawingBox.currentX));
      const y = snapToGrid(Math.min(drawingBox.startY, drawingBox.currentY));
      const w = Math.abs(drawingBox.currentX - drawingBox.startX);
      const h = Math.abs(drawingBox.currentY - drawingBox.startY);

      const wasDrag = rightDragOccurredRef.current;
      rightDragOccurredRef.current = false;
      rightDragStartRef.current = null;

      if (w > MIN_DRAW_SIZE && h > MIN_DRAW_SIZE) {
        // A real wireframe was drawn — commit it, don't open the context menu.
        // It is deliberately NOT selected: a wireframe selection limits Create
        // to the selected ones, so auto-selecting would make Create use only
        // the last drawn wireframe instead of all of them.
        addWireframeComponent("Container", { x, y }, { w, h });
      } else if (!wasDrag) {
        // Static right-click (no meaningful drag) — open the context menu at release position
        const target = e.target as HTMLElement;
        target.dispatchEvent(
          new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true,
            clientX: e.clientX,
            clientY: e.clientY,
            screenX: e.screenX,
            screenY: e.screenY,
          })
        );
      }

      setDrawingBox(null);
    },
    [drawingBox, addWireframeComponent, moveComponent, snapToGrid]
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // The browser fires `contextmenu` synchronously during mousedown on macOS,
    // before any mouseup. We intercept it in capture phase on the document so we
    // can suppress it while a right-click draw is in progress, then re-fire it
    // manually on mouseup at the release position if no drag occurred.
    const handleDocumentContextMenu = (e: MouseEvent) => {
      // Only intercept events that originate inside our canvas container
      if (!container.contains(e.target as Node)) return;

      if (rightDragStartRef.current !== null) {
        // A right-click draw is in progress — always suppress the native menu
        e.preventDefault();
        e.stopPropagation();
      }
    };

    document.addEventListener("contextmenu", handleDocumentContextMenu, true);
    // mousedown in bubble phase is fine here — we just need to record the start
    container.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener(
        "contextmenu",
        handleDocumentContextMenu,
        true
      );
      container.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [containerRef, handleMouseDown, handleMouseMove, handleMouseUp]);

  if (!drawingBox) return null;

  const left = Math.min(drawingBox.startX, drawingBox.currentX);
  const top = Math.min(drawingBox.startY, drawingBox.currentY);
  const width = Math.abs(drawingBox.currentX - drawingBox.startX);
  const height = Math.abs(drawingBox.currentY - drawingBox.startY);

  return (
    <div
      data-app-chrome="true"
      className="absolute bg-muted/40 pointer-events-none"
      style={{
        left: `${left}px`,
        top: `${top}px`,
        width: `${width}px`,
        height: `${height}px`,
        zIndex: 50,
        border: `calc(2px / var(--canvas-zoom, 1)) dashed oklch(0.556 0 0 / 0.3)`,
      }}
    />
  );
}
