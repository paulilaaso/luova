import { v4 as uuidv4 } from "uuid";
import {
  ACTION_HANDLERS,
  applyThemeFromPatch,
  buildActionContext,
  collectArmedWireframeIds,
  collectDescendantWireframes,
  findSpatiallyContainedWireframes,
  mergeThemePatches,
} from "@/lib/ai/ai-action-handlers";
import { getCreationPlacementUpdates } from "@/lib/ai/creation-placement";
import { detectAiMode } from "@/lib/ai/mode";
import { useAiStore } from "@/stores/ai-store";
import { useAppStore } from "@/stores/app-store";
import { centerCameraOnNodes, useCanvasStore } from "@/stores/canvas-store";
import { useProjectStore } from "@/stores/project-store";
import { normalizeLayerOrder } from "@/stores/slices/canvas-hierarchy-slice";
import { useUIStore } from "@/stores/ui-store";
import type {
  AiMode,
  AiPendingAction,
  AiPendingAddComponentAction,
  AiPendingUpdateThemeAction,
} from "@/types/ai";
import type { ComponentNodeAny } from "@/types/builder";
import { getRealNodeSize } from "@/utils/spatial-engine";

export interface ApplyAiActionsResult {
  success: boolean;
  error?: string;
  createdComponentId?: string;
}

