"use client";

import { MessageCircle, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { cn } from "@/lib/luova-utils";
import { getLiveCameraState } from "@/stores/canvas-store";
import { useProjectStore } from "@/stores/project-store";
import { useUIStore } from "@/stores/ui-store";
import { COMPONENT_SIZING_TRAITS, DEFAULT_PROPS } from "@/types/builder";

const ANNOTATION_W = 200;
const BUBBLE_H = 110;
const DEFAULT_ANN_X = 60;
const DEFAULT_ANN_Y = -20;
// Collapsed prompt button for captured elements, beside the element's right edge
const ICON_SIZE = 28;
const ICON_GAP = 12;

export default function AnnotationOverlay() {
  const updateAnnotationOffset = useProjectStore(
    (state) => state.updateAnnotationOffset
  );
  const updateNodeComment = useProjectStore((state) => state.updateNodeComment);
  const deleteComponent = useProjectStore((state) => state.deleteComponent);
  const discardCapturedNode = useProjectStore(
    (state) => state.discardCapturedNode
  );

  const textareaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const [dragOffsets, setDragOffsets] = useState<
    Record<string, { x: number; y: number }>
  >({});
  const measuredSizesRef = useRef<Record<string, { w: number; h: number }>>({});
  // Captured elements start as a small speech-bubble button; the full prompt
  // bubble opens only when the user asks for it.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const focusOnMountRef = useRef<string | null>(null);

  const allAnnotatedNodes = useProjectStore(
    useShallow((state) => {
      const nodes = Object.values(state.nodes).filter(
        (n) =>
          n.id !== state.rootId &&
          (n.kind === "wireframe" || n.kind === "captured")
      );
      return nodes.sort((a, b) => {
        const idxA = state.layerOrder.indexOf(a.id);
        const idxB = state.layerOrder.indexOf(b.id);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
        return a.id.localeCompare(b.id);
      });
    })
  );

  const nodes = useProjectStore((state) => state.nodes);
  const hiddenBubbleIds = useUIStore((state) => state.hiddenBubbleIds);
  const selectedIds = useUIStore((state) => state.selectedIds);

  // Captured elements that already had manual edits when this selection
  // began: the user came back to them, so their bubble shows again.
  const [selectionStart, setSelectionStart] = useState(() => ({
    ids: selectedIds,
    editedAtStart: new Set<string>(),
  }));
  if (selectionStart.ids !== selectedIds) {
    const editedAtStart = new Set<string>();
    for (const id of selectedIds) {
      const wasSelected = selectionStart.ids.includes(id);
      if (
        wasSelected
          ? selectionStart.editedAtStart.has(id)
          : nodes[id]?.capturedMetadata?.hasEdits
      ) {
        editedAtStart.add(id);
      }
    }
    setSelectionStart({ ids: selectedIds, editedAtStart });
  }

  // A captured element's AI prompt bubble steps aside once the user edits
  // the element by hand in the sidebar, and returns when they select the
  // edited element again. A typed prompt always stays visible so it isn't
  // silently lost.
  const annotatedNodes = allAnnotatedNodes.filter(
    (n) =>
      n.kind !== "captured" ||
      !n.capturedMetadata?.hasEdits ||
      (n.comment ?? "").trim().length > 0 ||
      (selectedIds.includes(n.id) && selectionStart.editedAtStart.has(n.id))
  );

  // Measure actual rendered sizes for auto-sized nodes
  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const el = entry.target as HTMLElement;
        const id = el.getAttribute("data-node-id");
        if (id) {
          const { inlineSize: w, blockSize: h } = entry.borderBoxSize[0];
          measuredSizesRef.current[id] = { w, h };
        }
      }
    });

    for (const node of allAnnotatedNodes) {
      const trackingId =
        node.kind === "captured" && node.capturedMetadata?.sourceComponentId
          ? node.capturedMetadata.sourceComponentId
          : node.id;
      const el = document.querySelector<HTMLElement>(
        `[data-node-id="${trackingId}"]`
      );
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
  }, [allAnnotatedNodes]);

  const setTextareaRef = (id: string) => (el: HTMLTextAreaElement | null) => {
    textareaRefs.current[id] = el;
    if (el && focusOnMountRef.current === id) {
      focusOnMountRef.current = null;
      el.focus();
    }
  };

  const expandBubble = (id: string) => {
    focusOnMountRef.current = id;
    setExpandedIds((prev) => new Set(prev).add(id));
  };

  if (annotatedNodes.length === 0) return null;

  const stackingCounters: Record<string, number> = {};

  return (
    <div
      className="annotation-overlay pointer-events-none absolute inset-0 overflow-visible"
      style={{ zIndex: 46 }}
    >
      {annotatedNodes.map((node) => {
        const isWireframe = node.kind === "wireframe";
        const isCaptured = node.kind === "captured";

        let trackingId = node.id;
        if (isCaptured && node.capturedMetadata?.sourceComponentId) {
          trackingId = node.capturedMetadata.sourceComponentId;
        }

        if (!stackingCounters[trackingId]) stackingCounters[trackingId] = 0;
        const stackIndex = stackingCounters[trackingId]++;

        // ── Canvas-space coordinates ──────────────────────────────────────
        // Everything here is in canvas pixels. The overlay is inside the
        // data-canvas element which already has translate3d+scale applied,
        // so we never need to touch pan/zoom ourselves.

        let originX = node.props.x;
        let originY = node.props.y;
        let targetW = node.props.w ?? 300;
        let targetH = node.props.h ?? 120;

        if (isCaptured && node.capturedMetadata?.sourceComponentId) {
          const sourceNode = nodes[node.capturedMetadata.sourceComponentId];
          if (sourceNode) {
            originX = sourceNode.props.x;
            originY = sourceNode.props.y;
            targetW = sourceNode.props.w ?? 300;
            targetH = sourceNode.props.h ?? 120;
          }
        } else if (isWireframe) {
          const defaultProps = DEFAULT_PROPS[node.type] as
            | { w?: number; h?: number }
            | undefined;
          targetW = node.props.w ?? defaultProps?.w ?? 300;
          targetH = node.props.h ?? defaultProps?.h ?? 120;
        }

        // Prefer measured DOM sizes for auto-sized nodes
        const widthMode =
          node.props.widthMode ?? COMPONENT_SIZING_TRAITS[node.type]?.widthMode;
        const heightMode =
          node.props.heightMode ??
          COMPONENT_SIZING_TRAITS[node.type]?.heightMode;
        const measured = measuredSizesRef.current[trackingId];
        if (measured) {
          if (widthMode === "auto" && measured.w > 0) targetW = measured.w;
          if (heightMode === "auto" && measured.h > 0) targetH = measured.h;
        }

        // Anchor: right-center of the node
        let anchorX = targetW;
        let anchorY = targetH / 2;

        if (isCaptured && node.capturedMetadata?.sourceComponentId) {
          const sourceNode = nodes[node.capturedMetadata.sourceComponentId];
          if (sourceNode) {
            const relX = node.props.x - sourceNode.props.x;
            const relY = node.props.y - sourceNode.props.y;
            anchorX = relX + (node.props.w ?? 0);
            anchorY = relY + (node.props.h ?? 0) / 2;
          }
        }

        // A captured element shows only the speech-bubble button until the
        // user expands it. A typed prompt always keeps the bubble open so the
        // text is never hidden.
        const isCollapsed =
          isCaptured &&
          !expandedIds.has(node.id) &&
          (node.comment ?? "").trim().length === 0;

        if (isCollapsed && hiddenBubbleIds.includes(node.id)) return null;

        if (isCollapsed) {
          const iconX = originX + anchorX + ICON_GAP;
          const iconY =
            originY + anchorY - ICON_SIZE / 2 + stackIndex * (ICON_SIZE + 8);
          const label = node.capturedMetadata?.label ?? node.type;
          return (
            <div
              key={node.id}
              data-annotation-for={trackingId}
              data-annotation-node={node.id}
              style={{ position: "absolute", left: 0, top: 0 }}
            >
              <button
                type="button"
                data-app-chrome="true"
                data-annotation-bubble="true"
                aria-label={`Describe an AI edit for ${label}`}
                title="Describe an AI edit"
                className="flex items-center justify-center rounded-full border border-muted-foreground/25 bg-background/95 text-muted-foreground shadow-md transition-colors hover:bg-muted hover:text-foreground"
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  width: `${ICON_SIZE}px`,
                  height: `${ICON_SIZE}px`,
                  transform: `translate3d(${iconX}px, ${iconY}px, 0)`,
                  pointerEvents: "auto",
                }}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  expandBubble(node.id);
                }}
              >
                <MessageCircle className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        }

        const customOffset = dragOffsets[node.id] ?? node.annotationOffset;
        let annOffsetX: number;
        let annOffsetY: number;

        if (customOffset) {
          annOffsetX = customOffset.x;
          annOffsetY = customOffset.y;
        } else {
          annOffsetX = DEFAULT_ANN_X;
          annOffsetY = DEFAULT_ANN_Y + stackIndex * (BUBBLE_H + 12);
        }

        // Bubble top-left in canvas space (relative to node origin)
        const boxX = anchorX + annOffsetX;
        const boxY = anchorY + annOffsetY;

        // Bezier end: left-center of bubble
        const endX = boxX;
        const endY = boxY + BUBBLE_H / 2;

        // Control points
        const cpOffset = Math.max(30, Math.abs(annOffsetX) * 0.5);
        const cp1X = anchorX + cpOffset;
        const cp1Y = anchorY;
        const cp2X = endX - cpOffset;
        const cp2Y = endY;

        // Absolute canvas coords for SVG anchor and bubble
        const absAnchorX = originX + anchorX;
        const absAnchorY = originY + anchorY;
        const absBubbleX = originX + boxX;
        const absBubbleY = originY + boxY;
        const absEndX = originX + endX;
        const absEndY = originY + endY;
        const absCp1X = originX + cp1X;
        const absCp1Y = originY + cp1Y;
        const absCp2X = originX + cp2X;
        const absCp2Y = originY + cp2Y;

        // SVG bounding box — tight rect around the bezier + bubble, with padding
        const pad = 20;
        const svgLeft =
          Math.min(absAnchorX, absBubbleX, absCp1X, absCp2X) - pad;
        const svgTop = Math.min(absAnchorY, absBubbleY, absCp1Y, absCp2Y) - pad;
        const svgRight =
          Math.max(absAnchorX, absBubbleX + ANNOTATION_W, absCp1X, absCp2X) +
          pad;
        const svgBottom =
          Math.max(absAnchorY, absBubbleY + BUBBLE_H, absCp1Y, absCp2Y) + pad;
        const svgW = svgRight - svgLeft;
        const svgH = svgBottom - svgTop;

        const handleHeaderPointerDown = (e: React.PointerEvent) => {
          if ((e.target as HTMLElement).tagName === "TEXTAREA") return;
          e.stopPropagation();
          e.preventDefault();
          const startX = e.clientX;
          const startY = e.clientY;
          const origX = annOffsetX;
          const origY = annOffsetY;

          const onMove = (me: PointerEvent) => {
            const zoom = getLiveCameraState().zoom;
            const dx = (me.clientX - startX) / zoom;
            const dy = (me.clientY - startY) / zoom;
            setDragOffsets((prev) => ({
              ...prev,
              [node.id]: { x: origX + dx, y: origY + dy },
            }));
          };
          const onUp = (me: PointerEvent) => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            const zoom = getLiveCameraState().zoom;
            const dx = (me.clientX - startX) / zoom;
            const dy = (me.clientY - startY) / zoom;
            updateAnnotationOffset(node.id, { x: origX + dx, y: origY + dy });
            setDragOffsets((prev) => {
              const next = { ...prev };
              delete next[node.id];
              return next;
            });
          };
          window.addEventListener("pointermove", onMove);
          window.addEventListener("pointerup", onUp);
        };

        return (
          // Positioned wrapper so the canvas drag handler can translate the
          // whole bubble + connector in lockstep with the dragged node
          // (see moveAnnotations in use-canvas-interactions).
          <div
            key={node.id}
            data-annotation-for={trackingId}
            data-annotation-node={node.id}
            style={{ position: "absolute", left: 0, top: 0 }}
          >
            {/* SVG bezier connector — sized to contain the path */}
            <svg
              style={{
                position: "absolute",
                left: `${svgLeft}px`,
                top: `${svgTop}px`,
                width: `${svgW}px`,
                height: `${svgH}px`,
                overflow: "visible",
                zIndex: 2,
                pointerEvents: "none",
                // Match the dashed box the connector comes from: blue for the
                // edit overlay (border-blue-500/70), gray for wireframes
                // (border-muted-foreground/30).
                ...(node.kind === "captured"
                  ? {
                      color:
                        "var(--color-blue-500, oklch(0.623 0.214 259.815))",
                      opacity: 0.7,
                    }
                  : {
                      color: "var(--color-muted-foreground)",
                      opacity: 0.3,
                    }),
              }}
            >
              <defs>
                <marker
                  id={`anno-arrow-${node.id}`}
                  markerWidth="6"
                  markerHeight="6"
                  refX="3"
                  refY="3"
                  orient="auto"
                >
                  <path d="M0,0 L0,6 L6,3 z" fill="currentColor" />
                </marker>
              </defs>
              <path
                d={`M ${absAnchorX - svgLeft} ${absAnchorY - svgTop} C ${absCp1X - svgLeft} ${absCp1Y - svgTop}, ${absCp2X - svgLeft} ${absCp2Y - svgTop}, ${absEndX - svgLeft} ${absEndY - svgTop}`}
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                strokeDasharray="5 3"
                markerEnd={`url(#anno-arrow-${node.id})`}
              />
            </svg>

            {/* Annotation bubble */}
            <div
              data-app-chrome="true"
              data-annotation-bubble="true"
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                zIndex: 1,
                transform: `translate3d(${absBubbleX}px, ${absBubbleY}px, 0)`,
                transformOrigin: "0 0",
                pointerEvents: "auto",
              }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <div
                className="overflow-hidden rounded-lg border border-muted-foreground/25 bg-background/95 shadow-md"
                style={{ width: `${ANNOTATION_W}px` }}
              >
                {/* Drag handle — header only */}
                <div
                  className="flex cursor-grab items-center gap-1.5 border-b border-muted-foreground/15 bg-muted/50 px-2.5 py-1.5 select-none"
                  onPointerDown={handleHeaderPointerDown}
                >
                  <span className="pointer-events-none truncate font-mono text-2xs font-medium text-muted-foreground/80">
                    {isWireframe
                      ? "Wireframe"
                      : (node.capturedMetadata?.label ?? node.type)}
                  </span>
                  <button
                    type="button"
                    className="ml-auto flex-shrink-0 cursor-pointer rounded-sm p-0.5 text-muted-foreground opacity-50 transition-[opacity,background-color] hover:bg-muted-foreground/10 hover:opacity-100"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      // Captured overlays must be discarded non-destructively;
                      // deleteComponent would delete the element from the AST.
                      if (node.kind === "captured") {
                        discardCapturedNode(node.id);
                      } else {
                        deleteComponent(node.id);
                      }
                    }}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
                {/* Comment textarea */}
                <textarea
                  ref={setTextareaRef(node.id)}
                  className={cn(
                    "w-full resize-none border-none bg-transparent p-2 text-xs outline-none scrollbar-thin",
                    "placeholder:text-muted-foreground/35 text-muted-foreground"
                  )}
                  rows={3}
                  placeholder={
                    isWireframe
                      ? "Describe what to build…"
                      : "Describe the edit…"
                  }
                  value={node.comment ?? ""}
                  style={{ cursor: "text", display: "block" }}
                  onChange={(e) => {
                    e.stopPropagation();
                    updateNodeComment(node.id, e.target.value);
                  }}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    e.nativeEvent.stopPropagation();
                  }}
                  onKeyUp={(e) => {
                    e.stopPropagation();
                    e.nativeEvent.stopPropagation();
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  spellCheck={false}
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
