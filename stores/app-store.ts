"use client";

import { toast } from "sonner";
import { temporal } from "zundo";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { isDeepEqual } from "@/lib/luova-utils";
import { sanitizeProjectState } from "@/utils/node-validation";
import { createCanvasHierarchySlice } from "./slices/canvas-hierarchy-slice";
import { createProjectSlice } from "./slices/project-slice";
import { createThemeSlice } from "./slices/theme-slice";
import type { AppStore } from "./types";

// False once another tab has taken over editing (see use-workspace-lock):
// this tab's in-memory project is then stale and must never be written.
let persistenceEnabled = true;
let autosaveFailureShown = false;

function writeToStorage(name: string, value: string) {
  if (!persistenceEnabled) return;
  try {
    localStorage.setItem(name, value);
    autosaveFailureShown = false;
  } catch (error) {
    // Usually QuotaExceededError: the project outgrew browser storage.
    console.error("[app-store] Autosave failed:", error);
    if (!autosaveFailureShown) {
      autosaveFailureShown = true;
      toast.error("Autosave failed — browser storage is full", {
        description:
          "Recent changes aren't saved in the browser. Save the project to a file (⌘S / Ctrl+S) to keep them.",
        duration: Number.POSITIVE_INFINITY,
      });
    }
  }
}

// Debounced localStorage adapter for persist middleware (D1).
// Coalesces writes within a 250 ms window to avoid synchronous full-state
// JSON.stringify + localStorage.setItem on every pointer-move token update.
const debouncedStorage: Storage = {
  get length() {
    return localStorage.length;
  },
  clear() {
    localStorage.clear();
  },
  getItem(name: string): string | null {
    return localStorage.getItem(name);
  },
  key(index: number): string | null {
    return localStorage.key(index);
  },
  removeItem(name: string): void {
    localStorage.removeItem(name);
  },
  setItem: (() => {
    let pendingName: string | null = null;
    let pendingValue: string | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const write = (name: string, value: string) => {
      pendingName = name;
      pendingValue = value;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (pendingName !== null && pendingValue !== null) {
          writeToStorage(pendingName, pendingValue);
        }
        pendingName = null;
        pendingValue = null;
        timer = null;
      }, 250);
    };

    // Expose flush for page unload safety
    (write as any).flush = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (pendingName !== null && pendingValue !== null) {
        writeToStorage(pendingName, pendingValue);
      }
      pendingName = null;
      pendingValue = null;
    };

    return write;
  })(),
};

function flushPendingWrite() {
  (debouncedStorage.setItem as any).flush();
}

// Flush any pending debounced write before the page unloads, and when the
// tab is hidden — so another tab taking over always reads the latest state.
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", flushPendingWrite);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushPendingWrite();
  });
}

/** Another tab took over editing: save what's pending, then stop writing. */
export function disableWorkspacePersistence() {
  flushPendingWrite();
  persistenceEnabled = false;
}

/**
 * History snapshot of a state. Captured edits (the Edit-mode overlays) are
 * part of history so creating one is its own undo step and undoing a style
 * change keeps the edit open. Their frame (x/y/w/h) follows the live DOM and
 * is resynced constantly, so it is pinned to the captured rect here: frame
 * syncs never create undo steps.
 */
export function toHistoryState<T extends { nodes: Record<string, any> }>(
  state: T
): T {
  let nodes: Record<string, any> | null = null;
  for (const [id, node] of Object.entries(state.nodes)) {
    const rect =
      node?.kind === "captured" && node.capturedMetadata?.originalRect;
    if (!rect) continue;
    nodes ??= { ...state.nodes };
    nodes[id] = {
      ...node,
      props: { ...node.props, x: rect.x, y: rect.y, w: rect.w, h: rect.h },
    };
  }
  return nodes ? { ...state, nodes } : state;
}

type HistoryApi = {
  getState: () => AppStore;
  temporal: { getState: () => any };
};

const historyFields = (s: AppStore) =>
  toHistoryState({
    nodes: s.nodes,
    themeState: s.themeState,
    currentMode: s.currentMode,
    layerOrder: s.layerOrder,
    rootId: s.rootId,
  });

/**
 * Undo or redo one step that changes something visible, then put the live
 * frame back on captured edits that are still there (snapshots store them
 * pinned, see toHistoryState) without recording that as a step.
 */
