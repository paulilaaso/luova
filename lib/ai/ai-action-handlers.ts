import { cleanComponentCode } from "@/lib/ai/code-cleaner";
import type { AppStore } from "@/stores/app-store";
import { useAppStore } from "@/stores/app-store";
import { useCanvasStore } from "@/stores/canvas-store";
import type { UIStore } from "@/stores/ui-store";
import { useUIStore } from "@/stores/ui-store";

import type {
  AiPendingAction,
  AiPendingAddComponentAction,
  AiPendingDraftLayoutAction,
  AiPendingUpdateComponentCodeAction,
  AiThemePatch,
} from "@/types/ai";
import type {
  ComponentNodeAny,
  ComponentType,
  GridConfig,
} from "@/types/builder";
import {
  COMPONENT_SIZING_TRAITS,
  getDefaultComponentSize,
} from "@/types/builder";
import { calculateAestheticPlacement } from "@/utils/spatial-engine";
import { applyThemePatch, mergeThemePatches } from "./theme";

export interface ActionContext {
  appStore: AppStore;
  uiStore: UIStore;
  gridConfig: GridConfig;
  viewport: {
    panX: number;
    panY: number;
    zoom: number;
    viewportW: number;
    viewportH: number;
  };
  lastPlacedBox: { x: number; y: number; w: number; h: number } | null;
  lastCreatedId: string | null;
  /**
   * Every node id created by `add_component` during this batch (brand new
   * nodes and in-place draft/wireframe fulfillments). The orchestrator uses
   * the full list to center the camera on the generated cluster.
   */
  createdNodeIds: string[];
  /** Draft ids already fulfilled in this batch — prevents N identical-coordinate adds from re-matching the same skeleton. */
  consumedDraftIds: Set<string>;
}

export interface ActionHandler<T extends AiPendingAction> {
  execute(action: T, context: ActionContext): void;
}

export type ActionHandlerAny = ActionHandler<AiPendingAction>;

/**
 * Collects ALL descendant wireframe ids under `rootId` (recursive walk
 * through `children` arrays). Used for cascade deletion when a parent
 * container wireframe is fulfilled as a single composite component.
 */
export function collectDescendantWireframes(
  nodes: Record<string, ComponentNodeAny>,
  rootId: string
): string[] {
  const result: string[] = [];
  const stack: string[] = [...(nodes[rootId]?.children ?? [])];
  const visited = new Set<string>();
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const node = nodes[id];
    if (!node) continue;
    if (node.kind === "wireframe") result.push(id);
    if (node.children && node.children.length > 0) {
      stack.push(...node.children);
    }
  }
  return result;
}

/**
 * Computes the set of wireframe ids the AI is allowed to consume: the
 * selected wireframe roots (walking up through wireframe ancestors so that
 * selecting a nested child arms its topmost container — mirroring the
 * context snapshot) plus every recursive descendant beneath those roots.
 * Wireframes outside this set are inert and must never be deleted by
 * fulfillment cleanup.
 */
export function collectArmedWireframeIds(
  nodes: Record<string, ComponentNodeAny>,
  selectedIds: string[]
): Set<string> {
  const armed = new Set<string>();
  const roots = new Set<string>();
  for (const id of selectedIds) {
    let current = nodes[id];
    if (!current || current.kind !== "wireframe") continue;
    while (
      current.parentId != null &&
      nodes[current.parentId]?.kind === "wireframe"
    ) {
      current = nodes[current.parentId]!;
    }
    roots.add(current.id);
  }
  for (const root of roots) {
    armed.add(root);
    for (const desc of collectDescendantWireframes(nodes, root)) {
      armed.add(desc);
    }
  }
  return armed;
}

/**
 * Spatial fallback: finds wireframes geometrically contained within
 * `parentRect` (e.g. when hierarchy `children` arrays are stale). The
 * parent itself is excluded via `excludeIds`.
 */