export function applyAiActions(
  actions: AiPendingAction[],
  mode?: AiMode
): ApplyAiActionsResult {
  const invalidActions = actions.filter((action) =>
    Boolean(action.validationError)
  );
  if (invalidActions.length > 0) {
    const validActions = actions.filter((action) => !action.validationError);
    if (validActions.length === 0) {
      return {
        success: false,
        error: `Cannot apply ${invalidActions.length} AI change(s) due to code validation errors.`,
      };
    }
    actions = validActions;
  }

  let lastCreatedId: string | null = null;
  let draftedLayout = false;
  let mergedThemePatch: {
    light?: Record<string, string>;
    dark?: Record<string, string>;
  } | null = null;

  const context = buildActionContext();
  // Honor the mode that initiated the AI request when provided. Falling back
  // to live detection only for callers without one (MCP/auto-fix). Detecting here
  // is unsafe mid-stream: after the first wireframe is fulfilled the
  // selection mixes "generated" + "wireframe" nodes, which detectAiMode
  // misclassifies as "bake" and would delete the remaining wireframes.
  const effectiveMode: AiMode | null =
    mode ?? useAiStore.getState().activeMode ?? null;
  const isInBakeMode =
    effectiveMode != null
      ? effectiveMode === "bake"
      : detectAiMode(
          context.uiStore.selectedIds,
          context.uiStore.propertiesTab,
          context.appStore.nodes
        ) === "bake";

  // In bake mode, capture the original selectedIds so we can delete them after all actions complete
  let bakeSourceIds: string[] = [];
  // Bounding box of the pre-merge selection: the surviving merged component
  // is framed onto this footprint so the result sits where the sources sat.
  let bakeBoundingBox: { x: number; y: number; w: number; h: number } | null =
    null;
  if (isInBakeMode) {
    const appStore = useAppStore.getState();
    bakeSourceIds = context.uiStore.selectedIds.filter(
      (id) => id !== appStore.rootId
    );
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const id of bakeSourceIds) {
      const node = appStore.nodes[id] as ComponentNodeAny | undefined;
      if (!node?.props) continue;
      const measured = getRealNodeSize({
        id,
        props: { w: node.props.w, h: node.props.h },
      });
      const w = node.props.w ?? (measured.w > 0 ? measured.w : undefined);
      const h = node.props.h ?? (measured.h > 0 ? measured.h : undefined);
      if (w == null || h == null) continue;
      minX = Math.min(minX, node.props.x);
      minY = Math.min(minY, node.props.y);
      maxX = Math.max(maxX, node.props.x + w);
      maxY = Math.max(maxY, node.props.y + h);
    }
    if (
      Number.isFinite(minX) &&
      Number.isFinite(minY) &&
      maxX > minX &&
      maxY > minY
    ) {
      bakeBoundingBox = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }
  }

  // Snapshot node IDs before the batch so wireframe cleanup can tell
  // which components were newly created by this generation pass.
  const preExistingIds = new Set(Object.keys(useProjectStore.getState().nodes));

  // Wrap all mutations in a single history batch so the entire AI response
  // is one undo entry rather than N separate entries.
  context.appStore.withBatchedHistory(() => {
    for (const action of actions) {
      if (action.tool === "draft_layout") {
        draftedLayout = true;
      }

      if (action.tool === "update_theme") {
        mergedThemePatch = mergeThemePatches(
          mergedThemePatch,
          (action as AiPendingUpdateThemeAction).patch
        );
        continue;
      }

      const handler = ACTION_HANDLERS[action.tool];
      if (handler) {
        handler.execute(action, context);
        lastCreatedId = context.lastCreatedId;
      } else {
        console.warn(`No handler found for AI tool: ${action.tool}`);
      }
    }

    // In bake mode, cleanup the original selected nodes after all actions complete
    // This ensures they're deleted regardless of which tools the AI used.
    // An empty batch has nothing to clean up after — and running deletion
    // with no updatedIds to protect fulfilled targets would destroy
    // just-created components against stale selection. Never run on empty.
    if (isInBakeMode && bakeSourceIds.length > 0 && actions.length > 0) {
      // Preserve any component that was the target of an update_component_code action,
      // since the AI merged source code into that target — deleting it would wipe the result.
      const updatedIds = new Set(
        actions
          .filter((a) => a.tool === "update_component_code")
          .map((a) => a.targetId)
      );
      const finalDeleteIds = bakeSourceIds.filter((id) => !updatedIds.has(id));
      if (finalDeleteIds.length > 0) {
        // Captured overlays must never go through deleteComponents — that
        // would excise the JSX element from the source component's AST.
        // Dismiss them via the non-destructive discard path instead.
        const liveNodes = useProjectStore.getState().nodes;
        const capturedIds = finalDeleteIds.filter(
          (id) => liveNodes[id]?.kind === "captured"
        );
        const regularIds = finalDeleteIds.filter(
          (id) => liveNodes[id]?.kind !== "captured"
        );
        if (regularIds.length > 0) {
          context.appStore.deleteComponents(regularIds);
        }
        if (capturedIds.length > 0) {
          context.appStore.discardCapturedNodes(capturedIds);
        }
      }

      // Frame the merged result on the pre-merge selection footprint — but
      // only for a true single-target merge. Multiple update targets (or none)
      // mean the model did not consolidate, and reframing would corrupt it.
      if (bakeBoundingBox) {
        const box = bakeBoundingBox;
        const liveNodes = useProjectStore.getState().nodes;
        const survivingTargets = [...updatedIds].filter(
          (id) =>
            bakeSourceIds.includes(id) &&
            liveNodes[id] &&
            liveNodes[id].kind !== "captured"
        );
        if (survivingTargets.length === 1) {
          // No grid snapping: the box is already canvas truth. Fixed modes so
          // an auto-sized survivor (e.g. a Text target) holds the frame
          // instead of collapsing to content size.
          context.appStore.updateLayouts([
            {
              id: survivingTargets[0],
              x: box.x,
              y: box.y,
              w: box.w,
              h: box.h,
              widthMode: "fixed",
              heightMode: "fixed",
            },
          ]);
        }
      }
    }

    if (mergedThemePatch) {
      applyThemeFromPatch(context.appStore, mergedThemePatch);
    }

    // Delete fulfilled wireframes immediately after generation.
    // Fulfilled wireframes were already promoted to "generated" by UpdateComponentCodeHandler.
    // ONLY armed wireframes (the selected subtree) may be removed here:
    // unselected wireframes are inert, so a plain prompt-based Create that
    // happens to place a component near one must never destroy it.
    // A remaining armed kind==="wireframe" node is removed when it was
    // explicitly fulfilled (targeted by update_component_code or by
    // add_component with a draftId reference) or when a newly
    // created component overlaps its bounding box (or sits at/near its
    // coordinates). Unaddressed wireframes — generation missed them entirely
    // or failed validation — are preserved so the user's layout intent is
    // not destroyed.
    const liveNodesPre = useProjectStore.getState().nodes as Record<
      string,
      ComponentNodeAny
    >;
    // The request's armed selection (fresh wireframes auto-armed in create
    // mode) plus the live selection, which grows as targets are fulfilled.
    const requestArmedIds = useAiStore.getState().armedSelectionIds ?? [];
    const armedWireframeIds = collectArmedWireframeIds(liveNodesPre, [
      ...new Set([...requestArmedIds, ...context.uiStore.selectedIds]),
    ]);
    const remainingWireframes = (
      Object.values(
        useProjectStore.getState().nodes as Record<string, ComponentNodeAny>
      ) as ComponentNodeAny[]
    ).filter((n) => n.kind === "wireframe" && armedWireframeIds.has(n.id));
    if (remainingWireframes.length > 0) {
      const fulfilledTargetIds = new Set<string>();
      for (const a of actions) {
        if (a.tool === "update_component_code" && a.targetId) {
          fulfilledTargetIds.add(a.targetId);
        } else if (a.tool === "add_component") {
          const ref = (a as AiPendingAddComponentAction).draftId;
          if (ref) fulfilledTargetIds.add(ref);
        }
      }
      const liveNodes = useProjectStore.getState().nodes as Record<
        string,
        ComponentNodeAny
      >;
      const newNodes = (Object.values(liveNodes) as ComponentNodeAny[]).filter(
        (n) =>
          !preExistingIds.has(n.id) &&
          n.id !== context.appStore.rootId &&
          n.kind !== "wireframe" &&
          n.kind !== "captured" &&
          n.kind !== "draft"
      );
      const COORD_TOLERANCE = 20;
      const rectsOverlap = (
        a: { x: number; y: number; w: number; h: number },
        b: { x: number; y: number; w: number; h: number }
      ) =>
        a.x < b.x + b.w &&
        a.x + a.w > b.x &&
        a.y < b.y + b.h &&
        a.y + a.h > b.y;
      const wireframesToDelete: string[] = [];
      for (const wf of remainingWireframes) {
        if (fulfilledTargetIds.has(wf.id)) {
          wireframesToDelete.push(wf.id);
          continue;
        }
        const wfRect = {
          x: wf.props.x,
          y: wf.props.y,
          w: wf.props.w ?? 0,
          h: wf.props.h ?? 0,
        };
        const hasReplacement = newNodes.some((nn) => {
          const nnRect = {
            x: nn.props.x,
            y: nn.props.y,
            w: nn.props.w ?? 0,
            h: nn.props.h ?? 0,
          };
          if (rectsOverlap(wfRect, nnRect)) return true;
          // Near-coordinate match (accounts for LLM rounding/grid snapping).
          return (
            Math.abs(nnRect.x - wfRect.x) <= COORD_TOLERANCE &&
            Math.abs(nnRect.y - wfRect.y) <= COORD_TOLERANCE
          );
        });
        if (hasReplacement) wireframesToDelete.push(wf.id);
      }
      // Cascade: fulfilling a parent container consumes its entire nested
      // subtree. Handlers already attempt this, but this is the atomic
      // safety net — expand every ARMED fulfilled parent id to all descendant
      // child wireframes (recursive via `children`) plus any wireframe
      // spatially contained within the parent's bounds (stale hierarchy).
      // Unarmed parents are never expanded: explicitly targeting an
      // unselected wireframe still applies its code (promotion), but its
      // subtree is left alone. This also prunes orphaned children when the
      // parent was fulfilled via update_component_code (parent is
      // pre-existing, so it never appears in `newNodes` and the overlap
      // check above would miss it).
      const deleteSet = new Set<string>(wireframesToDelete);
      for (const parentId of fulfilledTargetIds) {
        if (!armedWireframeIds.has(parentId)) continue;
        const parent = liveNodes[parentId] as ComponentNodeAny | undefined;
        if (!parent) continue;
        for (const descId of collectDescendantWireframes(liveNodes, parentId)) {
          deleteSet.add(descId);
        }
        const parentRect = {
          x: parent.props.x,
          y: parent.props.y,
          w: parent.props.w ?? 0,
          h: parent.props.h ?? 0,
        };
        if (parentRect.w > 0 && parentRect.h > 0) {
          for (const containedId of findSpatiallyContainedWireframes(
            liveNodes,
            parentRect,
            new Set([parentId])
          )) {
            deleteSet.add(containedId);
          }
        }
      }
      if (deleteSet.size > 0) {
        context.appStore.deleteComponents([...deleteSet]);
      }
    }

    // Heal orphaned draft skeletons: if an add_component missed its placeholder
    // (coordinate drift, duplicate coords, or same-batch staleness) it created
    // a fresh node overlapping the skeleton. The skeleton is then a duplicate
    // placeholder — delete it and keep the real component so the user never has
    // to manually clean skeletons. Drafts with NO overlapping replacement are
    // preserved (generation may still be streaming).
    {
      const liveNodes = useProjectStore.getState().nodes as Record<
        string,
        ComponentNodeAny
      >;
      const remainingDrafts = (
        Object.values(liveNodes) as ComponentNodeAny[]
      ).filter((n) => n.kind === "draft");
      if (remainingDrafts.length > 0) {
        const fulfilledDraftIds = new Set<string>(context.consumedDraftIds);
        for (const a of actions) {
          if (a.tool === "add_component") {
            const ref = (a as AiPendingAddComponentAction).draftId;
            if (ref) fulfilledDraftIds.add(ref);
          }
        }
        const newNodes = (
          Object.values(liveNodes) as ComponentNodeAny[]
        ).filter(
          (n) =>
            !preExistingIds.has(n.id) &&
            n.id !== context.appStore.rootId &&
            n.kind !== "wireframe" &&
            n.kind !== "captured" &&
            n.kind !== "draft"
        );
        const COORD_TOLERANCE = 20;
        const rectsOverlap = (
          a: { x: number; y: number; w: number; h: number },
          b: { x: number; y: number; w: number; h: number }
        ) =>
          a.x < b.x + b.w &&
          a.x + a.w > b.x &&
          a.y < b.y + b.h &&
          a.y + a.h > b.y;
        const draftsToDelete: string[] = [];
        for (const d of remainingDrafts) {
          if (fulfilledDraftIds.has(d.id)) continue;
          const dRect = {
            x: d.props.x,
            y: d.props.y,
            w: d.props.w ?? 0,
            h: d.props.h ?? 0,
          };
          const hasReplacement = newNodes.some((nn) => {
            const nnRect = {
              x: nn.props.x,
              y: nn.props.y,
              w: nn.props.w ?? 0,
              h: nn.props.h ?? 0,
            };
            if (rectsOverlap(dRect, nnRect)) return true;
            return (
              Math.abs(nnRect.x - dRect.x) <= COORD_TOLERANCE &&
              Math.abs(nnRect.y - dRect.y) <= COORD_TOLERANCE
            );
          });
          if (hasReplacement) draftsToDelete.push(d.id);
        }
        if (draftsToDelete.length > 0) {
          context.appStore.deleteComponents(draftsToDelete);
        }
      }
    }

    // Purge captured overlays for every updated component. In MCP streaming
    // mode acceptAiChanges() is never invoked, so without this the dashed
    // overlay would linger after the edit was applied. This is a safety net
    // for anything UpdateComponentCodeHandler didn't already discard (e.g.
    // overlays created mid-batch). Always use the non-destructive discard
    // path — never deleteComponents, which would delete code from the AST.
    const updatedComponentIds = new Set(
      actions
        .filter((a) => a.tool === "update_component_code")
        .map((a) => a.targetId)
        .filter((id): id is string => Boolean(id))
    );
    if (updatedComponentIds.size > 0) {
      const currentNodes = useProjectStore.getState().nodes as Record<
        string,
        ComponentNodeAny
      >;
      const sourcesToPurge = new Set<string>();
      for (const id of updatedComponentIds) {
        const node = currentNodes[id];
        if (
          node?.kind === "captured" &&
          node.capturedMetadata?.sourceComponentId
        ) {
          // Action still targeted the overlay itself — purge its source's overlays.
          sourcesToPurge.add(node.capturedMetadata.sourceComponentId);
        } else {
          sourcesToPurge.add(id);
        }
      }
      // Also catch overlays whose source matches but whose target wasn't in
      // the set (e.g. target was already remapped upstream).
      for (const node of Object.values(currentNodes)) {
        if (
          node.kind === "captured" &&
          node.capturedMetadata?.sourceComponentId &&
          updatedComponentIds.has(node.capturedMetadata.sourceComponentId)
        ) {
          sourcesToPurge.add(node.capturedMetadata.sourceComponentId);
        }
      }
      const allDiscarded: string[] = [];
      for (const sourceId of sourcesToPurge) {
        const ids =
          context.appStore.discardCapturedNodesBySourceId(sourceId) ?? [];
        allDiscarded.push(...ids);
      }
      if (allDiscarded.length > 0) {
        const discardedSet = new Set(allDiscarded);
        const liveSelected = useUIStore.getState().selectedIds;
        if (liveSelected.some((id) => discardedSet.has(id))) {
          const survivingTargets = [...updatedComponentIds].filter(
            (id) => useProjectStore.getState().nodes[id]
          );
          // Resolve any surviving captured targets to their source for selection.
          const resolvedTargets = survivingTargets.map((id) => {
            const n = useProjectStore.getState().nodes[id];
            if (
              n?.kind === "captured" &&
              n.capturedMetadata?.sourceComponentId &&
              useProjectStore.getState().nodes[
                n.capturedMetadata.sourceComponentId
              ]
            ) {
              return n.capturedMetadata.sourceComponentId;
            }
            return id;
          });
          if (resolvedTargets.length === 1) {
            useUIStore.getState().selectComponent(resolvedTargets[0]);
          } else if (resolvedTargets.length > 1) {
            useUIStore.getState().selectComponents(resolvedTargets);
          } else {
            useUIStore
              .getState()
              .selectComponents(
                liveSelected.filter((id) => !discardedSet.has(id))
              );
          }
        }
      }
    }
    // Resolve placement after fulfillment/cleanup, so selected placeholders
    // stay in place and all newly created nodes move together. Keep this in
    // the history batch and before camera framing.
    const liveState = useProjectStore.getState();
    const placementUpdates = getCreationPlacementUpdates(
      liveState.nodes,
      liveState.rootId,
      preExistingIds,
      context.gridConfig
    );
    if (placementUpdates.length > 0) {
      context.appStore.updateLayouts(placementUpdates);
    }
  });

  if (draftedLayout) {
    context.uiStore.clearSelection();
    setTimeout(() => {
      const container = document.querySelector("[data-canvas-container]");
      if (!container) return;

      const rect = container.getBoundingClientRect();
      useCanvasStore.getState().zoomToFit(rect.width, rect.height);
    }, 0);
  } else {
    // Select all fulfilled wireframe targets so multi-wireframe results are
    // fully highlighted — not just the last add_component id. Union with the
    // pre-existing selection so sequential single-action batches (streaming)
    // keep pending wireframes armed and accumulate the final highlight.
    const liveNodesForSelection = useProjectStore.getState().nodes as Record<
      string,
      unknown
    >;
    const fulfilledTargetIds = actions
      .filter((a) => a.tool === "update_component_code" && a.targetId)
      .map((a) => (a as { targetId: string }).targetId)
      .filter((id) => Boolean(liveNodesForSelection[id]));
    const uniqueFulfilled = [...new Set(fulfilledTargetIds)];
    if (uniqueFulfilled.length > 0) {
      const priorSelected = (context.uiStore.selectedIds as string[]).filter(
        (id) => Boolean(liveNodesForSelection[id])
      );
      const union = [...new Set([...priorSelected, ...uniqueFulfilled])];
      if (union.length > 1) {
        context.uiStore.selectComponents(union);
      } else if (union.length === 1) {
        context.uiStore.selectComponent(union[0]);
      }
    } else if (lastCreatedId) {
      context.uiStore.selectComponent(lastCreatedId);
    }

    // Center the camera on the newly created / in-place fulfilled cluster.
    // The `draft_layout` branch above already frames the whole planned layout
    // via `zoomToFit`, so this only runs for direct creations (single or
    // multi-component) where panning to the generated elements is preferred.
    // `update_component_code`-only batches (e.g. auto-fix repairs) record no
    // created ids here, so they preserve the current camera position.
    if (context.createdNodeIds.length > 0) {
      centerCameraOnNodes(context.createdNodeIds);
    }
  }

  return {
    success: true,
    createdComponentId: lastCreatedId ?? undefined,
  };
}

