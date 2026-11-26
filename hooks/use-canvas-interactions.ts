"use client";

import { useCallback, useEffect, useRef } from "react";
import { useNodeOperations } from "@/hooks/use-node-operations";
import { getLiveCameraState, useCanvasStore } from "@/stores/canvas-store";
import { useProjectStore } from "@/stores/project-store";
import { useUIStore } from "@/stores/ui-store";
import {
  COMPONENT_SIZING_TRAITS,
  type DragState,
  type InteractionFrame,
} from "@/types/builder";

const THRESHOLD = 5;
const MIN_SIZE = 20;

const CURSOR_MAP: Record<string, string> = {
  nw: "is-resizing-nwse",
  se: "is-resizing-nwse",
  ne: "is-resizing-nesw",
  sw: "is-resizing-nesw",
  n: "is-resizing-ns",
  s: "is-resizing-ns",
  e: "is-resizing-ew",
  w: "is-resizing-ew",
};

const RESIZE_CURSORS = new Set(Object.values(CURSOR_MAP));

/**
 * Elements that visually follow a dragged node but are only repositioned in
 * the store when the drag commits:
 *  - annotation bubbles + connectors (AnnotationOverlay)
 *  - captured-element frames (their dashed outline), which follow their
 *    source component via shiftCapturedNodes on commit.
 * During the drag we translate them directly in the DOM, mirroring how the
 * node itself is moved.
 */
function findDragFollowerEls(
  container: HTMLElement | null,
  ids: string[]
): HTMLElement[] {
  if (!container || ids.length === 0) return [];
  const idSet = new Set(ids);
  const capturedIds: string[] = [];
  for (const n of Object.values(useProjectStore.getState().nodes)) {
    const sourceId = n.capturedMetadata?.sourceComponentId;
    // Skip ones already being dragged directly (multi-select) to avoid a
    // double offset.
    if (
      n.kind === "captured" &&
      sourceId &&
      idSet.has(sourceId) &&
      !idSet.has(n.id)
    ) {
      capturedIds.push(n.id);
    }
  }
  const selector = [
    ...ids.flatMap((id) => [
      `[data-annotation-for="${CSS.escape(id)}"]`,
      `[data-annotation-node="${CSS.escape(id)}"]`,
    ]),
    ...capturedIds.map(
      (id) => `.canvas-frame[data-node-id="${CSS.escape(id)}"]`
    ),
  ].join(",");
  return Array.from(container.querySelectorAll<HTMLElement>(selector));
}

/** The topmost resize handle of a selected frame under the pointer, if any. */
function findSelectedHandleUnderPointer(e: PointerEvent): HTMLElement | null {
  for (const el of document.elementsFromPoint(e.clientX, e.clientY)) {
    if (
      el instanceof HTMLElement &&
      el.classList.contains("canvas-resize-handle") &&
      el.closest(".canvas-frame.is-selected")
    ) {
      return el;
    }
  }
  return null;
}

/** Screen-pixel distance from a wireframe's outline that counts as a hit. */
const WIRE_HIT_TOLERANCE = 6;

/**
 * Empty wireframes behave like wires rather than stacked panels. Over empty
 * wireframes, pick the one whose outline is nearest the pointer (within
 * WIRE_HIT_TOLERANCE), even if it is bigger or underneath; otherwise the
 * smallest one containing the pointer, so nested wireframes stay reachable.
 */
