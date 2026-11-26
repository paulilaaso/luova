import { toast } from "sonner";
import { v4 as uuidv4 } from "uuid";
import type { TemporalState } from "zundo";
import { defaultThemeState } from "@/config/theme";
import { cleanComponentCode } from "@/lib/ai/code-cleaner";
import {
  idbClearAllAssets,
  idbDeleteAsset,
  idbGetAsset,
  idbSetAllAssets,
  idbSetAsset,
} from "@/lib/asset-idb";
import {
  COMPONENT_SIZING_TRAITS,
  type ComponentNodeAny,
  type ComponentType,
} from "@/types/builder";
import {
  ASSET_FONT_ID_REGEX,
  ASSET_ID_REGEX,
  generateAssetId,
  generateFontId,
  mimeTypeFromBase64,
  revokeAssetBlobUrl,
} from "@/utils/asset-manager";
import { computeElementFingerprint } from "@/utils/ast-indexer";
import {
  extractJsxClassNamesByAstIndex,
  extractJsxStyleByAstIndex,
  removeJsxElementByAstIndex,
  setJsxStyleByAstIndex,
  updateJsxClassNameByAstIndex,
  updateJsxStyleByAstIndex,
} from "@/utils/ast-modifier-v2";
import { componentStyleManager } from "@/utils/canvas-style-manager";
import { loadCustomFont, registerCustomFont } from "@/utils/fonts/index";
import {
  createCapturedNode,
  createComponentNode,
  createRootNode,
  createWireframeNode,
} from "@/utils/node-factory";
import { sanitizeProjectState } from "@/utils/node-validation";
import {
  calculateNewPosition,
  calculateNewSize,
  normalizeProps,
} from "@/utils/spatial-utils";
import { ThemeEngine } from "@/utils/theme-engine";
import { toHistoryState } from "../app-store";
import { centerCameraOnNodes, useCanvasStore } from "../canvas-store";
import type {
  AppStateCreator,
  AppStore,
  AssetMeta,
  ProjectSlice,
} from "../types";
import { useUIStore } from "../ui-store";
import {
  applyHierarchy,
  computeHierarchy,
  deleteCapturedNodes,
  isLayerableNode,
  normalizeLayerOrder,
  syncCapturedNodePositions,
} from "./canvas-hierarchy-slice";

type TemporalStateExt = TemporalState<AppStore> & {
  commitHistory: (pastState: unknown, currentState: unknown) => void;
};

/**
 * Generation counter for full project replacements (`reset` / `loadProjectJSON`
 * / `importJSON`). Both loaders defer their state swap behind async IndexedDB
 * asset writes (seconds for large projects): without this, a load started
 * before a New Project would apply its stale nodes + file handle *after* the
 * reset. Deferred blocks capture the epoch at call time and no-op on mismatch.
 */
let projectLoadEpoch = 0;

/**
 * An opened file can carry a prompt that steers Luova's AI and connected MCP
 * agents — make sure the user knows it's there.
 */
function notifyProjectSystemPrompt() {
  toast.warning("This project has its own System Prompt.", {
    description: "Review it in Settings.",
  });
}

/**
 * Remaps sourceComponentId references in captured metadata.
 * Called after duplicating/importing components to update stale references.
 *
 * @param nodes - The nodes object to walk
 * @param idMap - Map of old IDs to new IDs
 */
function remapCapturedReferences(
  nodes: Record<string, ComponentNodeAny>,
  idMap: Record<string, string>
): void {
  for (const node of Object.values(nodes)) {
    if (node.kind === "captured" && node.capturedMetadata?.sourceComponentId) {
      const oldSourceId = node.capturedMetadata.sourceComponentId;
      if (idMap[oldSourceId]) {
        node.capturedMetadata.sourceComponentId = idMap[oldSourceId];
      }
    }
  }
}

function cleanupCapturedNodeAst(
  node: ComponentNodeAny,
  state: any,
  skipIds: string | Set<string>
): void {
  if (node.kind !== "captured" || !node.capturedMetadata) return;
  const { sourceComponentId, astIndex } = node.capturedMetadata;
  const sourceNode = state.nodes[sourceComponentId];
  if (!sourceNode?.code) return;

  const skipSet = typeof skipIds === "string" ? new Set([skipIds]) : skipIds;

  sourceNode.code = removeJsxElementByAstIndex(
    sourceNode.code,
    parseInt(astIndex, 10)
  );

  for (const nodeId of Object.keys(state.nodes)) {
    const n = state.nodes[nodeId];
    if (
      !skipSet.has(nodeId) &&
      n.kind === "captured" &&
      n.capturedMetadata?.sourceComponentId === sourceComponentId
    ) {
      state.layerOrder = deleteCapturedNodes(
        state.nodes,
        state.layerOrder,
        nodeId
      );
      delete state.nodes[nodeId];
      state.layerOrder = state.layerOrder.filter(
        (lid: string) => lid !== nodeId
      );
    }
  }
}