function stepHistory(
  api: HistoryApi,
  set: (fn: (state: AppStore) => void) => void,
  direction: "undo" | "redo"
) {
  const temporal = () => api.temporal.getState();
  const stack = () =>
    direction === "undo" ? temporal().pastStates : temporal().futureStates;
  const before = api.getState();
  const beforeSnapshot = historyFields(before);
  if (stack().length === 0) return;
  // Skip steps that change nothing, e.g. the creation of an empty edit that
  // was discarded when it was deselected.
  do {
    temporal()[direction]();
  } while (
    stack().length > 0 &&
    isDeepEqual(historyFields(api.getState()), beforeSnapshot)
  );

  const after = api.getState();
  const live = Object.keys(after.nodes).filter(
    (id) =>
      after.nodes[id]?.kind === "captured" &&
      before.nodes[id]?.kind === "captured"
  );
  if (live.length === 0) return;
  const tracking = temporal().isTracking !== false;
  if (tracking) temporal().pause();
  try {
    set((state) => {
      for (const id of live) {
        const { x, y, w, h } = before.nodes[id].props;
        Object.assign(state.nodes[id].props, { x, y, w, h });
      }
    });
  } finally {
    if (tracking) temporal().resume();
  }
}

export const useAppStore = create<AppStore>()(
  persist(
    temporal(
      immer((set, get, store) => {
        const projectSlice = createProjectSlice(
          set as any,
          get as any,
          store as any
        );
        const hierarchySlice = createCanvasHierarchySlice(
          set as any,
          get as any,
          store as any
        );
        const themeSlice = createThemeSlice(
          set as any,
          get as any,
          store as any
        );
        return {
          ...projectSlice,
          ...hierarchySlice,
          ...themeSlice,
          /**
           * Composed reset: both the project and theme slices define `reset`
           * (the theme spread would otherwise shadow the project's). Run both
           * so resetting clears the canvas (nodes, assets, file handle) and
           * restores the default theme.
           */
          reset: () => {
            projectSlice.reset();
            themeSlice.reset();
          },
          // One undo/redo for the whole store (both slices define their own).
          undo: () => stepHistory(store as any, set as any, "undo"),
          redo: () => stepHistory(store as any, set as any, "redo"),
        };
      }),
      {
        limit: 50,
        equality: isDeepEqual,
        partialize: (state) => {
          const stripped = toHistoryState(state);
          return {
            nodes: stripped.nodes,
            themeState: stripped.themeState,
            currentMode: stripped.currentMode,
            layerOrder: stripped.layerOrder,
            rootId: stripped.rootId,
          } as AppStore;
        },
        wrapTemporal: (temporalInitializer) => (set, get, api) => {
          const temporalState = temporalInitializer(set, get, api);
          return {
            ...temporalState,
            commitHistory(
              pastState: Record<string, unknown>,
              currentState: Record<string, unknown>
            ) {
              // Filter out captured nodes from both states before committing to history
              // This ensures that no ephemeral overlays leak into undo/redo snapshots
              const filteredPast = toHistoryState(pastState as any);
              const filteredCurrent = toHistoryState(currentState as any);

              // Skip empty history commits if filtered states are identical
              if (isDeepEqual(filteredPast, filteredCurrent)) {
                return;
              }

              const state = get();
              set({
                pastStates: [...state.pastStates, filteredPast],
                futureStates: [],
              });
            },
          };
        },
      }
    ),
    {
      name: "luova-app-storage",
      version: 1,
      storage: createJSONStorage(() => debouncedStorage),
      partialize: (state) => ({
        nodes: state.nodes,
        themeState: state.themeState,
        currentMode: state.currentMode,
        layerOrder: state.layerOrder,
        rootId: state.rootId,
        assets: state.assets,
        systemPrompt: state.systemPrompt,
        systemPromptEnabled: state.systemPromptEnabled,
      }),
      // Self-healing rehydration: records persisted before validation
      // (e.g. typeless nodes from the AI pipeline) are repaired/dropped
      // here so one bad node can never brick the app on reload.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Record<string, any>;
        const sanitized = sanitizeProjectState({
          nodes: p.nodes,
          layerOrder: p.layerOrder,
          rootId: p.rootId,
        });
        if (sanitized.removedIds.length > 0) {
          console.warn(
            "[luova] Repaired persisted project state, removed:",
            sanitized.removedIds
          );
        }
        return {
          ...current,
          ...(persisted as object),
          nodes: sanitized.nodes,
          layerOrder: sanitized.layerOrder,
          rootId: sanitized.rootId,
        } as AppStore;
      },
    }
  )
);

export type { AppStore };