export function findSpatiallyContainedWireframes(
  nodes: Record<string, ComponentNodeAny>,
  parentRect: { x: number; y: number; w: number; h: number },
  excludeIds: Set<string> = new Set()
): string[] {
  const TOL = 5;
  const result: string[] = [];
  for (const node of Object.values(nodes)) {
    if (node.kind !== "wireframe") continue;
    if (excludeIds.has(node.id)) continue;
    const cx = node.props.x ?? 0;
    const cy = node.props.y ?? 0;
    const cw = node.props.w ?? 0;
    const ch = node.props.h ?? 0;
    if (
      cx >= parentRect.x - TOL &&
      cy >= parentRect.y - TOL &&
      cx + cw <= parentRect.x + parentRect.w + TOL &&
      cy + ch <= parentRect.y + parentRect.h + TOL
    ) {
      result.push(node.id);
    }
  }
  return result;
}

/**
 * Deletes all nested child wireframes owned by `parentId`: first via the
 * recorded `children` subtree (recursive), then via spatial containment
 * fallback for any orphaned wireframes inside the parent's bounds.
 */
function deleteNestedChildWireframes(
  appStore: AppStore,
  parentId: string,
  parentRect?: { x: number; y: number; w: number; h: number }
): void {
  const freshNodes = useAppStore.getState().nodes as Record<
    string,
    ComponentNodeAny
  >;
  const viaHierarchy = collectDescendantWireframes(freshNodes, parentId);
  const toDelete = new Set<string>(viaHierarchy);
  if (parentRect) {
    const exclude = new Set<string>([parentId, ...viaHierarchy]);
    for (const id of findSpatiallyContainedWireframes(
      freshNodes,
      parentRect,
      exclude
    )) {
      toDelete.add(id);
    }
  }
  if (toDelete.size > 0) {
    appStore.deleteComponents([...toDelete]);
  }
}

function buildActionContext(): ActionContext {
  const uiStore = useUIStore.getState();
  const appStore = useAppStore.getState();
  const canvasStore = useCanvasStore.getState();

  return {
    appStore,
    uiStore,
    gridConfig: canvasStore.gridConfig,
    viewport: {
      panX: canvasStore.panX,
      panY: canvasStore.panY,
      zoom: canvasStore.zoom,
      viewportW: typeof window !== "undefined" ? window.innerWidth : 1200,
      viewportH: typeof window !== "undefined" ? window.innerHeight : 800,
    },
    lastPlacedBox: null,
    lastCreatedId: null,
    createdNodeIds: [],
    consumedDraftIds: new Set<string>(),
  };
}

function resolveAddComponentPlacement(
  action: AiPendingAddComponentAction,
  ctx: ActionContext
): { x: number; y: number } {
  const { appStore, gridConfig, viewport } = ctx;
  const { w, h } = action.size
    ? {
        w: action.size.w ?? getDefaultComponentSize(action.componentType).w,
        h: action.size.h ?? getDefaultComponentSize(action.componentType).h,
      }
    : getDefaultComponentSize(action.componentType);

  const requestedX = action.position?.x;
  const requestedY = action.position?.y;
  const hasExplicitCoords = requestedX != null && requestedY != null;

  if (hasExplicitCoords) {
    // Keep requested coordinates for draft matching and relative layout.
    // The orchestrator relocates the complete new cluster after fulfillment.
    return { x: requestedX!, y: requestedY! };
  }

  if (ctx.lastPlacedBox) {
    const snap = (v: number) =>
      gridConfig.snapToGrid && gridConfig.gridSize > 0
        ? Math.round(v / gridConfig.gridSize) * gridConfig.gridSize
        : v;
    return {
      x: snap(ctx.lastPlacedBox.x + ctx.lastPlacedBox.w + 40),
      y: snap(ctx.lastPlacedBox.y),
    };
  }

  const selectedIds = ctx.uiStore.selectedIds;
  const pos = calculateAestheticPlacement({
    nodes: useAppStore.getState().nodes,
    rootId: appStore.rootId,
    selectedIds,
    incomingW: w,
    incomingH: h,
    viewport: {
      panX: viewport.panX,
      panY: viewport.panY,
      zoom: viewport.zoom,
      viewportW: viewport.viewportW,
      viewportH: viewport.viewportH,
    },
    gridConfig,
  });

  return { x: pos.x, y: pos.y };
}

