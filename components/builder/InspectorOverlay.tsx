"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useCanvasStore } from "@/stores/canvas-store";
import type { ProjectStore } from "@/stores/project-store";
import { useProjectStore } from "@/stores/project-store";
import { useUIStore } from "@/stores/ui-store";

interface HoverState {
  nodeId: string;
  el: Element;
  astIndex: number; // data-ast-index from the DOM
  rect: DOMRect;
  label: string;
  /** Other rendered copies of the same JSX element (e.g. from .map()). */
  copyRects: DOMRect[];
}

/**
 * InspectorOverlay
 *
 * Automatically active whenever exactly one component is selected in "build" mode.
 * Highlights internal DOM elements of the selected component on hover.
 * Clicking captures the hovered element as a Shadow Node on the canvas.
 */
export default function InspectorOverlay() {
  const selectedIds = useUIStore((state) => state.selectedIds);
  const inspectorMode = useUIStore((state) => state.inspectorMode);
  const ingestElement = useProjectStore(
    (state: ProjectStore) => state.ingestElement
  );
  const nodes = useProjectStore((state: ProjectStore) => state.nodes);
  const selectComponent = useUIStore((state) => state.selectComponent);

  const [hovered, setHovered] = useState<HoverState | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);

  // Active when inspector mode is enabled (regardless of selection)
  const isActive = inspectorMode;
  const rawActiveId = selectedIds.length === 1 ? selectedIds[0] : null;
  // Ignore stale selections whose node was removed (e.g. discarded overlays)
  const activeComponentId =
    rawActiveId && nodes[rawActiveId] ? rawActiveId : null;
  const hasSelection = activeComponentId !== null;

  /** Find the deepest rendered element under the cursor that belongs to the
   *  currently selected component — ignores builder chrome and drag handles. */
  const findCanvasComponent = useCallback(
    (clientX: number, clientY: number): HoverState | null => {
      if (!activeComponentId) return null;

      const canvas = document.querySelector("[data-canvas='true']");
      if (!canvas) return null;

      const rootId = useProjectStore.getState().rootId;
      if (activeComponentId === rootId) return null;

      const stack = document.elementsFromPoint(clientX, clientY);

      for (const el of stack) {
        // Skip builder chrome
        if (!canvas.contains(el)) continue;
        if (el === canvas) continue;

        // Whitelist: must be inside the live preview wrapper
        const livePreview = el.closest(".codex-live-preview");
        if (!livePreview) continue;

        // Skip the live preview wrapper and immediate component root element.
        let depth = 0;
        let cursor: Element | null = el;
        while (cursor && cursor !== livePreview) {
          depth++;
          cursor = cursor.parentElement;
        }
        if (depth < 1) continue;

        // Skip moveable drag/resize handles
        if (
          el.classList.contains("moveable-control") ||
          el.classList.contains("moveable-line") ||
          el.closest(".moveable-control-box")
        )
          continue;

        // Skip the component wrapper and sandbox wrappers
        if (el.hasAttribute("data-component-id")) continue;
        if (el.classList.contains("sandbox-container")) continue;

        // Must be inside the selected component's wrapper
        const wrapper = el.closest<HTMLElement>("[data-component-id]");
        if (!wrapper) continue;

        const componentId = wrapper.getAttribute("data-component-id")!;
        // Scope strictly to the selected component
        if (componentId !== activeComponentId) return null;

        const node = nodes[componentId];
        if (!node) return null;

        const rect = el.getBoundingClientRect();
        const tag = el.tagName.toLowerCase();
        const text = el.textContent?.trim().slice(0, 40);
        const label = text ? `${tag}: ${text}` : tag;

        // Read the ast-index from the DOM
        const astIndexAttr = el.getAttribute("data-ast-index");
        const astIndex = astIndexAttr ? parseInt(astIndexAttr, 10) : -1;

        // Every element rendered from the same JSX tag shares its ast-index,
        // so an edit applies to all of them. Collect the copies to show that.
        const copyRects =
          astIndex >= 0
            ? Array.from(
                wrapper.querySelectorAll(`[data-ast-index="${astIndex}"]`)
              )
                .filter((copy) => copy !== el)
                .map((copy) => copy.getBoundingClientRect())
            : [];

        return { nodeId: componentId, el, astIndex, rect, label, copyRects };
      }
      return null;
    },
    [activeComponentId, nodes]
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (
        document.body.classList.contains("is-dragging") ||
        document.body.classList.contains("is-panning") ||
        document.body.classList.contains("is-panning-mode")
      ) {
        setHovered(null);
        return;
      }

      if (rafRef.current) cancelAnimationFrame(rafRef.current);

      rafRef.current = requestAnimationFrame(() => {
        const found = findCanvasComponent(e.clientX, e.clientY);

        // Only update if the hovered element has actually changed
        setHovered((prevHovered) => {
          // If both are null, no change
          if (!found && !prevHovered) return prevHovered;
          // If one is null and the other isn't, it changed
          if (!found || !prevHovered) return found;
          // If both exist, compare nodeId and astIndex
          if (
            found.nodeId === prevHovered.nodeId &&
            found.astIndex === prevHovered.astIndex
          ) {
            return prevHovered;
          }
          // Element changed
          return found;
        });
      });
    },
    [findCanvasComponent]
  );

  const handleWheel = useCallback(() => {
    setHovered(null);
  }, []);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.code === "Space") {
      setHovered(null);
    }
  }, []);

  const handleClick = useCallback(
    (e: MouseEvent) => {
      if (!hovered || document.body.classList.contains("is-dragging")) return;
      e.preventDefault();
      e.stopPropagation();

      const container = document.querySelector(
        "[data-canvas-container='true']"
      );
      if (!container) return;
      const containerRect = container.getBoundingClientRect();
      const { panX, panY, zoom } = useCanvasStore.getState();

      const screenRect = hovered.el.getBoundingClientRect();
      const canvasRect = {
        x: (screenRect.left - containerRect.left - panX) / zoom,
        y: (screenRect.top - containerRect.top - panY) / zoom,
        w: screenRect.width / zoom,
        h: screenRect.height / zoom,
      };

      const newId = ingestElement(
        hovered.astIndex,
        canvasRect,
        hovered.label,
        hovered.nodeId
      );
      selectComponent(newId);
      setHovered(null);
    },
    [hovered, ingestElement, selectComponent]
  );

  useEffect(() => {
    if (!isActive) {
      setHovered(null);
      return;
    }

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("click", handleClick, true);
    window.addEventListener("wheel", handleWheel, { capture: true });
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("click", handleClick, true);
      window.removeEventListener("wheel", handleWheel, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isActive, handleMouseMove, handleClick, handleWheel, handleKeyDown]);

  if (!isActive) return null;

  // The highlight layer is clipped to the canvas viewport (its parent) so it
  // never draws over the sidebars; hover rects are in viewport coordinates.
  const origin = overlayRef.current?.parentElement?.getBoundingClientRect();
  const originX = origin?.left ?? 0;
  const originY = origin?.top ?? 0;

  return (
    <>
      <div
        ref={overlayRef}
        data-app-chrome="true"
        data-inspector-overlay="true"
        className="absolute inset-0 overflow-hidden pointer-events-none"
        // Above the canvas, below menus and popovers (z-50).
        style={{ zIndex: 40 }}
      >
        {hovered &&
          hasSelection &&
          hovered.copyRects.map((rect, i) => (
            <div
              key={i}
              className="absolute border-2 border-dashed border-blue-500/70"
              style={{
                left: rect.left - originX,
                top: rect.top - originY,
                width: rect.width,
                height: rect.height,
              }}
            />
          ))}
        {hovered && hasSelection && (
          <div
            className="absolute border-2 border-blue-500 transition-all duration-75"
            style={{
              left: hovered.rect.left - originX,
              top: hovered.rect.top - originY,
              width: hovered.rect.width,
              height: hovered.rect.height,
            }}
          >
            <div className="absolute -top-6 left-0 bg-blue-500 text-white text-xs px-2 py-0.5 rounded-t font-mono whitespace-nowrap">
              {hovered.label}
              {hovered.copyRects.length > 0 &&
                ` · ${hovered.copyRects.length + 1} copies`}
            </div>
          </div>
        )}
      </div>

      {/* Hint sits outside the z-9999 overlay so popovers (z-50) like the
        color picker stay above it. */}
      <div
        data-app-chrome="true"
        className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2 bg-background/90 border border-border text-foreground text-xs px-3 py-1.5 rounded-full shadow-md"
        style={{ pointerEvents: "none" }}
      >
        {hasSelection
          ? "Click to capture element"
          : "Click a component to start editing"}
      </div>
    </>
  );
}