function pickWireframeUnderPointer(
  hitFrame: HTMLElement,
  target: Element,
  e: PointerEvent
): HTMLElement {
  const isEmptyWireframe = (el: Element) => {
    if (
      !el.classList.contains("canvas-frame") ||
      el.getAttribute("data-node-kind") !== "wireframe"
    )
      return false;
    // Its own placeholder, not one of a nested frame.
    const placeholder = el.querySelector(".wireframe-placeholder");
    return placeholder?.closest(".canvas-frame") === el;
  };
  // Resize handles belong to the frame they sit on.
  if (target.closest("[data-direction]")) return hitFrame;
  if (!isEmptyWireframe(hitFrame)) return hitFrame;

  let nearestWire: HTMLElement | null = null;
  let nearestDistance = WIRE_HIT_TOLERANCE;
  let smallest = hitFrame;
  let smallestArea = Number.POSITIVE_INFINITY;
  for (const el of document.elementsFromPoint(e.clientX, e.clientY)) {
    if (!isEmptyWireframe(el)) continue;
    const r = el.getBoundingClientRect();
    const toOutline = Math.min(
      e.clientX - r.left,
      r.right - e.clientX,
      e.clientY - r.top,
      r.bottom - e.clientY
    );
    if (toOutline <= nearestDistance) {
      nearestWire = el as HTMLElement;
      nearestDistance = toOutline;
    }
    const area = r.width * r.height;
    if (area < smallestArea) {
      smallest = el as HTMLElement;
      smallestArea = area;
    }
  }
  return nearestWire ?? smallest;
}

function snapToGrid(value: number, gridSize: number): number {
  return Math.round(value / gridSize) * gridSize;
}