export const AddComponentHandler: ActionHandler<AiPendingAddComponentAction> = {
  execute(action, context) {
    const { appStore } = context;
    // componentType is optional in the tool schema — fall back so a missing
    // type can never produce a typeless (crashing) node.
    const safeType = (
      typeof action.componentType === "string" &&
      action.componentType.trim() !== ""
        ? action.componentType
        : "Container"
    ) as ComponentType;
    const { w, h } = action.size
      ? {
          w: action.size.w ?? getDefaultComponentSize(safeType).w,
          h: action.size.h ?? getDefaultComponentSize(safeType).h,
        }
      : getDefaultComponentSize(safeType);

    const { x, y } = resolveAddComponentPlacement(action, context);

    // Phase 2 fulfillment: prefer an explicit draft placeholder id when the
    // agent supplies one (deterministic, no coordinate drift). Fall back to
    // the coordinate-proximity match for agents that only repeat x/y.
    // NOTE: always read LIVE store state here — context.appStore.nodes is a
    // snapshot from before the batch, so drafts created earlier in the SAME
    // batch (draft_layout + add_components together) would otherwise be
    // invisible and every add would orphan its skeleton as a fresh node.
    const explicitDraftId = action.draftId;
    let draftNode: ComponentNodeAny | undefined;
    let draftIsWireframe = false;
    const liveNodes = () =>
      Object.values(
        useAppStore.getState().nodes as Record<string, ComponentNodeAny>
      ) as ComponentNodeAny[];
    if (explicitDraftId && !context.consumedDraftIds.has(explicitDraftId)) {
      const candidate = liveNodes().find((n) => n.id === explicitDraftId);
      if (candidate && candidate.kind === "draft") {
        draftNode = candidate;
      } else if (candidate && candidate.kind === "wireframe") {
        draftNode = candidate;
        draftIsWireframe = true;
      }
    }
    if (!draftNode) {
      // Phase 2 fulfillment: if a draft node exists at (or very near) these
      // coordinates, fulfill it in-place instead of creating a new node.
      // Consumed ids from this batch are skipped so N adds at identical
      // coordinates distribute round-robin instead of all hitting the first
      // skeleton and orphaning the rest.
      const COORD_TOLERANCE = 20; // px — accounts for LLM rounding drift and grid snapping
      const candidates = liveNodes().filter(
        (n) =>
          n.kind === "draft" &&
          !context.consumedDraftIds.has(n.id) &&
          Math.abs(n.props.x - x) <= COORD_TOLERANCE &&
          Math.abs(n.props.y - y) <= COORD_TOLERANCE
      );
      // Nearest-first so drift resolves deterministically.
      candidates.sort(
        (a, b) =>
          Math.abs(a.props.x - x) +
          Math.abs(a.props.y - y) -
          (Math.abs(b.props.x - x) + Math.abs(b.props.y - y))
      );
      draftNode = candidates[0];
    }

    if (draftNode) {
      context.consumedDraftIds.add(draftNode.id);
      const cleanedCode = cleanComponentCode(action.code);
      // Capture parent bounds BEFORE mutation for nested-child cascade below.
      // The original coordinate position and drawn dimensions are the source
      // of truth — fulfilling in place must never cause spatial jumping.
      const originalX = draftNode.props.x;
      const originalY = draftNode.props.y;
      const originalW = draftNode.props.w;
      const originalH = draftNode.props.h;
      const fulfillRect = draftIsWireframe
        ? {
            x: originalX,
            y: originalY,
            w: originalW ?? w,
            h: originalH ?? h,
          }
        : undefined;
      appStore.updateComponentCode(draftNode.id, cleanedCode);
      if (action.componentType) {
        appStore.updateComponentType(
          draftNode.id,
          action.componentType as ComponentType
        );
      }
      // Only honor explicit refined dimensions that exceed the original
      // footprint — never shrink a drawn frame to smaller AI-provided or
      // component-type default sizes.
      if (action.size?.w != null || action.size?.h != null) {
        const current = useAppStore.getState().nodes[draftNode.id];
        const currentW = current?.props.w ?? originalW ?? w;
        const currentH = current?.props.h ?? originalH ?? h;
        const nextW = Math.max(
          action.size?.w ?? currentW,
          originalW ?? 0,
          currentW
        );
        const nextH = Math.max(
          action.size?.h ?? currentH,
          originalH ?? 0,
          currentH
        );
        if (nextW !== currentW || nextH !== currentH) {
          appStore.setComponentSize(draftNode.id, nextW, nextH);
        }
      } else if (draftIsWireframe) {
        // No explicit size: reconcile any trait-promotion shrinkage by
        // restoring the drawn bounding box as the active minimum.
        const current = useAppStore.getState().nodes[draftNode.id];
        if (current) {
          const needW =
            originalW != null &&
            (typeof current.props.w !== "number" ||
              current.props.w < originalW);
          const needH =
            originalH != null &&
            (typeof current.props.h !== "number" ||
              current.props.h < originalH);
          if (needW || needH) {
            appStore.setComponentSize(
              draftNode.id,
              needW ? originalW! : (current.props.w ?? originalW ?? w),
              needH ? originalH! : (current.props.h ?? originalH ?? h)
            );
          }
        }
      }
      // Cascade: fulfilling a parent wireframe consumes its entire nested
      // subtree — delete all descendant child wireframes (plus any spatially
      // contained orphans) in the same atomic batch.
      if (draftIsWireframe) {
        deleteNestedChildWireframes(appStore, draftNode.id, fulfillRect);
      }
      context.lastPlacedBox = { x, y, w, h };
      context.lastCreatedId = draftNode.id;
      context.createdNodeIds.push(draftNode.id);
      return;
    }

    context.lastPlacedBox = { x, y, w, h };
    const newId = appStore.addComponent(
      safeType,
      { x, y },
      action.code,
      action.size
    );
    context.lastCreatedId = newId;
    context.createdNodeIds.push(newId);
  },
};