/**
 * Marks the wireframes a kept request armed as used. They stay on the canvas
 * but no longer join a Create unless the user selects them again.
 */
function markArmedWireframesUsed(
  nodes: Record<string, ComponentNodeAny>,
  // Keep Both restores some originals under new ids: newId → original id
  restoredFrom: Map<string, string> = new Map()
) {
  const armedIds = useAiStore.getState().armedSelectionIds;
  if (!armedIds || armedIds.length === 0) return;
  const armedSet = new Set(armedIds);
  const ids = [...armedIds];
  for (const [newId, originalId] of restoredFrom) {
    if (armedSet.has(originalId)) ids.push(newId);
  }
  for (const id of collectArmedWireframeIds(nodes, ids)) {
    const node = nodes[id];
    if (node?.kind === "wireframe") node.usedInCreation = true;
  }
}

export function acceptAiChanges() {
  const aiStore = useAiStore.getState();
  const initialSnapshot = aiStore.initialAppSnapshot;

  // Clean up captured overlay nodes and drafts, and clear comments, in a
  // single unified state mutation. This must happen before commitHistory so
  // the final committed state doesn't include overlay nodes or comment
  // artifacts.
  // NOTE: user-drawn wireframes are intentionally KEPT here. Fulfilled ones
  // were already promoted/consumed by applyAiActions; anything still a
  // wireframe is either inert (never selected) or was missed by the AI —
  // both must survive Accept so plain prompt-based Creates never destroy
  // canvas wireframes. (Drafts are AI-created placeholders, so unfulfilled
  // ones are still purged; captured nodes are transient overlays.)
  useAppStore.setState((state) => {
    const toDelete = new Set<string>();

    // First pass: identify nodes to delete and clear comments on kept nodes
    for (const [id, node] of Object.entries(state.nodes)) {
      if (node.kind === "captured" || node.kind === "draft") {
        toDelete.add(id);
      } else if (node.kind === "wireframe") {
        // Preserve wireframe comments (user's design intent annotations),
        // mirroring keepBothAiChanges.
      } else {
        // Clear comment on kept nodes to reset intent counters in the top bar
        node.comment = "";
      }
    }

    // Remove overlay nodes from the nodes object
    for (const id of toDelete) {
      delete state.nodes[id];
    }

    // Filter, dedupe, and complete the layer stack after overlay cleanup.
    state.layerOrder = normalizeLayerOrder(
      state.layerOrder.filter((id) => !toDelete.has(id)),
      state.nodes,
      state.rootId
    );

    // Wireframes this request used and the user kept are spent.
    markArmedWireframesUsed(state.nodes as Record<string, ComponentNodeAny>);
  });

  if (initialSnapshot) {
    try {
      const parsedSnapshot = JSON.parse(initialSnapshot);
      // Commit a single history entry: pre-AI state → current (post-AI) state.
      // This makes the entire AI session undoable as one step.
      useAppStore.temporal.getState().resume();
      useAppStore.getState().commitHistory(parsedSnapshot);
    } catch (e) {
      console.error("Failed to commit AI history entry:", e);
      useAppStore.temporal.getState().resume();
    }
  } else {
    useAppStore.temporal.getState().resume();
  }

  aiStore.clearState();
  aiStore.setInitialAppSnapshot(null);
  aiStore.setPrompt("");
  aiStore.setStatus("idle");
  aiStore.setError(null);
}

