"use client";

import dynamic from "next/dynamic";
import { useCallback, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { Card, CardContent, CardHeader } from "@/components/luova-ui/card";
import { Skeleton } from "@/components/luova-ui/skeleton";
import { cn } from "@/lib/luova-utils";
import { useAiStore } from "@/stores/ai-store";
import type { ProjectStore } from "@/stores/project-store";
import { useProjectStore } from "@/stores/project-store";
import {
  createLayerIndexMap,
  normalizeLayerOrder,
} from "@/stores/slices/canvas-hierarchy-slice";
import { useUIStore } from "@/stores/ui-store";
import { COMPONENT_SIZING_TRAITS, DEFAULT_PROPS } from "@/types/builder";
import { isGradientValue } from "@/utils/color-converter";
import { ALIGNMENT_CLASSES } from "@/utils/content-alignment";
import { BrokenNodeFallback } from "./CanvasErrorFallback";
import Frame from "./DraggableComponent";
import { LiveErrorBoundary } from "./ErrorBoundary";
import LiveTextEditor from "./LiveTextEditor";

const DynamicRenderer = dynamic(() => import("./DynamicRenderer"), {
  ssr: false,
  loading: () => <div className="w-full h-full bg-muted/10 animate-pulse" />,
});

interface CanvasRendererProps {
  nodeId: string;
  layerIndex?: number;
  /** Force preview interaction mode (bypasses UI store) */
  previewMode?: boolean;
}

const selectRootLayerPlan = (state: ProjectStore) => {
  const { orderedIds } = createLayerIndexMap(
    state.layerOrder,
    state.nodes,
    state.rootId
  );
  return orderedIds;
};

function CanvasRendererComponent({
  nodeId,
  layerIndex: providedLayerIndex,
  previewMode: previewModeProp,
}: CanvasRendererProps) {
  const node = useProjectStore((state: ProjectStore) => state.nodes[nodeId]);
  const rootId = useProjectStore((state: ProjectStore) => state.rootId);
  const selectedIds = useUIStore((state) => state.selectedIds);
  const storePreviewMode = useUIStore((state) => state.previewMode);
  const previewMode = previewModeProp ?? storePreviewMode;

  // Compute visibility state for isolated preview
  const filteredSelectedIds = selectedIds.filter((id) => id !== rootId);
  const hasValidSelection = previewMode && filteredSelectedIds.length > 0;
  const isHiddenInPreview =
    hasValidSelection && !filteredSelectedIds.includes(nodeId);

  const componentIds = useProjectStore(
    useShallow((state: ProjectStore) =>
      nodeId === state.rootId ? selectRootLayerPlan(state) : []
    )
  );
  const isSelected = selectedIds.includes(nodeId);
  const selectionCount = selectedIds.length;
  const selectComponent = useUIStore((state) => state.selectComponent);
  const layerIndex = useProjectStore(
    (state: ProjectStore) =>
      providedLayerIndex ??
      normalizeLayerOrder(state.layerOrder, state.nodes, state.rootId).indexOf(
        nodeId
      )
  );
  const reportRuntimeError = useAiStore((state) => state.reportRuntimeError);
  const editingTextNodeId = useUIStore((state) => state.editingTextNodeId);
  const isEditing = editingTextNodeId === nodeId;
  const renderCode = node?.code ?? "";

  const handleRuntimeError = useCallback(
    (error: string) => {
      reportRuntimeError(nodeId, error, renderCode);
    },
    [nodeId, reportRuntimeError, renderCode]
  );

  const handleSelectClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!previewMode) {
        e.stopPropagation();
        selectComponent(nodeId);
      }
    },
    [nodeId, previewMode, selectComponent]
  );

  const skeletonWidths = useMemo(
    () => ({
      title: `${50 + Math.floor(Math.random() * 40)}%`,
      subtitle: `${30 + Math.floor(Math.random() * 40)}%`,
      text1: `${60 + Math.floor(Math.random() * 40)}%`,
      text2: `${40 + Math.floor(Math.random() * 40)}%`,
      text3: `${20 + Math.floor(Math.random() * 40)}%`,
    }),
    []
  );

  if (!node) {
    return null;
  }

  // Defensive: historical / AI-produced records may miss `type` or `props`
  // (persisted before validation). Coerce instead of crashing the canvas.
  const nodeType =
    typeof node.type === "string" && node.type.trim() !== ""
      ? node.type
      : "Container";
  if (nodeType !== node.type && process.env.NODE_ENV === "development") {
    console.warn(
      `[CanvasRenderer] Node ${nodeId} missing type — fell back to "Container".`
    );
  }

  const { x, y, w, h } = node.props ?? { x: 0, y: 0 };
  const nodeProps = node.props ?? { x: 0, y: 0 };
  const { alignment, wrapperBg, wrapperShadow } = nodeProps;
  // alignment is destructured but not used directly — kept for prop-spreading exclusion
  const {
    x: _x,
    y: _y,
    w: _w,
    h: _h,
    positionType: _positionType,
    widthMode: _widthMode,
    heightMode: _heightMode,
    wrapperBg: _wrapperBg,
    wrapperShadow: _wrapperShadow,
    ...contentProps
  } = nodeProps;

  if (nodeId === rootId) {
    return (
      <div className="w-full h-full relative">
        {componentIds.map((id, index) => (
          <LiveErrorBoundary
            key={id}
            resetOnChange={id}
            fallback={(error) => (
              <BrokenNodeFallback nodeId={id} error={error} />
            )}
          >
            <CanvasRendererComponent nodeId={id} layerIndex={index} />
          </LiveErrorBoundary>
        ))}
      </div>
    );
  }

  const disableInteraction = !previewMode && !isSelected;
  const alignmentClass = alignment ? ALIGNMENT_CLASSES[alignment] : undefined;

  const isWireframe = node.kind === "wireframe";
  const isCaptured = node.kind === "captured";
  const isDraft = node.kind === "draft";

  // In preview mode, never show selection handles
  const effectiveIsSelected = !previewMode && isSelected;

  const defaultProps = DEFAULT_PROPS[nodeType] as Record<string, unknown>;
  const defaultW =
    typeof defaultProps?.w === "number" ? defaultProps.w : undefined;
  const defaultH =
    typeof defaultProps?.h === "number" ? defaultProps.h : undefined;

  const traits = COMPONENT_SIZING_TRAITS[nodeType];
  const effectiveWidthMode =
    nodeProps.widthMode ?? traits?.widthMode ?? "fixed";
  const effectiveHeightMode =
    nodeProps.heightMode ?? traits?.heightMode ?? "fixed";

  const hasGradientBorder = Object.entries(contentProps).some(
    ([key, value]) => {
      if (typeof value !== "string" || !isGradientValue(value)) return false;
      const k = key.toLowerCase();
      return (
        k.includes("border") || k.endsWith("bg") || k.endsWith("background")
      );
    }
  );

  const extraProps = {
    ...(hasGradientBorder ? { "data-gradient-border": "true" } : {}),
  };

  const hasEdits = node.capturedMetadata?.hasEdits;

  const capturedContent =
    isCaptured && !isSelected && !hasEdits ? (
      // Click target only: CapturedCopiesOverlay draws its outline, the same
      // one as while selected.
      // biome-ignore lint/a11y/noStaticElementInteractions: Captured node overlay — a <button> would break HTML nesting rules inside the canvas
      // biome-ignore lint/a11y/useKeyWithClickEvents: Captured node overlay; keyboard handled via global canvas shortcuts
      <div
        className="relative w-full h-full pointer-events-auto"
        onClick={handleSelectClick}
      />
    ) : null;

  if (isCaptured && !isSelected && hasEdits) {
    return null;
  }

  const componentContent = isDraft ? (
    <Card className="w-full h-full overflow-hidden flex flex-col">
      <CardHeader>
        <Skeleton className="h-4" style={{ width: skeletonWidths.title }} />
        <Skeleton className="h-3" style={{ width: skeletonWidths.subtitle }} />
      </CardHeader>
      <CardContent className="flex flex-col gap-3 flex-1">
        <Skeleton className="flex-1 w-full" />
        <Skeleton className="h-3" style={{ width: skeletonWidths.text1 }} />
        <Skeleton className="h-3" style={{ width: skeletonWidths.text2 }} />
        <Skeleton className="h-3" style={{ width: skeletonWidths.text3 }} />
      </CardContent>
    </Card>
  ) : isWireframe && renderCode.trim() === "" ? (
    previewMode ? null : (
      <div className="wireframe-placeholder absolute inset-0 overflow-visible border-2 border-dashed border-muted-foreground/30 rounded-none" />
    )
  ) : isCaptured ? (
    capturedContent || <div className="w-full h-full pointer-events-none" />
  ) : (
    // biome-ignore lint/a11y/noStaticElementInteractions: Canvas click target; keyboard selection handled via global spatial shortcuts
    // biome-ignore lint/a11y/useKeyWithClickEvents: Canvas click target; keyboard selection handled via global spatial shortcuts
    <div
      className={cn(
        "relative w-full h-full flex sandbox-container",
        !previewMode && "pointer-events-auto"
      )}
      style={{ transformStyle: "flat" }}
      data-ai-type={nodeType.toLowerCase()}
      onClick={handleSelectClick}
    >
      <div
        className="w-full h-full contain-strict"
        style={{ contain: "layout style" }}
      >
        {isEditing ? (
          <LiveTextEditor
            nodeId={nodeId}
            code={renderCode}
            className={cn("w-full h-full", alignmentClass)}
          />
        ) : (
          <DynamicRenderer
            code={renderCode}
            props={{ ...contentProps, ...extraProps }}
            fillContainer={true}
            alignmentClass={alignmentClass}
            className={cn(
              "w-full h-full",
              disableInteraction && "pointer-events-none"
            )}
            showErrors={!previewMode}
            onRuntimeError={handleRuntimeError}
            nodeId={nodeId}
          />
        )}
      </div>
    </div>
  );

  const style = {
    position: "absolute" as const,
    left: `${x}px`,
    top: `${y}px`,
    width:
      effectiveWidthMode === "auto"
        ? "max-content"
        : w !== undefined
          ? `${w}px`
          : defaultW !== undefined
            ? `${defaultW}px`
            : "max-content",
    height:
      effectiveHeightMode === "auto"
        ? "max-content"
        : h !== undefined
          ? `${h}px`
          : defaultH !== undefined
            ? `${defaultH}px`
            : "max-content",
    zIndex: 10 + (layerIndex >= 0 ? layerIndex + 1 : 0),
    isolation: "isolate" as const,
    display: isHiddenInPreview ? "none" : undefined,
    ...(wrapperBg ? { background: wrapperBg } : {}),
    ...(wrapperShadow && wrapperShadow !== "none"
      ? { boxShadow: wrapperShadow }
      : {}),
    ...(effectiveWidthMode === "fixed" && effectiveHeightMode === "fixed"
      ? { overflow: "hidden" as const }
      : {}),
  } as React.CSSProperties;

  return (
    <Frame
      nodeId={node.id}
      nodeType={nodeType}
      nodeKind={node.kind}
      isSelected={effectiveIsSelected}
      selectionCount={selectionCount}
      style={style}
      widthMode={effectiveWidthMode}
      heightMode={effectiveHeightMode}
      previewMode={previewMode}
    >
      {componentContent}
    </Frame>
  );
}

export default CanvasRendererComponent;