export const UpdateComponentCodeHandler: ActionHandler<AiPendingUpdateComponentCodeAction> =
  {
    execute(action, context) {
      const { appStore } = context;
      // Defensively remap a captured overlay target to its source component.
      // Captured nodes hold no code of their own, so updates must apply to
      // the parent component the element was captured from.
      let targetId = action.targetId;
      const requestedNode = appStore.nodes[targetId];
      if (
        requestedNode?.kind === "captured" &&
        requestedNode.capturedMetadata?.sourceComponentId
      ) {
        targetId = requestedNode.capturedMetadata.sourceComponentId;
        action.targetId = targetId;
      }
      if (!appStore.nodes[targetId]) {
        return;
      }

      // Capture the wireframe's drawn bounds BEFORE mutation so fulfillment
      // can preserve them as minimum dimensions.
      const wasWireframe = requestedNode?.kind === "wireframe";
      const drawnW =
        typeof requestedNode?.props.w === "number"
          ? requestedNode.props.w
          : undefined;
      const drawnH =
        typeof requestedNode?.props.h === "number"
          ? requestedNode.props.h
          : undefined;

      // NOTE: action.code is the fully resolved component code.
      // If diffs were used, they were validated and applied server-side.
      // If the AI provided raw code, it's passed through as-is.
      // The frontend never applies diffs—validation errors are caught during the
      // pending action phase and marked with validationError.
      const cleanedCode = cleanComponentCode(action.code);
      appStore.updateComponentCode(targetId, cleanedCode);

      if (action.componentType) {
        appStore.updateComponentType(targetId, action.componentType);
      }

      // When a wireframe is fulfilled with code, promote it to a regular component.
      // Update width/height modes per the generated component type's sizing
      // traits while preserving the user's drawn w/h as minimum dimensions —
      // otherwise a 600x400 wireframe fulfilled as an auto-sized type would
      // collapse to arbitrary defaults and lose its wireframed structure.
      // (Note: updateComponentCode in the store may already have promoted the
      // kind and stripped w/h for auto traits, so restore from drawnW/drawnH.)
      if (
        wasWireframe ||
        useAppStore.getState().nodes[targetId]?.kind === "wireframe"
      ) {
        const freshType =
          action.componentType ?? useAppStore.getState().nodes[targetId]?.type;
        const traits = freshType
          ? (COMPONENT_SIZING_TRAITS[freshType] ?? {
              widthMode: "auto",
              heightMode: "auto",
            })
          : undefined;
        useAppStore.setState((state) => {
          const node = state.nodes[targetId];
          if (node) {
            node.kind = "generated";
            if (traits) {
              if (node.props.widthMode !== traits.widthMode) {
                node.props.widthMode = traits.widthMode;
              }
              if (node.props.heightMode !== traits.heightMode) {
                node.props.heightMode = traits.heightMode;
              }
            }
            if (
              drawnW != null &&
              (typeof node.props.w !== "number" || node.props.w < drawnW)
            ) {
              node.props.w = drawnW;
            }
            if (
              drawnH != null &&
              (typeof node.props.h !== "number" || node.props.h < drawnH)
            ) {
              node.props.h = drawnH;
            }
            state.pendingVersion++;
          }
        });
      }

      // Fix AI baking resulting in editable Text components
      // When merging multiple components, if the target is a Text node and no explicit
      // componentType was provided by AI, convert to Container to prevent double-click editing
      const isBakeOperation =
        action.bakedSourceIds && action.bakedSourceIds.length > 1;
      if (
        isBakeOperation &&
        !action.componentType &&
        useAppStore.getState().nodes[targetId]?.type === "Text"
      ) {
        appStore.updateComponentType(targetId, "Container");
      }

      // Clean up child wireframes when a parent wireframe is fulfilled.
      // The parent now embeds the entire nested subtree as internal JSX, so
      // every descendant wireframe (recursive) is consumed. Spatial fallback
      // catches orphans whose `children` links are stale. Capture bounds from
      // the pre-mutation drawn size (preserved above as minimum dimensions).
      if (wasWireframe) {
        deleteNestedChildWireframes(
          appStore,
          targetId,
          drawnW != null && drawnH != null
            ? {
                x: requestedNode?.props.x ?? 0,
                y: requestedNode?.props.y ?? 0,
                w: drawnW,
                h: drawnH,
              }
            : undefined
        );
      }

      // The edit has been applied to the source component, so any captured
      // element overlays for it are stale (dashed border would linger and the
      // recorded AST index is now invalid). Discard them non-destructively —
      // never via deleteComponents, which would delete code from the AST.
      const discarded = appStore.discardCapturedNodesBySourceId(targetId) ?? [];
      if (discarded.length > 0) {
        const liveSelected = useUIStore.getState().selectedIds;
        if (discarded.some((id) => liveSelected.includes(id))) {
          // Smoothly transition selection from the transient overlay to the
          // updated parent component itself.
          useUIStore.getState().selectComponent(targetId);
        }
      }

      // Note: Bake mode cleanup (deletion of bakedSourceIds) is now handled at the
      // orchestrator level in applyAiActions() to ensure it happens after all actions complete,
      // regardless of which tools the AI used (draft_layout, add_component, or update_component_code)
    },
  };

/**
 * Phase 1 handler: batch-creates draft skeleton nodes on the canvas.
 * The returned IDs are stored on the action so downstream update_component_code
 * calls can target them by index when the AI fulfills each component.
 */
export const DraftLayoutHandler: ActionHandler<AiPendingDraftLayoutAction> = {
  execute(action, context) {
    const { appStore } = context;
    const ids = appStore.addSkeletonComponents(action.components);
    // Attach the generated IDs back onto the action so the orchestrator can
    // map each planned component to its canvas node ID for fulfillment.
    (
      action as AiPendingDraftLayoutAction & { generatedIds?: string[] }
    ).generatedIds = ids;
  },
};

export const ACTION_HANDLERS: Record<string, ActionHandlerAny> = {
  add_component: AddComponentHandler,
  update_component_code: UpdateComponentCodeHandler,
  draft_layout: DraftLayoutHandler,
};

export function applyThemeFromPatch(
  appStore: AppStore,
  patch: AiThemePatch
): void {
  const nextThemeState = applyThemePatch(appStore.themeState, patch);
  appStore.setThemeState(nextThemeState);
}

export { buildActionContext, mergeThemePatches };