export function useCanvasInteractions() {
  const selectComponent = useUIStore((s) => s.selectComponent);
  const addToSelection = useUIStore((s) => s.addToSelection);
  const setEditingTextNodeId = useUIStore((s) => s.setEditingTextNodeId);
  const editingTextNodeId = useUIStore((s) => s.editingTextNodeId);
  const _bringToFront = useProjectStore((s: any) => s.bringToFront);
  const { updateLayouts } = useNodeOperations();
  const _updateComponentProps = useProjectStore(
    (state: any) => state.updateComponentProps
  );

  const dragStateRef = useRef<DragState>({
    state: "IDLE",
    type: null,
    startClientX: 0,
    startClientY: 0,
    frames: [],
    wasSelected: false,
    isModifierActive: false,
  });

  const isDraggingRef = useRef(false);
  const onMoveRef = useRef<((e: PointerEvent) => void) | null>(null);
  const onUpRef = useRef<(() => void) | null>(null);
  const suppressClickRef = useRef<((e: MouseEvent) => void) | null>(null);
  const canvasRef = useRef<HTMLElement | null>(null);
  const followerElsRef = useRef<HTMLElement[]>([]);

  useEffect(() => {
    return () => {
      if (isDraggingRef.current) {
        window.removeEventListener("pointermove", onMoveRef.current!);
        window.removeEventListener("pointerup", onUpRef.current!);
        if (suppressClickRef.current) {
          window.removeEventListener("click", suppressClickRef.current, true);
        }
        isDraggingRef.current = false;
      }
    };
  }, []);

  const clearDragState = useCallback(() => {
    dragStateRef.current = {
      state: "IDLE",
      type: null,
      startClientX: 0,
      startClientY: 0,
      frames: [],
      wasSelected: false,
      isModifierActive: false,
    };
    isDraggingRef.current = false;
    // Runs right after the store commit, so React re-renders the bubbles at
    // their new position before the next paint — no flicker.
    for (const el of followerElsRef.current)
      el.style.removeProperty("transform");
    followerElsRef.current = [];
    document.body.classList.remove("is-dragging");
    document.body.classList.remove(...RESIZE_CURSORS);
    useCanvasStore.getState().setCanvasDragging(false);
    useCanvasStore.getState().setCanvasResizing(false);

    if (canvasRef.current) {
      canvasRef.current.style.removeProperty("pointer-events");
    }
  }, []);

  const commitDrag = useCallback(
    (didMove: boolean, wasSelected: boolean, wasDeferred: boolean) => {
      const { frames, state } = dragStateRef.current;
      if (state !== "DRAGGING" || frames.length === 0) return;

      const gridConfig = useCanvasStore.getState().gridConfig;

      const updates = frames.map((f) => ({
        id: f.id,
        x: Math.round(parseFloat(f.el.style.left)),
        y: Math.round(parseFloat(f.el.style.top)),
      }));
      updateLayouts(updates, gridConfig);

      if (!wasSelected && didMove && !wasDeferred) {
        useUIStore.getState().clearSelection();
      }

      clearDragState();
    },
    [updateLayouts, clearDragState]
  );

  const commitResize = useCallback(() => {
    const { frames } = dragStateRef.current;
    if (frames.length !== 1) return;

    const f = frames[0];
    const gridConfig = useCanvasStore.getState().gridConfig;
    const finalLeft = Math.round(parseFloat(f.el.style.left));
    const finalTop = Math.round(parseFloat(f.el.style.top));
    const finalW = Math.round(parseFloat(f.el.style.width));
    const finalH = Math.round(parseFloat(f.el.style.height));

    if (
      !Number.isNaN(finalW) &&
      !Number.isNaN(finalH) &&
      !Number.isNaN(finalLeft) &&
      !Number.isNaN(finalTop)
    ) {
      // A manual resize is an explicit size decision: force both axes to
      // "fixed". Otherwise nodes whose traits default to "auto" (e.g. Text,
      // Image height) keep hugging their content, so the stored w/h are
      // ignored on render and the box snaps back every time the project is
      // reopened.
      updateLayouts(
        [
          {
            id: f.id,
            x: finalLeft,
            y: finalTop,
            w: finalW,
            h: finalH,
            widthMode: "fixed",
            heightMode: "fixed",
          },
        ],
        gridConfig
      );
    }

    clearDragState();
  }, [updateLayouts, clearDragState]);

  const handleResizeMove = useCallback((e: PointerEvent) => {
    const { direction, startClientX, startClientY, frames } =
      dragStateRef.current;
    if (!direction || frames.length !== 1) return;

    const zoom = getLiveCameraState().zoom;
    const gridConfig = useCanvasStore.getState().gridConfig;
    const f = frames[0];

    const dx = (e.clientX - startClientX) / zoom;
    const dy = (e.clientY - startClientY) / zoom;

    let newLeft = f.startX;
    let newTop = f.startY;
    let newW = f.startW ?? 0;
    let newH = f.startH ?? 0;

    if (direction.includes("e")) {
      newW = f.startW! + dx;
    }
    if (direction.includes("w")) {
      newW = f.startW! - dx;
      newLeft = f.startX + dx;
    }
    if (direction.includes("s")) {
      newH = f.startH! + dy;
    }
    if (direction.includes("n")) {
      newH = f.startH! - dy;
      newTop = f.startY + dy;
    }

    // Enforce aspect ratio for Images with auto dimensions
    const node = useProjectStore.getState().nodes[f.id];
    const traits = node ? COMPONENT_SIZING_TRAITS[node.type] : null;
    const widthMode = node?.props.widthMode ?? traits?.widthMode ?? "fixed";
    const heightMode = node?.props.heightMode ?? traits?.heightMode ?? "fixed";
    const isAutoImage =
      node?.type === "Image" && (widthMode === "auto" || heightMode === "auto");

    if (isAutoImage && f.startAspectRatio) {
      const aspectRatio = f.startAspectRatio;

      // Determine if dragging is horizontal, vertical, or diagonal
      const isHorizontal = direction === "e" || direction === "w";
      const isVertical = direction === "n" || direction === "s";

      if (isHorizontal) {
        // Dragging horizontally: scale height proportionally
        newH = newW / aspectRatio;
      } else if (isVertical) {
        // Dragging vertically: scale width proportionally
        newW = newH * aspectRatio;
      } else {
        // Dragging diagonally: treat width as primary driver
        newH = newW / aspectRatio;
      }
    }

    if (newW < MIN_SIZE) {
      if (direction.includes("w")) newLeft = f.startX + f.startW! - MIN_SIZE;
      newW = MIN_SIZE;
    }
    if (newH < MIN_SIZE) {
      if (direction.includes("n")) newTop = f.startY + f.startH! - MIN_SIZE;
      newH = MIN_SIZE;
    }

    if (gridConfig.snapToGrid && gridConfig.gridSize > 0) {
      newW = snapToGrid(newW, gridConfig.gridSize);
      newH = snapToGrid(newH, gridConfig.gridSize);
      newLeft = snapToGrid(newLeft, gridConfig.gridSize);
      newTop = snapToGrid(newTop, gridConfig.gridSize);
    }

    f.el.style.left = `${newLeft}px`;
    f.el.style.top = `${newTop}px`;
    f.el.style.width = `${newW}px`;
    f.el.style.height = `${newH}px`;
  }, []);

  const handleDragMove = useCallback((e: PointerEvent) => {
    const { startClientX, startClientY, frames } = dragStateRef.current;
    const zoom = getLiveCameraState().zoom;
    const gridConfig = useCanvasStore.getState().gridConfig;

    let dx = (e.clientX - startClientX) / zoom;
    let dy = (e.clientY - startClientY) / zoom;

    if (!isDraggingRef.current && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
    isDraggingRef.current = true;

    // When multiple items are selected, snap the delta once to maintain relative spacing
    if (gridConfig.snapToGrid && gridConfig.gridSize > 0 && frames.length > 0) {
      // Snap the delta based on the first element's movement
      const firstFrame = frames[0];
      const snappedX = snapToGrid(firstFrame.startX + dx, gridConfig.gridSize);
      const snappedY = snapToGrid(firstFrame.startY + dy, gridConfig.gridSize);
      dx = snappedX - firstFrame.startX;
      dy = snappedY - firstFrame.startY;
    }

    for (const f of frames) {
      const newX = f.startX + dx;
      const newY = f.startY + dy;

      f.el.style.left = `${newX}px`;
      f.el.style.top = `${newY}px`;
    }

    const translate = `translate3d(${dx}px, ${dy}px, 0)`;
    for (const el of followerElsRef.current) el.style.transform = translate;
  }, []);

  const handlePointerUp = useCallback(() => {
    window.removeEventListener("pointermove", onMoveRef.current!);
    window.removeEventListener("pointerup", onUpRef.current!);

    if (suppressClickRef.current) {
      window.removeEventListener("click", suppressClickRef.current, true);
      suppressClickRef.current = null;
    }

    if (canvasRef.current) {
      canvasRef.current.style.removeProperty("pointer-events");
    }

    const { state, wasSelected, frames } = dragStateRef.current;

    if (state === "DRAGGING") {
      // Fix multi-selection click isolation behavior
      // If this was a pure click (no drag) on an already-selected item in a multi-selection,
      // isolate the selection to just this item — UNLESS a modifier key was active
      const isModifierActive = dragStateRef.current.isModifierActive ?? false;
      if (!isDraggingRef.current && wasSelected && !isModifierActive) {
        const selectedCount = useUIStore.getState().selectedIds.length;
        if (selectedCount > 1 && frames.length > 0) {
          const clickedId = frames[0].id;
          useUIStore.getState().selectComponent(clickedId);
          clearDragState();
          return;
        }
      }

      commitDrag(isDraggingRef.current, wasSelected, false);
    } else if (state === "RESIZING") {
      commitResize();
    } else if (state === "DEFERRED_DRAG") {
      commitDrag(isDraggingRef.current, wasSelected, true);
    } else {
      clearDragState();
    }
  }, [commitDrag, commitResize, clearDragState]);

  const startDrag = useCallback(
    (
      e: PointerEvent,
      frame: HTMLElement,
      id: string,
      wasSelected: boolean,
      isModifierActive: boolean = false
    ) => {
      const selectedIds = useUIStore.getState().selectedIds;
      const _zoom = useCanvasStore.getState().zoom;

      const frames: InteractionFrame[] = [];

      const startX = parseFloat(frame.style.left) || 0;
      const startY = parseFloat(frame.style.top) || 0;
      frames.push({ id, el: frame, startX, startY });

      canvasRef.current = frame.closest<HTMLElement>('[data-canvas="true"]');

      if (
        selectedIds.includes(id) &&
        selectedIds.length > 1 &&
        canvasRef.current
      ) {
        const container = canvasRef.current;
        for (const otherId of selectedIds) {
          if (otherId === id) continue;
          const otherEl = container.querySelector<HTMLElement>(
            `[data-node-id="${otherId}"]`
          );
          if (otherEl) {
            frames.push({
              id: otherId,
              el: otherEl,
              startX: parseFloat(otherEl.style.left) || 0,
              startY: parseFloat(otherEl.style.top) || 0,
            });
          }
        }
      }

      followerElsRef.current = findDragFollowerEls(
        canvasRef.current,
        frames.map((f) => f.id)
      );

      dragStateRef.current = {
        state: "DRAGGING",
        type: "drag",
        startClientX: e.clientX,
        startClientY: e.clientY,
        frames,
        wasSelected,
        isModifierActive,
      };

      useCanvasStore.getState().setCanvasDragging(true);
      isDraggingRef.current = false;
      document.body.classList.add("is-dragging");
      frame.setPointerCapture(e.pointerId);

      if (canvasRef.current) {
        canvasRef.current.style.pointerEvents = "none";
      }

      onMoveRef.current = handleDragMove;
      onUpRef.current = handlePointerUp;

      window.addEventListener("pointermove", onMoveRef.current);
      window.addEventListener("pointerup", onUpRef.current);
    },
    [handleDragMove, handlePointerUp]
  );

  const startDeferredDrag = useCallback(
    (e: PointerEvent, frame: HTMLElement, id: string) => {
      const startX = e.clientX;
      const startY = e.clientY;

      let _didCrossThreshold = false;

      const onMove = (me: PointerEvent) => {
        const dx = me.clientX - startX;
        const dy = me.clientY - startY;
        if (Math.abs(dx) < THRESHOLD && Math.abs(dy) < THRESHOLD) return;

        _didCrossThreshold = true;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);

        const suppressClick = (ce: MouseEvent) => {
          ce.stopPropagation();
          ce.preventDefault();
          window.removeEventListener("click", suppressClick, true);
        };
        window.addEventListener("click", suppressClick, true);
        suppressClickRef.current = suppressClick;

        const selectedIds = useUIStore.getState().selectedIds;
        const wasSelected = selectedIds.includes(id);
        startDrag(me, frame, id, wasSelected);
      };

      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [startDrag]
  );

  const startResize = useCallback(
    (
      e: PointerEvent,
      frame: HTMLElement,
      id: string,
      direction: string,
      isModifierActive: boolean = false
    ) => {
      const _zoom = useCanvasStore.getState().zoom;
      const startW = parseFloat(frame.style.width) || frame.offsetWidth;
      const startH = parseFloat(frame.style.height) || frame.offsetHeight;
      const startX = parseFloat(frame.style.left) || 0;
      const startY = parseFloat(frame.style.top) || 0;
      const startAspectRatio = startH > 0 ? startW / startH : 1;

      dragStateRef.current = {
        state: "RESIZING",
        type: "resize",
        direction,
        startClientX: e.clientX,
        startClientY: e.clientY,
        frames: [
          { id, el: frame, startX, startY, startW, startH, startAspectRatio },
        ],
        wasSelected: false,
        isModifierActive,
      };

      useCanvasStore.getState().setCanvasResizing(true);
      document.body.classList.add(CURSOR_MAP[direction] || "is-resizing-nwse");
      frame.setPointerCapture(e.pointerId);

      canvasRef.current = frame.closest<HTMLElement>('[data-canvas="true"]');
      if (canvasRef.current) {
        canvasRef.current.style.pointerEvents = "none";
      }

      onMoveRef.current = handleResizeMove;
      onUpRef.current = handlePointerUp;

      window.addEventListener("pointermove", onMoveRef.current);
      window.addEventListener("pointerup", onUpRef.current);
    },
    [handleResizeMove, handlePointerUp]
  );

  const onCanvasPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement> | PointerEvent) => {
      const isNativeEvent = !("nativeEvent" in e);
      const eventTarget = isNativeEvent
        ? ((e as PointerEvent).target as HTMLElement)
        : ((e as React.PointerEvent<HTMLElement>).target as HTMLElement);

      const pointerEvent = isNativeEvent
        ? (e as PointerEvent)
        : ((e as React.PointerEvent<HTMLElement>).nativeEvent as PointerEvent);

      // A selected frame's resize handles win even when another frame is
      // stacked over them (e.g. a wireframe selected underneath another).
      const target =
        findSelectedHandleUnderPointer(pointerEvent) ?? eventTarget;

      const hitFrame = target.closest<HTMLElement>(".canvas-frame");
      if (!hitFrame) return;
      const frame = pickWireframeUnderPointer(hitFrame, target, pointerEvent);

      const nodeKind = frame.getAttribute("data-node-kind");
      if (nodeKind === "captured") return;

      const id = frame.getAttribute("data-node-id");
      if (!id) return;

      if (editingTextNodeId === id) return;

      const rootId = useProjectStore.getState().rootId;
      if (id === rootId) return;

      if (pointerEvent.button === 2) {
        const selectedIds = useUIStore.getState().selectedIds;
        if (!selectedIds.includes(id)) {
          selectComponent(id);
        }
        return;
      }

      if (pointerEvent.button !== 0) return;

      // Capture modifier state upfront for use throughout the event lifecycle
      const isModifierActive =
        pointerEvent.shiftKey || pointerEvent.metaKey || pointerEvent.ctrlKey;

      const selectedIds = useUIStore.getState().selectedIds;
      let isAlreadySelected = selectedIds.includes(id);

      // Handle modifier key selection
      if (isModifierActive) {
        if (isAlreadySelected) {
          useUIStore.getState().removeFromSelection(id);
        } else {
          addToSelection(id);
        }
        // Don't clear selection or prevent drag - continue to drag/resize logic
        // Update isAlreadySelected for later use
        isAlreadySelected = useUIStore.getState().selectedIds.includes(id);
      } else {
        // No modifier key: if not already selected, select it (clearing previous selection)
        if (!isAlreadySelected) {
          selectComponent(id);
          isAlreadySelected = true;
        }
      }

      const INTERACTIVE_SELECTORS =
        "button, input, select, textarea, a, label, [role='button'], [role='combobox'], [role='listbox'], [role='option'], [role='menuitem'], [role='tab'], [data-active], [data-highlighted], [data-base-ui-primitive]";
      const isInteractive =
        isAlreadySelected && !!target.closest(INTERACTIVE_SELECTORS);

      const handle = target.closest<HTMLElement>("[data-direction]");
      const direction = handle?.getAttribute("data-direction");

      if (!isInteractive && document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }

      if (direction) {
        pointerEvent.preventDefault();
        startResize(pointerEvent, frame, id, direction, isModifierActive);
        pointerEvent.stopPropagation();
      } else if (isInteractive) {
        startDeferredDrag(pointerEvent, frame, id);
      } else {
        pointerEvent.preventDefault();
        startDrag(pointerEvent, frame, id, isAlreadySelected, isModifierActive);
        pointerEvent.stopPropagation();
      }
    },
    [
      selectComponent,
      addToSelection,
      startDrag,
      startDeferredDrag,
      startResize,
      editingTextNodeId,
    ]
  );

  const suppressDragStart = useCallback(
    (e: React.DragEvent) => e.preventDefault(),
    []
  );

  const onCanvasDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      const target = e.target as HTMLElement;
      const frame = target.closest<HTMLElement>(".canvas-frame");
      if (!frame) return;

      const id = frame.getAttribute("data-node-id");
      if (!id) return;

      const node = useProjectStore.getState().nodes[id];
      if (node?.type === "Text") {
        setEditingTextNodeId(id);
      }
    },
    [setEditingTextNodeId]
  );

  return {
    onCanvasPointerDown,
    onCanvasDragStart: suppressDragStart,
    onCanvasDoubleClick,
  };
}