export function rejectAiChanges() {
  const aiStore = useAiStore.getState();
  const snapshot = aiStore.initialAppSnapshot;

  if (snapshot) {
    try {
      const parsed = JSON.parse(snapshot);
      useAppStore.setState((state) => {
        state.nodes = parsed.nodes;
        state.themeState = parsed.themeState;
        state.rootId = parsed.rootId;
        state.layerOrder = normalizeLayerOrder(
          parsed.layerOrder ?? [],
          state.nodes,
          state.rootId
        );
        state.currentMode = parsed.currentMode;
        state.pendingVersion = state.pendingVersion + 1;
      });
      const uiStore = useUIStore.getState();
      uiStore.clearSelection();
    } catch (e) {
      console.error("Failed to restore AI snapshot:", e);
    }
  }

  const temporalStore = useAppStore.temporal.getState();
  temporalStore.resume();

  aiStore.clearState();
  aiStore.setInitialAppSnapshot(null);
  aiStore.setStatus("idle");
  aiStore.setError(null);
}

export function keepBothAiChanges() {
  const aiStore = useAiStore.getState();
  const projectStore = useProjectStore.getState();
  const _appStore = useAppStore.getState();
  const uiStore = useUIStore.getState();

  // Save snapshot BEFORE it gets cleared
  const snapshot = aiStore.initialAppSnapshot;
  if (!snapshot) {
    console.error("No initial snapshot available for Keep Both");
    return;
  }

  try {
    const parsed = JSON.parse(snapshot);
    const originalNodes = parsed.nodes as Record<string, ComponentNodeAny>;
    const currentNodes = projectStore.nodes;

    // Identify new components created by AI (not in original)
    const newComponentIds = new Set(
      Object.keys(currentNodes).filter(
        (id) => !Object.hasOwn(originalNodes, id)
      )
    );

    // Identify repurposed components (ID exists in both but component type/kind changed)
    // This happens when AI reuses an ID for a completely different component (like baking)
    const repurposedIds = new Set<string>();
    for (const id of Object.keys(originalNodes)) {
      if (Object.hasOwn(originalNodes, id) && Object.hasOwn(currentNodes, id)) {
        const orig = originalNodes[id] as any;
        const curr = currentNodes[id] as any;
        // If type or kind drastically changed, the ID was repurposed
        if (orig.type !== curr.type || orig.kind !== curr.kind) {
          repurposedIds.add(id);
        }
      }
    }

    // Identify modified components (existed before, changed now, but not repurposed)
    const modifiedComponentIds = new Set<string>();
    for (const id of Object.keys(originalNodes)) {
      if (
        Object.hasOwn(originalNodes, id) &&
        Object.hasOwn(currentNodes, id) &&
        !repurposedIds.has(id) &&
        JSON.stringify(originalNodes[id]) !== JSON.stringify(currentNodes[id])
      ) {
        modifiedComponentIds.add(id);
      }
    }

    // Identify deleted components (were in original, no longer in current, and not repurposed)
    const deletedComponentIds = new Set(
      Object.keys(originalNodes).filter(
        (id) => !Object.hasOwn(currentNodes, id) && !repurposedIds.has(id)
      )
    );

    // Restore original nodes alongside new ones
    // Start with current state, keep repurposed components with their new form
    const mergedNodes = { ...currentNodes };

    // Restore deleted components back to the canvas
    for (const id of deletedComponentIds) {
      mergedNodes[id] = originalNodes[id];
    }

    // Apply spatial offset to new components to avoid visual overlap
    const OFFSET = 200;
    const offsetNewNodes: Record<string, ComponentNodeAny> = {};

    for (const id of newComponentIds) {
      if (currentNodes[id]) {
        const node = { ...currentNodes[id] };
        if (node.props && typeof node.props === "object") {
          node.props = {
            ...node.props,
            y: ((node.props as any).y ?? 0) + OFFSET,
          };
        }
        offsetNewNodes[id] = node;
      }
    }

    // Apply offset to deleted components
    for (const id of deletedComponentIds) {
      const node = { ...mergedNodes[id] };
      if (node.props && typeof node.props === "object") {
        node.props = {
          ...node.props,
          y: ((node.props as any).y ?? 0) + OFFSET,
        };
      }
      offsetNewNodes[id] = node;
    }

    // For repurposed components, restore the original under a new ID with offset
    // This prevents the original from being hidden by the new component that reused its ID
    const restoredRepurposedIds: string[] = [];
    const restoredFrom = new Map<string, string>();
    for (const id of repurposedIds) {
      const newId = uuidv4();
      restoredFrom.set(newId, id);
      const originalNode = originalNodes[id];
      const offsetNode = { ...originalNode, id: newId };
      if (offsetNode.props && typeof offsetNode.props === "object") {
        offsetNode.props = {
          ...offsetNode.props,
          y: ((offsetNode.props as any).y ?? 0) + OFFSET,
        };
      }
      offsetNewNodes[newId] = offsetNode;
      restoredRepurposedIds.push(newId);
    }

    // For modified components, restore the original version under a new ID with offset
    // This allows the user to see both the edited version (at current ID) and the original
    const restoredModifiedIds: string[] = [];
    for (const id of modifiedComponentIds) {
      const newId = uuidv4();
      restoredFrom.set(newId, id);
      const originalNode = originalNodes[id];
      const offsetNode = { ...originalNode, id: newId };
      if (offsetNode.props && typeof offsetNode.props === "object") {
        offsetNode.props = {
          ...offsetNode.props,
          y: ((offsetNode.props as any).y ?? 0) + OFFSET,
        };
      }
      offsetNewNodes[newId] = offsetNode;
      restoredModifiedIds.push(newId);
    }

    // Merge offset nodes, filtering out overlays and clearing comments on kept nodes
    const finalNodes: Record<string, ComponentNodeAny> = {};

    // Process merged nodes (original + modified + deleted/restored)
    for (const [id, node] of Object.entries(mergedNodes)) {
      // Skip captured and draft overlays
      if (node.kind === "captured" || node.kind === "draft") {
        continue;
      }
      // Clear comments on regular nodes to reset intent counters;
      // preserve wireframe comments (user's design intent annotations)
      finalNodes[id] =
        node.kind === "wireframe" ? { ...node } : { ...node, comment: "" };
    }

    // Process offset new nodes (new components, repurposed restores, modified restores)
    for (const [id, node] of Object.entries(offsetNewNodes)) {
      // Skip captured and draft overlays
      if (node.kind === "captured" || node.kind === "draft") {
        continue;
      }
      finalNodes[id] =
        node.kind === "wireframe" ? { ...node } : { ...node, comment: "" };
    }

    // Wireframes this request used (including ones Keep Both restored) are
    // spent: they stay on the canvas but only rejoin a Create when selected.
    markArmedWireframesUsed(finalNodes, restoredFrom);

    // Collect all newly created/restored IDs for layer order update
    const newLayerIds = [
      ...Array.from(newComponentIds),
      ...restoredRepurposedIds,
      ...restoredModifiedIds,
    ];

    // Update app state with merged nodes and updated layer order
    useAppStore.setState((state) => {
      state.nodes = finalNodes;
      // AI output can be partial or duplicate-heavy in large scenes, so never
      // store a raw layer array.
      state.layerOrder = normalizeLayerOrder(
        [...(parsed.layerOrder ?? state.layerOrder), ...newLayerIds],
        finalNodes,
        state.rootId
      );
      state.pendingVersion = state.pendingVersion + 1;
    });

    // Commit history: original → (original + offset new components)
    useAppStore.temporal.getState().resume();
    useAppStore.getState().commitHistory(parsed);

    // Select newly created and restored components so user can easily see what was kept
    const allRestoredIds = [
      ...Array.from(newComponentIds),
      ...restoredRepurposedIds,
      ...restoredModifiedIds,
    ];
    if (allRestoredIds.length > 0) {
      uiStore.selectComponents(allRestoredIds);
    }
  } catch (e) {
    console.error("Failed to apply Keep Both:", e);
  }

  aiStore.clearState();
  aiStore.setInitialAppSnapshot(null);
  aiStore.setStatus("idle");
  aiStore.setError(null);
}

export function useAiActionOrchestrator() {
  return {
    acceptAiChanges,
    rejectAiChanges,
    keepBothAiChanges,
  };
}
