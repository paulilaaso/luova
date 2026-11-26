import { useRef } from "react";
import { useShadowBleed } from "@/hooks/use-shadow-bleed";
import { cn } from "@/lib/luova-utils";
import type { NodeKind, SizingMode } from "@/types/builder";

/**
 * Eight resize-handle directions mapped to the edges and corners of the
 * selection frame.  Each handle is rendered as a plain <div> with:
 *   - className="canvas-resize-handle"
 *   - data-direction={dir}
 *
 * CanvasInteractionManager listens for pointerdown on these elements
 * (via `target.closest("[data-direction]")`) and starts a direction-aware
 * resize.  All visual placement and cursors are driven by CSS attribute
 * selectors in globals.css.
 *
 * Handles are only rendered when the component is the sole selection
 * (isSelected && selectionCount === 1), which implicitly guards against
 * showing them on the root node (root is never selectable).
 */
const HANDLE_DIRECTIONS = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;

interface FrameProps {
  nodeId: string;
  nodeType?: string;
  nodeKind?: NodeKind;
  isSelected?: boolean;
  selectionCount?: number;
  style?: React.CSSProperties;
  className?: string;
  widthMode?: SizingMode;
  heightMode?: SizingMode;
  children: React.ReactNode;
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
  previewMode?: boolean;
}

export default function Frame({
  nodeId,
  nodeType,
  nodeKind,
  isSelected = false,
  selectionCount = 1,
  style,
  className,
  children,
  onClick,
  previewMode = false,
}: FrameProps) {
  const showHandles =
    isSelected && selectionCount === 1 && nodeKind !== "captured";
  const { overflow, ...outerStyle } = (style || {}) as React.CSSProperties;
  // Hidden overflow is applied as a clip-path (see .is-clipped) so content is
  // clipped at the frame edge while shadows can still bleed past it.
  const isClipped = overflow === "hidden";
  const contentRef = useRef<HTMLDivElement>(null);
  useShadowBleed(contentRef, isClipped);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Canvas frame click target; keyboard handled via global shortcuts
    // biome-ignore lint/a11y/useKeyWithClickEvents: Canvas frame click target; keyboard handled via global shortcuts
    <div
      className={cn("canvas-frame", isSelected && "is-selected", className)}
      data-node-id={nodeId}
      data-component-id={nodeId}
      data-node-type={nodeType}
      data-node-kind={nodeKind}
      data-state={isSelected ? "selected" : "idle"}
      data-preview={previewMode ? "true" : "false"}
      style={outerStyle}
      onClick={onClick}
    >
      <div
        ref={contentRef}
        className={cn("canvas-frame-content", isClipped && "is-clipped")}
        style={overflow && !isClipped ? { overflow } : undefined}
      >
        {children}
      </div>
      {showHandles &&
        HANDLE_DIRECTIONS.map((dir) => (
          <div
            key={dir}
            className="canvas-resize-handle"
            data-direction={dir}
          />
        ))}
    </div>
  );
}