export const createProjectSlice: AppStateCreator<ProjectSlice> = (
  set,
  get,
  store
) => ({
  nodes: { root: createRootNode() },
  rootId: "root",
  layerOrder: [],
  // Start clean: pendingVersion === lastSyncedVersion so a pristine workspace
  // does not report unsaved changes on first load.
  lastSyncedVersion: 1,
  pendingVersion: 1,
  assets: {},
  clipboard: [],
  fileHandle: null,
  fileName: null,
  isSaving: false,
  systemPrompt: "",
  systemPromptEnabled: false,

  setFileHandle: (handle) => {
    set((state) => {
      state.fileHandle = handle;
      // Keep fileName in sync when the handle changes.
      if (!handle) {
        state.fileName = null;
      } else if (handle?.name && !state.fileName) {
        state.fileName = handle.name;
      }
    });
    // Synchronize with IndexedDB (fire-and-forget — never block the UI).
    // Dynamic import avoids SSR / test-env issues with IndexedDB.
    import("@/lib/file-handle-storage")
      .then(({ idbSetFileHandle, idbClearFileHandle }) => {
        if (!handle) {
          return idbClearFileHandle();
        }
        const name = get().fileName ?? (handle as any)?.name ?? null;
        return idbSetFileHandle(handle, { fileName: name });
      })
      .catch(() => undefined);
  },

  setFileName: (name) => {
    set((state) => {
      state.fileName = name;
    });
    import("@/lib/file-handle-storage")
      .then(({ idbUpdateFileHandleMeta }) =>
        idbUpdateFileHandleMeta({ fileName: name })
      )
      .catch(() => undefined);
  },

  setIsSaving: (isSaving) => {
    set((state) => {
      state.isSaving = isSaving;
    });
  },

  setSystemPrompt: (prompt) => {
    set((state) => {
      if (state.systemPrompt === prompt) return;
      state.systemPrompt = prompt;
      // Mark the project dirty so save/unsaved guards reflect the change.
      state.pendingVersion++;
    });
  },

  setSystemPromptEnabled: (enabled) => {
    set((state) => {
      if (state.systemPromptEnabled === enabled) return;
      state.systemPromptEnabled = enabled;
      // Mark the project dirty so save/unsaved guards reflect the change.
      state.pendingVersion++;
    });
  },

  addAsset: (base64, name) => {
    let id: string;
    if (
      base64.startsWith("data:font/") ||
      base64.startsWith("data:application/font") ||
      base64.startsWith("data:application/x-font") ||
      base64.startsWith("data:application/vnd.ms-fontobject")
    ) {
      id = generateFontId();
    } else {
      id = generateAssetId();
    }

    const mimeType = mimeTypeFromBase64(base64);
    // Strip the header to measure only the encoded payload length
    const payloadMatch = base64.match(/^data:[^;]+;base64,(.+)$/s);
    const size = payloadMatch
      ? Math.round((payloadMatch[1].length * 3) / 4)
      : base64.length;

    // Write blob to IndexedDB (fire-and-forget — the ID is returned immediately)
    idbSetAsset(id, base64).catch((err) =>
      console.error("[asset-idb] Failed to store asset:", id, err)
    );

    // Only store lightweight metadata in Zustand/localStorage
    set((state) => {
      state.assets[id] = { mimeType, size, ...(name ? { name } : {}) };
    });

    return id;
  },

  getDelta: () => {
    const state = get();
    if (state.pendingVersion === state.lastSyncedVersion) {
      return { nodes: {}, version: state.pendingVersion };
    }
    return { nodes: { ...state.nodes }, version: state.pendingVersion };
  },

  markSynced: () =>
    set((state) => {
      state.lastSyncedVersion = state.pendingVersion;
    }),

  copyComponents: (ids) => {
    const state = get();
    const copiedNodes = ids
      .map((id) => state.nodes[id])
      .filter((node): node is ComponentNodeAny => !!node)
      .map((node) => JSON.parse(JSON.stringify(node)));
    set((s) => {
      s.clipboard = copiedNodes;
    });
  },

  cutComponents: (ids) => {
    const state = get();
    // Copy first
    state.copyComponents(ids);
    // Then delete
    state.deleteComponents(ids);
  },

  pasteComponents: (targetPosition) => {
    const state = get();
    if (state.clipboard.length === 0) return [];

    const newIds: string[] = [];
    set((s) => {
      s.pendingVersion++;

      // Calculate clipboard bounding box to determine offset
      let clipMinX = Infinity;
      let clipMinY = Infinity;
      for (const node of state.clipboard) {
        clipMinX = Math.min(clipMinX, node.props.x || 0);
        clipMinY = Math.min(clipMinY, node.props.y || 0);
      }

      const offsetX = targetPosition ? targetPosition.x - clipMinX : 20;
      const offsetY = targetPosition ? targetPosition.y - clipMinY : 20;

      state.clipboard.forEach((node) => {
        const clonedNode = JSON.parse(JSON.stringify(node)) as ComponentNodeAny;
        // Generate new UUID
        const newId = uuidv4();
        clonedNode.id = newId;
        // Apply spatial offset
        clonedNode.props.x = (clonedNode.props.x || 0) + offsetX;
        clonedNode.props.y = (clonedNode.props.y || 0) + offsetY;
        // Add to nodes
        s.nodes[newId] = clonedNode;
        newIds.push(newId);
        // Add to layerOrder
        s.layerOrder = [...s.layerOrder, newId];
      });
      // Apply hierarchy
      applyHierarchy(s, computeHierarchy(s.nodes, newIds));
    });
    return newIds;
  },

  addComponent: (type, position, initialCode = "", size, extraProps) => {
    const safeType = (
      typeof type === "string" && type.trim() !== "" ? type : "Container"
    ) as ComponentType;
    const cleanedCode = initialCode ? cleanComponentCode(initialCode) : "";
    const newNode = createComponentNode(
      safeType,
      position,
      cleanedCode,
      size,
      extraProps
    );
    set((state) => {
      state.pendingVersion++;
      state.nodes[newNode.id] = newNode;
      state.layerOrder = [...state.layerOrder, newNode.id];
      applyHierarchy(state, computeHierarchy(state.nodes, [newNode.id]));
    });
    return newNode.id;
  },

  updateComponentProps: (
    id: string,
    props: Partial<ComponentNodeAny["props"]>
  ) => {
    const appStore = store as any;
    const preState = appStore._pendingHistoryPreState as
      | Record<string, unknown>
      | undefined;
    appStore._pendingHistoryPreState = undefined;

    if (preState) {
      // Value was already applied via ...Immediate; commit the history entry
      // from the captured pre-drag state → current state.
      appStore.getState().commitHistory(preState);
    } else {
      set((state) => {
        const node = state.nodes[id];
        if (!node) return;
        const normalizedNext = normalizeProps({
          ...node.props,
          ...props,
        }) as typeof node.props;

        const keys = Object.keys(normalizedNext);
        let changed = false;
        for (const key of keys) {
          if (
            normalizedNext[key as keyof typeof normalizedNext] !==
            node.props[key as keyof typeof node.props]
          ) {
            changed = true;
            break;
          }
        }

        if (changed) {
          state.pendingVersion++;
          node.props = normalizedNext;
        }
      });
    }
  },

  updateComponentPropsImmediate: (id, props) => {
    const temporalState = (store as any).temporal.getState();
    const appStore = store as any;
    // Capture the pre-drag state before the first immediate mutation.
    if (!appStore._pendingHistoryPreState) {
      const s = appStore.getState();
      const { nodes, themeState, currentMode, layerOrder, rootId, assets } = s;
      appStore._pendingHistoryPreState = {
        nodes,
        themeState,
        currentMode,
        layerOrder,
        rootId,
        assets,
      };
    }
    temporalState.pause();
    try {
      set((state) => {
        const node = state.nodes[id];
        if (!node) return;
        const originalX = node.props.x;
        const originalY = node.props.y;

        const normalizedNext = normalizeProps({
          ...node.props,
          ...props,
        }) as typeof node.props;
        node.props = normalizedNext;

        if (
          (props.x !== undefined || props.y !== undefined) &&
          (node.props.x !== originalX || node.props.y !== originalY)
        ) {
          syncCapturedNodePositions(
            state.nodes,
            id,
            node.props.x - originalX,
            node.props.y - originalY
          );
        }
      });
    } finally {
      temporalState.resume();
    }
  },

  setComponentPosition: (id, x, y) =>
    set((state) => {
      const node = state.nodes[id];
      if (!node?.props) return;
      if (node.props.x === x && node.props.y === y) return;

      state.pendingVersion++;
      node.props.x = x;
      node.props.y = y;
      applyHierarchy(state, computeHierarchy(state.nodes, [id]));
    }),

  setComponentSize: (id, w, h) =>
    set((state) => {
      const node = state.nodes[id];
      if (!node?.props) return;
      if (node.props.w === w && node.props.h === h) return;

      state.pendingVersion++;
      node.props.w = w;
      node.props.h = h;
      applyHierarchy(state, computeHierarchy(state.nodes, [id]));
    }),

  updateComponentCode: (id, code) =>
    set((state) => {
      const node = state.nodes[id];
      if (!node) return;

      if (node.code === code) return;

      state.pendingVersion++;
      node.code = code;

      if (node.kind === "wireframe" || node.kind === "draft") {
        node.kind = "generated";
        const traits = COMPONENT_SIZING_TRAITS[node.type ?? "Container"];

        // Preserve the user-drawn bounding box as an explicit baseline
        // constraint: never strip w/h on wireframe/draft promotion. Deleting
        // dimensions collapses the canvas frame to intrinsic content size and
        // destroys the deliberate layout footprint.
        const drawnW =
          typeof node.props.w === "number" ? node.props.w : undefined;
        const drawnH =
          typeof node.props.h === "number" ? node.props.h : undefined;

        if (traits) {
          if (traits.widthMode === "auto" && node.props.widthMode !== "fixed") {
            node.props.widthMode = "auto";
            // Intentionally keep node.props.w as the baseline constraint.
          }
          if (
            traits.heightMode === "auto" &&
            node.props.heightMode !== "fixed"
          ) {
            node.props.heightMode = "auto";
            // Intentionally keep node.props.h as the baseline constraint.
          }
        }

        // Guard against any path that left dimensions undefined: restore the
        // drawn footprint.
        if (drawnW != null && typeof node.props.w !== "number") {
          node.props.w = drawnW;
        }
        if (drawnH != null && typeof node.props.h !== "number") {
          node.props.h = drawnH;
        }
      }
    }),

  deleteComponent: (id) => {
    if (id === "root") return;
    set((state) => {
      const node = state.nodes[id];
      if (!node) return;
      state.pendingVersion++;

      if (node.kind === "captured" && node.capturedMetadata) {
        cleanupCapturedNodeAst(node, state, id);
      }

      state.layerOrder = deleteCapturedNodes(state.nodes, state.layerOrder, id);
      delete state.nodes[id];
      state.layerOrder = state.layerOrder.filter((lid) => lid !== id);
    });
    setTimeout(() => get().garbageCollectAssets(), 0);
  },

  deleteComponents: (ids) => {
    set((state) => {
      state.pendingVersion++;
      const toDeleteSet = new Set(ids);

      for (const id of ids) {
        const node = state.nodes[id];
        if (node && id !== "root") {
          if (node.kind === "captured" && node.capturedMetadata) {
            cleanupCapturedNodeAst(node, state, toDeleteSet);
          }

          state.layerOrder = deleteCapturedNodes(
            state.nodes,
            state.layerOrder,
            id
          );
          delete state.nodes[id];
          state.layerOrder = state.layerOrder.filter((lid) => lid !== id);
        }
      }
    });
    setTimeout(() => get().garbageCollectAssets(), 0);
  },

  discardCapturedNode: (id) => {
    set((state) => {
      const node = state.nodes[id];
      if (!node || node.kind !== "captured") return;
      // Remove the overlay node from the canvas WITHOUT touching the source AST.
      // Use this instead of deleteComponents when the captured element should be
      // dismissed (e.g. after an AI edit) rather than deleted by the user.
      state.layerOrder = deleteCapturedNodes(state.nodes, state.layerOrder, id);
      delete state.nodes[id];
      state.layerOrder = state.layerOrder.filter((lid) => lid !== id);
    });
  },

  discardCapturedNodes: (ids) => {
    if (ids.length === 0) return;
    set((state) => {
      const lookup = new Set(ids);
      const matched: string[] = [];
      for (const id of lookup) {
        const node = state.nodes[id];
        // Only dismiss transient overlays — never touch real components or
        // their AST. In particular, never call cleanupCapturedNodeAst /
        // removeJsxElementByAstIndex here.
        if (node && node.kind === "captured") {
          delete state.nodes[id];
          matched.push(id);
        }
      }
      if (matched.length === 0) return;
      state.pendingVersion++;
      const removeSet = new Set(matched);
      state.layerOrder = state.layerOrder.filter((lid) => !removeSet.has(lid));
    });
  },

  discardCapturedNodesBySourceId: (sourceComponentId) => {
    let deleted: string[] = [];
    set((state) => {
      const toDelete: string[] = [];
      for (const [nid, n] of Object.entries(state.nodes)) {
        if (
          n.kind === "captured" &&
          n.capturedMetadata?.sourceComponentId === sourceComponentId
        ) {
          toDelete.push(nid);
        }
      }
      if (toDelete.length === 0) return;
      // Non-destructive purge: remove overlays WITHOUT touching the source AST
      // (unlike deleteComponents, which parses and deletes JSX elements).
      state.layerOrder = deleteCapturedNodes(
        state.nodes,
        state.layerOrder,
        sourceComponentId
      );
      for (const nid of toDelete) {
        delete state.nodes[nid];
      }
      const removeSet = new Set(toDelete);
      state.layerOrder = state.layerOrder.filter((lid) => !removeSet.has(lid));
      deleted = toDelete;
    });
    return deleted;
  },
  duplicateComponents: (ids, targetPosition) => {
    const newIds: string[] = [];
    set((state) => {
      state.pendingVersion++;

      let minX = Infinity;
      let minY = Infinity;

      const validNodes = ids
        .map((id) => state.nodes[id])
        .filter((n): n is ComponentNodeAny => !!n && n.id !== "root");

      if (validNodes.length === 0) return;

      for (const node of validNodes) {
        if (node.props) {
          minX = Math.min(minX, node.props.x || 0);
          minY = Math.min(minY, node.props.y || 0);
        }
      }

      const offsetX = targetPosition ? targetPosition.x - minX : 20;
      const offsetY = targetPosition ? targetPosition.y - minY : 20;

      // Build ID map for remapping captured references
      const idMap: Record<string, string> = {};

      for (const node of validNodes) {
        const newId = uuidv4();
        const newNode = JSON.parse(JSON.stringify(node)) as ComponentNodeAny;
        newNode.id = newId;
        idMap[node.id] = newId;

        if (newNode.props) {
          newNode.props.x = (newNode.props.x || 0) + offsetX;
          newNode.props.y = (newNode.props.y || 0) + offsetY;
        }

        state.nodes[newId] = newNode;
        newIds.push(newId);

        if (isLayerableNode(newNode)) {
          const originalIndex = state.layerOrder.indexOf(node.id);
          if (originalIndex !== -1) {
            state.layerOrder.splice(originalIndex + 1, 0, newId);
          } else {
            state.layerOrder.push(newId);
          }
        }
      }

      // Remap captured references to point to duplicated components
      remapCapturedReferences(state.nodes, idMap);

      if (newIds.length > 0) {
        applyHierarchy(state, computeHierarchy(state.nodes, newIds));
      }
    });
    return newIds;
  },
  getNode: (id) => get().nodes[id],

  exportJSON: async () => {
    const state = get();

    // Collect only the asset IDs actually referenced in the current canvas
    const referencedIds = new Set<string>();
    for (const node of Object.values(state.nodes)) {
      if (node.code) {
        for (const m of node.code.matchAll(
          new RegExp(ASSET_ID_REGEX.source, "g")
        )) {
          referencedIds.add(m[0]);
        }
        for (const m of node.code.matchAll(
          new RegExp(ASSET_FONT_ID_REGEX.source, "g")
        )) {
          referencedIds.add(m[0]);
        }
      }
    }
    // Also include custom fonts referenced in the theme
    const customFonts = state.themeState?.styles?.light?.customFonts ?? [];
    for (const font of customFonts) {
      if (font.assetId) referencedIds.add(font.assetId);
    }

    // Fetch only the referenced blobs from IndexedDB
    const activeAssets: Record<string, string> = {};
    await Promise.all(
      Array.from(referencedIds).map(async (id) => {
        const blob = await idbGetAsset(id);
        if (blob) activeAssets[id] = blob;
      })
    );

    return JSON.stringify(
      {
        nodes: state.nodes,
        rootId: state.rootId,
        layerOrder: normalizeLayerOrder(
          state.layerOrder,
          state.nodes,
          state.rootId
        ),
        assets: activeAssets,
        themeState: state.themeState,
        currentMode: state.currentMode,
        systemPrompt: state.systemPrompt,
        systemPromptEnabled: state.systemPromptEnabled,
      },
      null,
      2
    );
  },

  importJSON: (json) => {
    try {
      const parsed = JSON.parse(json);
      const sanitizedImport = sanitizeProjectState({
        nodes: parsed.nodes,
        layerOrder: parsed.layerOrder,
        rootId: parsed.rootId,
      });
      const importedNodes: Record<string, any> = sanitizedImport.nodes;
      const importedRootId: string = sanitizedImport.rootId;
      const importedAssets: Record<string, string> = parsed.assets ?? {};
      // NOTE: Import intentionally ignores the file's themeState/currentMode so
      // the active workspace theme and light/dark mode remain untouched.
      const importedThemeState = parsed.themeState;
      // The file's per-project prompt — adopted only when this workspace has
      // none of its own (e.g. importing a .luova onto a blank canvas).
      const importedSystemPrompt =
        typeof parsed.systemPrompt === "string" ? parsed.systemPrompt : "";
      const importedSystemPromptEnabled = parsed.systemPromptEnabled === true;

      // Phase 1: Exclude the imported root, build ID mapping, remap nodes
      const idMap: Record<string, string> = {};
      const nonRootEntries = Object.values(importedNodes).filter(
        (n: any) => n.id !== importedRootId
      );

      // Task 1.2: Generate new UUIDs for every imported node
      for (const node of nonRootEntries) {
        idMap[node.id] = uuidv4();
      }

      // Task 1.3: Deep-clone and remap IDs / parentId / children
      const remappedNodes: Record<string, any> = {};
      for (const node of nonRootEntries) {
        const newId = idMap[node.id];
        const newParentId =
          node.parentId && node.parentId !== importedRootId
            ? idMap[node.parentId]
            : undefined;
        const newChildren = node.children
          ? node.children
              .filter((cid: string) => idMap[cid] !== undefined)
              .map((cid: string) => idMap[cid])
          : undefined;

        remappedNodes[newId] = {
          ...node,
          id: newId,
          parentId: newParentId,
          ...(newChildren !== undefined ? { children: newChildren } : {}),
        };
      }

      // Phase 2: Spatial calculation
      // Task 2.1: Find the bounding box of the imported cluster
      // Safeguard against NaN: explicitly coerce to number with 0 fallback
      let importedMinX = Infinity;
      for (const node of Object.values(remappedNodes) as any[]) {
        const x = Number(node.props?.x) || 0;
        importedMinX = Math.min(importedMinX, x);
      }
      if (!Number.isFinite(importedMinX)) importedMinX = 0;

      // Task 2.2: Find the right-most edge of the existing canvas
      // Safeguard against NaN: explicitly coerce to number with 0 fallback
      const currentNodes = get().nodes;
      const currentRootId = get().rootId;
      let currentMaxX = 0;
      for (const node of Object.values(currentNodes) as any[]) {
        if (node.id === currentRootId) continue;
        const x = Number(node.props?.x) || 0;
        const w = Number(node.props?.w) || 0;
        currentMaxX = Math.max(currentMaxX, x + w);
      }

      // Task 2.3: Strictly horizontal offset
      const IMPORT_PADDING = 100;
      const offsetX = currentMaxX + IMPORT_PADDING - importedMinX;
      const offsetY = 0;

      // Task 2.4: Apply translation, optionally snap to grid
      const { gridConfig } = useCanvasStore.getState();
      const gridSize = gridConfig.snapToGrid ? gridConfig.gridSize : 1;
      const snap = (v: number) =>
        gridConfig.snapToGrid ? Math.round(v / gridSize) * gridSize : v;

      const newIds: string[] = [];
      for (const node of Object.values(remappedNodes) as any[]) {
        // Safeguard against NaN: explicitly coerce coordinates to finite numbers
        const baseX = Number(node.props?.x) || 0;
        const baseY = Number(node.props?.y) || 0;
        node.props = {
          ...node.props,
          x: snap(baseX + offsetX),
          y: snap(baseY + offsetY),
        };
        newIds.push(node.id);
      }

      // Phase 3: Write assets to IndexedDB before updating state
      // so that DynamicRenderer's resolveAssets finds the blobs immediately
      const assetEntries = Object.entries(importedAssets) as [string, string][];
      const assetsReadyPromise =
        assetEntries.length > 0
          ? idbSetAllAssets(importedAssets as Record<string, string>)
          : Promise.resolve();

      // Same epoch guard as loadProjectJSON: a reset during the async asset
      // writes must discard this stale append, not resurrect old nodes.
      const importEpoch = projectLoadEpoch;

      assetsReadyPromise
        .then(() => {
          if (importEpoch !== projectLoadEpoch) return;
          const adoptsPrompt =
            !get().systemPrompt.trim() &&
            importedSystemPrompt.trim().length > 0;
          set((state) => {
            state.pendingVersion++;

            // Adopt the imported project's system prompt when this workspace
            // has none, so "Import" on a blank canvas restores it instead of
            // silently discarding it.
            if (adoptsPrompt) {
              state.systemPrompt = importedSystemPrompt;
              state.systemPromptEnabled = importedSystemPromptEnabled;
            }

            // Append nodes
            for (const node of Object.values(remappedNodes) as any[]) {
              state.nodes[node.id] = node;
            }

            // Remap captured references to point to imported components
            remapCapturedReferences(state.nodes, idMap);

            // Append to layerOrder (only layerable nodes)
            for (const node of Object.values(remappedNodes) as any[]) {
              if (node.kind !== "captured") {
                state.layerOrder = [...state.layerOrder, node.id];
              }
            }
            state.layerOrder = normalizeLayerOrder(
              state.layerOrder,
              state.nodes,
              state.rootId
            );

            // Register asset metadata in Zustand
            for (const [assetId, assetData] of assetEntries) {
              const mimeType = mimeTypeFromBase64(assetData as string);
              const payloadMatch = (assetData as string).match(
                /^data:[^;]+;base64,(.+)$/s
              );
              const size = payloadMatch
                ? Math.round((payloadMatch[1].length * 3) / 4)
                : (assetData as string).length;
              state.assets[assetId] = { mimeType, size };
            }

            // Recompute hierarchy for new nodes
            applyHierarchy(state, computeHierarchy(state.nodes, newIds));
          });
          if (adoptsPrompt && importedSystemPromptEnabled) {
            notifyProjectSystemPrompt();
          }

          // Select newly imported components and pan camera to them
          useUIStore.getState().selectComponents(newIds);

          // Pan camera so the imported cluster is visible. Delegated to the
          // shared helper so imports and AI-created components center using
          // identical bounding-box / viewport math.
          if (newIds.length > 0) {
            centerCameraOnNodes(newIds);
          }

          // Register and hydrate custom fonts referenced by imported components
          // (fonts come from the imported file, but its color tokens/mode are NOT applied)
          if (importedThemeState?.styles?.light?.customFonts) {
            const customFonts = importedThemeState.styles.light.customFonts;
            for (const font of customFonts) {
              if (font.family) {
                registerCustomFont(font.family);
              }
            }
            // Wait for assets to be in IDB, then load font blobs
            loadCustomFont(customFonts).catch((err) =>
              console.error(
                "[fonts] Failed to load custom fonts on import:",
                err
              )
            );
          }

          // Auto zoom to fit after import
          setTimeout(() => {
            const container = document.querySelector("[data-canvas-container]");
            if (container) {
              const rect = container.getBoundingClientRect();
              useCanvasStore.getState().zoomToFit(rect.width, rect.height);
            }
          }, 0);
        })
        .catch((err) => {
          console.error(
            "[project-slice] Failed to import assets to IndexedDB:",
            err
          );
        });
    } catch (error) {
      console.error("Import failed:", error);
      throw error;
    }
  },

  loadProjectJSON: (json, options) => {
    try {
      const parsed = JSON.parse(json);

      // ============================================================
      // VALIDATION: Guard against malformed or partial project loads
      // ============================================================
      // A valid project MUST have these essential root-level keys
      if (!parsed.nodes || typeof parsed.nodes !== "object") {
        throw new Error(
          "Invalid project: missing or malformed 'nodes' property"
        );
      }
      if (!parsed.rootId || typeof parsed.rootId !== "string") {
        throw new Error(
          "Invalid project: missing or malformed 'rootId' property"
        );
      }
      // layerOrder is optional (defaults to [])
      if (
        parsed.layerOrder !== undefined &&
        !Array.isArray(parsed.layerOrder)
      ) {
        throw new Error("Invalid project: malformed 'layerOrder' property");
      }
      // themeState is optional, but if present should be an object
      if (
        parsed.themeState !== undefined &&
        typeof parsed.themeState !== "object"
      ) {
        throw new Error("Invalid project: malformed 'themeState' property");
      }

      const sanitizedLoad = sanitizeProjectState({
        nodes: parsed.nodes,
        layerOrder: parsed.layerOrder,
        rootId: parsed.rootId,
      });
      if (sanitizedLoad.removedIds.length > 0) {
        console.warn(
          "[project-slice] loadProjectJSON dropped invalid nodes:",
          sanitizedLoad.removedIds
        );
      }
      const loadedNodes: Record<string, ComponentNodeAny> = sanitizedLoad.nodes;
      const loadedRootId: string = sanitizedLoad.rootId;
      // Assets in the JSON file are full base64 data URIs (from exportJSON)
      const loadedAssetsRaw: Record<string, string> = parsed.assets ?? {};
      const loadedThemeState = parsed.themeState;
      const loadedCurrentMode = parsed.currentMode ?? "light";
      // Per-project AI prompt. A file without one clears it.
      const loadedSystemPrompt =
        typeof parsed.systemPrompt === "string" ? parsed.systemPrompt : "";
      const loadedSystemPromptEnabled = parsed.systemPromptEnabled === true;

      const bringsOwnPrompt =
        loadedSystemPromptEnabled &&
        loadedSystemPrompt.trim().length > 0 &&
        loadedSystemPrompt !== get().systemPrompt;

      // Apply the prompt immediately (synchronously): unlike nodes/assets it
      // has no IndexedDB dependency, so there is no reason to defer it behind
      // the asset writes below. Deferring it would let a prompt typed by the
      // user while a large (old) project loads be clobbered back to the file's
      // value once the deferred block finally runs.
      set((state) => {
        state.systemPrompt = loadedSystemPrompt;
        state.systemPromptEnabled = loadedSystemPromptEnabled;
      });

      // Build lightweight metadata map for Zustand
      const loadedAssetsMeta: Record<string, AssetMeta> = {};
      for (const [assetId, base64] of Object.entries(loadedAssetsRaw)) {
        const mimeType = mimeTypeFromBase64(base64);
        const payloadMatch = base64.match(/^data:[^;]+;base64,(.+)$/s);
        const size = payloadMatch
          ? Math.round((payloadMatch[1].length * 3) / 4)
          : base64.length;
        loadedAssetsMeta[assetId] = { mimeType, size };
      }

      // Write blobs to IDB (replace all — this is a full project load)
      // Use promise to ensure fonts load AFTER assets are in IDB
      const assetsReadyPromise =
        Object.keys(loadedAssetsRaw).length > 0
          ? idbClearAllAssets().then(() => idbSetAllAssets(loadedAssetsRaw))
          : idbClearAllAssets();

      // Epoch captured now: if a New Project reset (or another load) lands
      // while the asset writes are in flight, this stale swap must not
      // clobber the newer state when it finally runs.
      const loadEpoch = projectLoadEpoch;

      // Defer state update until IndexedDB writes complete so that
      // DynamicRenderer's resolveAssets finds the blobs immediately
      assetsReadyPromise
        .then(() => {
          if (loadEpoch !== projectLoadEpoch) return;
          // Once the project has actually opened — after (and so in front
          // of) the caller's "Opened" toast.
          if (bringsOwnPrompt) notifyProjectSystemPrompt();
          set((state) => {
            // Directly overwrite state without generating new UUIDs
            state.pendingVersion++;
            // Freshly loaded file is "clean" — no unsaved changes yet.
            state.lastSyncedVersion = state.pendingVersion;
            state.nodes = loadedNodes;
            state.rootId = loadedRootId;
            state.assets = loadedAssetsMeta;
            // Keep the file handle atomic with the load: when the caller
            // passes a handle (e.g. Open / restore), bind it; otherwise
            // preserve any existing handle instead of wiping it. Callers
            // that want a clean slate (New Project) clear it explicitly.
            if (options && "handle" in options) {
              state.fileHandle = options.handle ?? null;
              if (options.fileName !== undefined) {
                state.fileName = options.fileName;
              } else if (options.handle) {
                state.fileName =
                  (options.handle as any)?.name ?? state.fileName;
              } else {
                state.fileName = null;
              }
            } else if (options?.fileName !== undefined) {
              state.fileName = options.fileName;
            }
            // NOTE: no unconditional `state.fileHandle = null` here — see above.

            // Update theme and mode directly in this state update
            if (loadedThemeState) {
              state.themeState = loadedThemeState;
            }
            if (loadedCurrentMode) {
              state.currentMode = loadedCurrentMode;
            }

            state.layerOrder = normalizeLayerOrder(
              sanitizedLoad.layerOrder,
              state.nodes,
              state.rootId
            );

            // Synchronize every node's props.zIndex with its 1-based position
            // so rehydrated elements carry their persisted stacking order.
            state.layerOrder.forEach((lid, index) => {
              const node = state.nodes[lid];
              if (!node?.props) return;
              (node.props as Record<string, unknown>).zIndex = index + 1;
            });

            // Recompute hierarchy
            applyHierarchy(
              state,
              computeHierarchy(
                state.nodes,
                Object.keys(loadedNodes).filter((id) => id !== loadedRootId)
              )
            );
          });

          // Clear UI selections and reset panel state
          useUIStore.getState().reset();

          // Persist a handle passed with the load (Open flow) so reloads
          // keep writing back to the same file.
          if (options && "handle" in options && options.handle) {
            import("@/lib/file-handle-storage")
              .then(({ idbSetFileHandle }) =>
                idbSetFileHandle(options.handle as any, {
                  fileName:
                    options.fileName ??
                    (options.handle as any)?.name ??
                    get().fileName,
                })
              )
              .catch(() => undefined);
          }

          // Commit theme CSS to document (after state is updated)
          ThemeEngine.commitThemeToCompiledCSS();

          // Hydrate font registry for custom fonts and load them
          if (loadedThemeState?.styles?.light?.customFonts) {
            const customFonts = loadedThemeState.styles.light.customFonts;
            for (const font of customFonts) {
              if (font.family) {
                registerCustomFont(font.family);
              }
            }
            // Wait for assets, then load fonts
            loadCustomFont(customFonts).catch((err) =>
              console.error(
                "[fonts] Failed to load custom fonts on project load:",
                err
              )
            );
          }

          // Auto zoom to fit after load
          setTimeout(() => {
            const container = document.querySelector("[data-canvas-container]");
            if (container) {
              const rect = container.getBoundingClientRect();
              useCanvasStore.getState().zoomToFit(rect.width, rect.height);
            }
          }, 0);
        })
        .catch((err) => {
          console.error(
            "[project-slice] Failed to write assets to IndexedDB on project load:",
            err
          );
        });
    } catch (error) {
      console.error("Load project failed:", error);
      throw error;
    }
  },

  ingestElement: (astIndex, boundingBox, label, sourceComponentId) => {
    const state = get();
    const astIndexStr = String(astIndex);

    // Deduplication check: look for an existing captured node for this element
    for (const node of Object.values(state.nodes)) {
      if (
        node.kind === "captured" &&
        node.capturedMetadata?.sourceComponentId === sourceComponentId &&
        node.capturedMetadata?.astIndex === astIndexStr
      ) {
        // Match found: return existing node ID without creating a new one
        return node.id;
      }
    }

    // Capture original state before creating the node
    let originalClasses: string[] = [];
    let originalStyle = "";
    let elementFingerprint = "";
    const sourceNode = sourceComponentId
      ? state.nodes[sourceComponentId]
      : null;
    if (sourceNode?.code) {
      try {
        originalClasses = extractJsxClassNamesByAstIndex(
          sourceNode.code,
          astIndex
        );
        originalStyle = extractJsxStyleByAstIndex(sourceNode.code, astIndex);
        elementFingerprint = computeElementFingerprint(
          sourceNode.code,
          astIndex
        );
      } catch (err) {
        console.warn("Failed to capture original state for element:", err);
      }
    }

    // No match found: create new captured node
    const newNode = createCapturedNode(
      astIndexStr,
      boundingBox,
      label ?? "",
      sourceComponentId,
      originalClasses,
      originalStyle,
      elementFingerprint
    );
    set((state) => {
      state.pendingVersion++;
      state.nodes[newNode.id] = newNode;
      state.layerOrder = [...state.layerOrder, newNode.id];
      applyHierarchy(state, computeHierarchy(state.nodes, [newNode.id]));
    });
    return newNode.id;
  },

  resetCapturedElement: (id) => {
    set((state) => {
      const node = state.nodes[id];
      if (node?.kind !== "captured" || !node.capturedMetadata) return;

      const { sourceComponentId, astIndex, originalClasses, originalStyle } =
        node.capturedMetadata;
      const sourceNode = state.nodes[sourceComponentId];
      if (!sourceNode?.code) return;

      const astIndexNum = parseInt(astIndex, 10);
      if (Number.isNaN(astIndexNum)) return;
      node.capturedMetadata.hasEdits = false;
      node.comment = "";

      // 1. Replace classes with originalClasses
      const currentClasses = extractJsxClassNamesByAstIndex(
        sourceNode.code,
        astIndexNum
      );
      sourceNode.code = updateJsxClassNameByAstIndex(
        sourceNode.code,
        astIndexNum,
        originalClasses || [],
        currentClasses
      );

      // 2. Replace style with originalStyle
      sourceNode.code = setJsxStyleByAstIndex(
        sourceNode.code,
        astIndexNum,
        originalStyle || ""
      );

      // 3. Clear mode-aware custom properties (gradients/shadows)
      // These might still be present if they were added via updateJsxModeAwareStyle
      // and aren't part of originalStyle.
      const modeVars = [
        "--luova-bg-light",
        "--luova-bg-dark",
        "--luova-shadow-light",
        "--luova-shadow-dark",
        "--luova-border-light",
        "--luova-border-dark",
        "--luova-border-width",
      ];

      for (const v of modeVars) {
        sourceNode.code = updateJsxStyleByAstIndex(
          sourceNode.code,
          astIndexNum,
          v,
          null
        );
      }
    });
  },

  markCapturedNodeEdited: (id) => {
    // Bookkeeping that follows a code change, not a step of its own.
    get().withoutHistory(() =>
      set((state) => {
        const node = state.nodes[id];
        if (!node || node.kind !== "captured" || !node.capturedMetadata) return;

        state.pendingVersion++;
        node.capturedMetadata.hasEdits = true;

        // An Edit mode change makes a Text element a regular element: the
        // text panel's formatting tools rewrite the whole element's code and
        // would undo the edits (background, padding…), so they're retired.
        const source = state.nodes[node.capturedMetadata.sourceComponentId];
        if (source?.type === "Text") source.type = "Container";
      })
    );
  },

  addWireframeComponent: (type, position, size) => {
    const newNode = createWireframeNode(type, position, size);
    set((state) => {
      state.pendingVersion++;
      state.nodes[newNode.id] = newNode;
      if (isLayerableNode(newNode)) {
        state.layerOrder = [...state.layerOrder, newNode.id];
      }
      // Full hierarchy recompute: guarantees immediate parentId/children
      // assignment regardless of draw order (child-first or parent-first).
      // Incremental mode (only [newNode.id]) would miss the case where the
      // newly drawn wireframe is a CONTAINER encompassing pre-existing
      // wireframes — their parentId would never be re-evaluated.
      applyHierarchy(state, computeHierarchy(state.nodes));
    });
    return newNode.id;
  },

  addSkeletonComponents: (items) => {
    const usedIds = new Set<string>();
    const newNodes = items.map((item) => {
      const requestedId =
        typeof (item as { id?: unknown }).id === "string" &&
        ((item as { id?: string }).id as string).trim() !== ""
          ? ((item as { id?: string }).id as string)
          : null;
      let id = requestedId ?? uuidv4();
      // Ensure uniqueness against existing nodes and within this batch.
      // Fall back to a generated UUID on collision rather than overwriting.
      const existingNodes = get().nodes;
      while (existingNodes[id] || usedIds.has(id)) {
        id = uuidv4();
      }
      usedIds.add(id);
      return {
        id,
        type: item.componentType as ComponentType,
        kind: "draft" as const,
        props: {
          x: item.x,
          y: item.y,
          w: item.w,
          h: item.h,
          positionType: "absolute" as const,
          widthMode: "fixed" as const,
          heightMode: "fixed" as const,
        },
        code: "",
      };
    });

    set((state) => {
      state.pendingVersion++;
      for (const node of newNodes) {
        state.nodes[node.id] = node;
        state.layerOrder = [...state.layerOrder, node.id];
      }
      applyHierarchy(
        state,
        computeHierarchy(
          state.nodes,
          newNodes.map((n) => n.id)
        )
      );
    });

    return newNodes.map((n) => n.id);
  },

  updateNodeComment: (id, comment) =>
    set((state) => {
      const node = state.nodes[id];
      if (!node || node.comment === comment) return;
      state.pendingVersion++;
      node.comment = comment;
    }),

  updateAnnotationOffset: (id, offset) =>
    set((state) => {
      const node = state.nodes[id];
      if (!node) return;
      const MAX_OFFSET = 4000;
      const clamp = (n: number) =>
        Math.round(Math.min(MAX_OFFSET, Math.max(-MAX_OFFSET, n)));
      const clamped = {
        x: Number.isFinite(offset.x) ? clamp(offset.x) : 0,
        y: Number.isFinite(offset.y) ? clamp(offset.y) : 0,
      };
      if (
        node.annotationOffset?.x === clamped.x &&
        node.annotationOffset?.y === clamped.y
      )
        return;
      state.pendingVersion++;
      node.annotationOffset = clamped;
    }),

  updateComponentType: (id, type) =>
    set((state) => {
      const node = state.nodes[id];
      if (!node || node.type === type) return;
      if (typeof type !== "string" || type.trim() === "") return;
      state.pendingVersion++;
      node.type = type;
    }),

  moveNodes: (updates, gridConfig) => {
    set((state) => {
      let changed = false;
      const movedIds: string[] = [];

      updates.forEach(({ id, x, y }) => {
        const node = state.nodes[id];
        if (!node?.props) return;

        const nextPosition = gridConfig?.snapToGrid
          ? calculateNewPosition(
              { x: node.props.x, y: node.props.y },
              { x, y },
              gridConfig
            )
          : { x: Math.round(x), y: Math.round(y) };

        const dx = nextPosition.x - node.props.x;
        const dy = nextPosition.y - node.props.y;

        if (dx !== 0 || dy !== 0) {
          node.props.x = nextPosition.x;
          node.props.y = nextPosition.y;
          changed = true;
          movedIds.push(id);
          syncCapturedNodePositions(state.nodes, id, dx, dy);
        }
      });

      if (changed) {
        state.pendingVersion++;
        applyHierarchy(state, computeHierarchy(state.nodes, movedIds));
      }
    });
  },

  resizeNode: (id, w, h, gridConfig) => {
    set((state) => {
      const node = state.nodes[id];
      if (!node?.props) return;

      const nextSize = gridConfig?.snapToGrid
        ? calculateNewSize(
            { width: node.props.w ?? 0, height: node.props.h ?? 0 },
            { width: w, height: h },
            gridConfig
          )
        : { width: Math.round(w), height: Math.round(h) };

      if (node.props.w !== nextSize.width || node.props.h !== nextSize.height) {
        state.pendingVersion++;
        node.props.w = nextSize.width;
        node.props.h = nextSize.height;
        applyHierarchy(state, computeHierarchy(state.nodes, [id]));
      }
    });
  },

  updateLayouts: (updates, gridConfig) => {
    set((state) => {
      let changed = false;
      const movedIds: string[] = [];

      const updatesWithCoords = updates.map((u) => {
        const node = state.nodes[u.id];
        if (!node?.props) return u;

        let finalX = u.x;
        let finalY = u.y;
        let finalW = u.w;
        let finalH = u.h;

        if (u.x !== undefined && u.y !== undefined) {
          const nextPosition = gridConfig?.snapToGrid
            ? calculateNewPosition(
                { x: node.props.x, y: node.props.y },
                { x: u.x, y: u.y },
                gridConfig
              )
            : { x: Math.round(u.x), y: Math.round(u.y) };
          finalX = nextPosition.x;
          finalY = nextPosition.y;
        }

        if (u.w !== undefined && u.h !== undefined) {
          const nextSize = gridConfig?.snapToGrid
            ? calculateNewSize(
                { width: node.props.w ?? 0, height: node.props.h ?? 0 },
                { width: u.w, height: u.h },
                gridConfig
              )
            : { width: Math.round(u.w), height: Math.round(u.h) };
          finalW = nextSize.width;
          finalH = nextSize.height;
        }

        return { ...u, x: finalX, y: finalY, w: finalW, h: finalH };
      });

      for (const u of updatesWithCoords) {
        const node = state.nodes[u.id];
        if (!node?.props) continue;

        const originalX = node.props.x;
        const originalY = node.props.y;
        let nodeChanged = false;

        if (u.x !== undefined && u.y !== undefined) {
          if (node.props.x !== u.x || node.props.y !== u.y) {
            node.props.x = u.x;
            node.props.y = u.y;
            nodeChanged = true;
            movedIds.push(u.id);
          }
        }

        if (u.w !== undefined && u.h !== undefined) {
          if (node.props.w !== u.w || node.props.h !== u.h) {
            node.props.w = u.w;
            node.props.h = u.h;
            nodeChanged = true;
          }
        }

        if (u.widthMode !== undefined && node.props.widthMode !== u.widthMode) {
          node.props.widthMode = u.widthMode;
          nodeChanged = true;
        }
        if (
          u.heightMode !== undefined &&
          node.props.heightMode !== u.heightMode
        ) {
          node.props.heightMode = u.heightMode;
          nodeChanged = true;
        }

        if (nodeChanged) {
          changed = true;
        }

        if (
          (u.x !== undefined || u.y !== undefined) &&
          (u.x !== originalX || u.y !== originalY)
        ) {
          syncCapturedNodePositions(
            state.nodes,
            u.id,
            u.x! - originalX,
            u.y! - originalY
          );
        }
      }

      if (changed) {
        state.pendingVersion++;
        applyHierarchy(state, computeHierarchy(state.nodes, movedIds));
      }
    });
  },

  pauseHistory: () => {
    (store as any).temporal.getState().pause();
  },

  resumeHistory: () => {
    (store as any).temporal.getState().resume();
  },

  withoutHistory: (fn) => {
    const temporal = (store as any).temporal.getState();
    const tracking = temporal.isTracking !== false;
    if (tracking) temporal.pause();
    try {
      fn();
    } finally {
      if (tracking) temporal.resume();
    }
  },

  withBatchedHistory: <T>(fn: () => T): T => {
    const appStore = store as any;
    const temporal = appStore.temporal.getState() as TemporalStateExt;
    const wasTracking = (temporal as any).isTracking;

    // If history tracking is already paused (e.g. during an AI stream),
    // just run the function without wrapping it in a batch. This prevents
    // withBatchedHistory from inadvertently resuming tracking mid-stream and
    // leaking intermediate states into the undo stack.
    if (wasTracking === false) {
      return fn();
    }

    const s = appStore.getState();
    const preState = toHistoryState({
      nodes: s.nodes,
      themeState: s.themeState,
      currentMode: s.currentMode,
      layerOrder: s.layerOrder,
      rootId: s.rootId,
      assets: s.assets,
    });
    temporal.pause();
    let result: T;
    try {
      result = fn();
    } finally {
      temporal.resume();
      const currentS = appStore.getState();
      const currentState = toHistoryState({
        nodes: currentS.nodes,
        themeState: currentS.themeState,
        currentMode: currentS.currentMode,
        layerOrder: currentS.layerOrder,
        rootId: currentS.rootId,
        assets: currentS.assets,
      });
      temporal.commitHistory(preState, currentState);
    }
    return result!;
  },

  commitHistory: (preState?: Record<string, unknown>) => {
    const appStore = store as any;
    const temporal = appStore.temporal.getState() as TemporalStateExt;
    const s = appStore.getState();
    const currentState = toHistoryState({
      nodes: s.nodes,
      themeState: s.themeState,
      currentMode: s.currentMode,
      layerOrder: s.layerOrder,
      rootId: s.rootId,
      assets: s.assets,
    });
    // Filter preState if provided, otherwise use currentState as the baseline
    const past = preState ? toHistoryState(preState as any) : currentState;
    temporal.commitHistory(past, currentState);
  },

  hasUnsavedChanges: (): boolean => {
    const state = get();
    return state.pendingVersion !== state.lastSyncedVersion;
  },

  canUndo: (): boolean =>
    (store as any).temporal.getState().pastStates.length > 0,

  canRedo: (): boolean =>
    (store as any).temporal.getState().futureStates.length > 0,

  reset: () => {
    // Invalidate any in-flight loadProjectJSON/importJSON deferred swaps so
    // their stale state can never land after this fresh slate.
    projectLoadEpoch++;
    ThemeEngine.clearAllThemeCSSVariables();
    componentStyleManager.clearAll();
    useUIStore.getState().reset();

    // Revoke all cached Blob URLs to prevent memory leaks
    const currentAssets = get().assets;
    for (const assetId of Object.keys(currentAssets)) {
      revokeAssetBlobUrl(assetId);
    }

    // Wipe all asset blobs from IndexedDB (fire-and-forget)
    idbClearAllAssets().catch((err) =>
      console.error("[asset-idb] Failed to clear assets on reset:", err)
    );

    // Clear the persisted file handle (fire-and-forget)
    import("@/lib/file-handle-storage")
      .then(({ idbClearFileHandle }) => idbClearFileHandle())
      .catch(() => undefined);

    set((state: any) => {
      state.nodes = { root: createRootNode() };
      state.rootId = "root";
      state.layerOrder = [];
      state.pendingVersion = 1;
      // Fresh canvas is "clean" (no unsaved changes)
      state.lastSyncedVersion = state.pendingVersion;
      // Clear asset metadata so Zustand stays in sync with IDB
      state.assets = {};
      // Clear file handle since we're starting fresh
      state.fileHandle = null;
      state.fileName = null;
      state.isSaving = false;
      // Per-project AI prompt is cleared on a fresh slate (New Project).
      state.systemPrompt = "";
      state.systemPromptEnabled = false;
      // Reset theme state to defaults (never undefined — subscribers such as
      // ThemeStyleBlock render on every notified state, including the
      // intermediate state between this slice's reset and the theme slice's
      // reset in the composed app-store reset).
      state.themeState = defaultThemeState;
      state.currentMode = "light";
    });
  },

  garbageCollectAssets: () => {
    const state = get();
    const trackedIds = Object.keys(state.assets);
    if (trackedIds.length === 0) return;

    const referencedIds = new Set<string>();

    /**
     * Scans a snapshot of nodes + themeState for all asset ID references
     * and adds them to the referencedIds set.
     */
    function scanSnapshot(
      nodes: Record<string, import("@/types/builder").ComponentNodeAny>,
      themeState: import("@/types/editor").ThemeEditorState
    ): void {
      // Scan node source code for image and font asset IDs
      for (const node of Object.values(nodes)) {
        if (node.code) {
          const imageMatches = node.code.matchAll(
            new RegExp(ASSET_ID_REGEX.source, "g")
          );
          for (const m of imageMatches) referencedIds.add(m[0]);

          const fontMatches = node.code.matchAll(
            new RegExp(ASSET_FONT_ID_REGEX.source, "g")
          );
          for (const m of fontMatches) referencedIds.add(m[0]);
        }
      }

      // Scan custom fonts registered in the theme
      const customFonts = themeState?.styles?.light?.customFonts ?? [];
      for (const font of customFonts) {
        if (font.assetId) referencedIds.add(font.assetId);
      }
    }

    // 1. Scan current live state
    scanSnapshot(state.nodes, state.themeState);

    // 2. Scan every snapshot in the undo/redo temporal history
    const temporal = (store as any).temporal.getState();
    const pastStates: Array<Partial<typeof state>> = temporal.pastStates ?? [];
    const futureStates: Array<Partial<typeof state>> =
      temporal.futureStates ?? [];

    for (const snapshot of [...pastStates, ...futureStates]) {
      if (snapshot.nodes && snapshot.themeState) {
        scanSnapshot(
          snapshot.nodes as Record<
            string,
            import("@/types/builder").ComponentNodeAny
          >,
          snapshot.themeState as import("@/types/editor").ThemeEditorState
        );
      }
    }

    // 3. Delete any tracked asset that is no longer referenced anywhere
    const orphanIds = trackedIds.filter((id) => !referencedIds.has(id));
    if (orphanIds.length === 0) return;

    // Revoke orphaned Blob URLs before deleting from state
    for (const id of orphanIds) {
      revokeAssetBlobUrl(id);
    }

    set((s) => {
      for (const id of orphanIds) {
        delete s.assets[id];
      }
    });

    for (const id of orphanIds) {
      idbDeleteAsset(id).catch((err) =>
        console.error("[asset-idb] GC failed to delete asset:", id, err)
      );
    }
  },
});
