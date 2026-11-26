"use client";

import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useProjectStore } from "@/stores/project-store";
import { useUIStore } from "@/stores/ui-store";

type Box = {
  left: number;
  top: number;
  width: number;
  height: number;
  /** Canvas-space border width: scales with zoom, like the connector line. */
  borderWidth: number;
};

const sameBoxes = (a: Box[], b: Box[]) =>
  a.length === b.length &&
  a.every(
    (box, i) =>
      box.left === b[i].left &&
      box.top === b[i].top &&
      box.width === b[i].width &&
      box.height === b[i].height &&
      box.borderWidth === b[i].borderWidth
  );

/**
 * While a captured element is selected, outlines every rendered copy of it
 * (elements sharing its ast-index, e.g. from .map()), since an edit to the
 * captured element changes all of them. This outline replaces the frame's
 * own selection outline for captured elements.
 *
 * Unselected captured elements that haven't been edited keep the same
 * outline (drawn here too, so it matches exactly at every zoom level); their
 * frame in CanvasRenderer is only the click target.
 */
export default function CapturedCopiesOverlay() {
  const selectedIds = useUIStore((state) => state.selectedIds);
  const selectedId = selectedIds.length === 1 ? selectedIds[0] : null;
  const metadata = useProjectStore((state) => {
    const node = selectedId ? state.nodes[selectedId] : undefined;
    return node?.kind === "captured" ? node.capturedMetadata : undefined;
  });
  const sourceId = metadata?.sourceComponentId;
  const astIndex = metadata?.astIndex;
  const idleIds = useProjectStore(
    useShallow((state) =>
      Object.values(state.nodes)
        .filter(
          (node) =>
            node.kind === "captured" &&
            !node.capturedMetadata?.hasEdits &&
            !selectedIds.includes(node.id)
        )
        .map((node) => node.id)
    )
  );

  const [boxes, setBoxes] = useState<Box[]>([]);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const hasSelectedCopies = !!sourceId && astIndex !== undefined;
    if (!hasSelectedCopies && idleIds.length === 0) {
      setBoxes([]);
      return;
    }
    // Track positions every frame so outlines follow pan, zoom and edits.
    let frame = 0;
    const update = () => {
      const wrapper = hasSelectedCopies
        ? document.querySelector(
            `[data-canvas='true'] [data-component-id="${CSS.escape(sourceId as string)}"]`
          )
        : null;
      const copies: Element[] = wrapper
        ? Array.from(
            wrapper.querySelectorAll(
              `[data-ast-index="${CSS.escape(astIndex as string)}"]`
            )
          )
        : [];
      for (const id of idleIds) {
        const frame = document.querySelector(
          `[data-canvas='true'] .canvas-frame[data-node-id="${CSS.escape(id)}"]`
        );
        if (frame) copies.push(frame);
      }
      // Positions are in canvas coordinates: the overlay lives inside the
      // zoomed canvas, just below the prompt bubbles (AnnotationOverlay).
      const canvas = overlayRef.current?.parentElement;
      const origin = canvas?.getBoundingClientRect();
      // Read the scale from the transform these rects were measured under, so
      // outlines sit exactly on the elements while zooming (no frame lag).
      const zoom = canvas
        ? new DOMMatrixReadOnly(getComputedStyle(canvas).transform).a || 1
        : 1;
      const next: Box[] = origin
        ? copies.map((copy) => {
            const r = copy.getBoundingClientRect();
            return {
              left: (r.left - origin.left) / zoom,
              top: (r.top - origin.top) / zoom,
              width: r.width / zoom,
              height: r.height / zoom,
              // Same as the prompt connector's strokeWidth (AnnotationOverlay)
              borderWidth: 1.5,
            };
          })
        : [];
      setBoxes((prev) => (sameBoxes(prev, next) ? prev : next));
      frame = requestAnimationFrame(update);
    };
    update();
    return () => cancelAnimationFrame(frame);
  }, [sourceId, astIndex, idleIds]);

  return (
    <div
      ref={overlayRef}
      data-app-chrome="true"
      className="absolute inset-0 overflow-visible pointer-events-none"
      style={{ zIndex: 45 }}
    >
      {boxes.map((box, i) => (
        <div
          key={i}
          className="absolute border-dashed border-blue-500/70"
          style={box}
        />
      ))}
    </div>
  );
}
