import type { StateCreator } from "zustand";
import type {
  ComponentNodeAny,
  ComponentType,
  GridConfig,
  SizingMode,
} from "@/types/builder";
import type { ThemeEditorState } from "@/types/editor";

/**
 * Lightweight metadata stored in Zustand/localStorage for each asset.
 * The actual binary data (base64) lives in IndexedDB — never in localStorage.
 */
export interface AssetMeta {
  mimeType: string;
  size: number;
  /** Original filename, if available */
  name?: string;
}

export interface ProjectSlice {
  nodes: Record<string, ComponentNodeAny>;
  rootId: string;
  layerOrder: string[];
  lastSyncedVersion: number;
  pendingVersion: number;
  /**
   * Asset metadata registry: maps short asset IDs to lightweight metadata.
   * The actual base64 data is stored in IndexedDB via lib/asset-idb.ts.
   */
  assets: Record<string, AssetMeta>;
  /** Clipboard: stores copied/cut component nodes */
  clipboard: ComponentNodeAny[];
  /**
   * File System Access API handle for the currently opened project file.
   * Transient state (not persisted to localStorage — persisted to IndexedDB).
   */
  fileHandle: any | null;
  /**
   * Human-readable name of the active project file (e.g. `my-project.luova`).
   * Null when the project is untitled (no disk file bound yet).
   */
  fileName: string | null;
  /** True while a Save / Save As write is in flight (for UI feedback). */
  isSaving: boolean;
  /**
   * Per-project AI system prompt. Serialized into the `.luova` project file so
   * each project carries its own instructions, and cleared on New Project.
   */
  systemPrompt: string;
  /** Whether the per-project AI system prompt is applied to AI requests. */
  systemPromptEnabled: boolean;
  /**
   * Set the file handle for the current project (used by Save workflow).
   */
  setFileHandle: (handle: any | null) => void;
  /** Set the display name of the active project file. */
  setFileName: (name: string | null) => void;
  /** Toggle the saving indicator. */
  setIsSaving: (isSaving: boolean) => void;
  /** Set the per-project AI system prompt (saved into the .luova file). */
  setSystemPrompt: (prompt: string) => void;
  /** Enable/disable the per-project AI system prompt. */
  setSystemPromptEnabled: (enabled: boolean) => void;
  /**
   * Stores a Base64 data URI in IndexedDB and registers metadata in the store.
   * Returns the generated short asset ID synchronously.
   */
  addAsset: (base64: string, name?: string) => string;

  getDelta: () => { nodes: Record<string, ComponentNodeAny>; version: number };
  markSynced: () => void;
  copyComponents: (ids: string[]) => void;
  cutComponents: (ids: string[]) => void;
  pasteComponents: (targetPosition?: { x: number; y: number }) => string[];
  addComponent: (
    type: ComponentType,
    position?: { x?: number; y?: number },
    initialCode?: string,
    size?: { w?: number; h?: number },
    extraProps?: Record<string, unknown>
  ) => string;
  updateComponentProps: (
    id: string,
    props: Partial<ComponentNodeAny["props"]>
  ) => void;
  updateComponentPropsImmediate: (
    id: string,
    props: Partial<ComponentNodeAny["props"]>
  ) => void;
  setComponentPosition: (id: string, x: number, y: number) => void;
  setComponentSize: (id: string, w: number, h: number) => void;
  updateComponentCode: (id: string, code: string) => void;
  deleteComponent: (id: string) => void;
  deleteComponents: (ids: string[]) => void;
  /** Remove a captured node from canvas state *without* deleting the underlying AST source code. */
  discardCapturedNode: (id: string) => void;
  /**
   * Remove multiple captured overlay nodes in a single atomic state mutation,
   * *without* touching any source component's AST (unlike `deleteComponents`,
   * which parses and deletes JSX elements). Non-captured IDs are ignored.
   */
  discardCapturedNodes: (ids: string[]) => void;
  /**
   * Remove all captured overlay nodes for a source component in a single
   * state mutation, *without* touching the source component's AST.
   * Returns the deleted captured node IDs so callers can fix up selection.
   */
  discardCapturedNodesBySourceId: (sourceComponentId: string) => string[];
  duplicateComponents: (
    ids: string[],
    targetPosition?: { x: number; y: number }
  ) => string[];
  getNode: (id: string) => ComponentNodeAny | undefined;
  exportJSON: () => Promise<string>;
  importJSON: (json: string) => void;
  loadProjectJSON: (
    json: string,
    options?: { handle?: any | null; fileName?: string | null }
  ) => void;
  ingestElement: (
    astIndex: number,
    boundingBox: { x: number; y: number; w: number; h: number },
    label?: string,
    sourceComponentId?: string
  ) => string;
  resetCapturedElement: (id: string) => void;
  markCapturedNodeEdited: (id: string) => void;
  addWireframeComponent: (
    type: ComponentType,
    position?: { x?: number; y?: number },
    size?: { w?: number; h?: number }
  ) => string;
  /**
   * Batch-creates draft (skeleton) nodes for the two-phase AI generation pipeline.
   * Each item in the array becomes a placeholder node with kind="draft" and empty code.
   * Returns the generated UUIDs in the same order as the input array so the
   * orchestrator can map AI plan entries to specific node IDs.
   */
  addSkeletonComponents: (
    items: Array<{
      id?: string;
      componentType: string;
      x: number;
      y: number;
      w: number;
      h: number;
    }>
  ) => string[];
  updateNodeComment: (id: string, comment: string) => void;
  updateAnnotationOffset: (
    id: string,
    offset: { x: number; y: number }
  ) => void;
  updateComponentType: (id: string, type: ComponentType) => void;
  moveNodes: (
    updates: Array<{ id: string; x: number; y: number }>,
    gridConfig?: GridConfig
  ) => void;
  resizeNode: (
    id: string,
    w: number,
    h: number,
    gridConfig?: GridConfig
  ) => void;
  updateLayouts: (
    updates: Array<{
      id: string;
      x?: number;
      y?: number;
      w?: number;
      h?: number;
      widthMode?: SizingMode;
      heightMode?: SizingMode;
    }>,
    gridConfig?: GridConfig
  ) => void;

  /** Pause undo/redo history recording — use before a sequence of related mutations. */
  pauseHistory: () => void;
  /** Resume undo/redo history recording — call after the sequence completes. */
  resumeHistory: () => void;
  /** Run a store change without recording an undo step. */
  withoutHistory: (fn: () => void) => void;
  /**
   * Execute a synchronous callback with history paused, then resume.
   * All mutations inside the callback will be collapsed into a single undo entry.
   */
  withBatchedHistory: <T>(fn: () => T) => T;
  /**
   * Force-commit a history entry from `preState` → current state, bypassing
   * zundo's equality check. Use this after a sequence of `...Immediate` mutations
   * (e.g. drag end) so the full drag is recorded as one undo entry.
   *
   * @param preState - The partialized state snapshot captured *before* the
   *   immediate mutations began. If omitted the current state is used as both
   *   sides, which still pushes an entry but with no visible diff.
   */
  commitHistory: (preState?: Record<string, unknown>) => void;

  hasUnsavedChanges: () => boolean;

  canUndo: () => boolean;
  canRedo: () => boolean;
  reset: () => void;
  /**
   * Scans the active canvas, theme state, and the full undo/redo history to
   * find asset IDs that are no longer referenced anywhere. Removes orphaned
   * entries from `state.assets` and deletes their blobs from IndexedDB.
   *
   * Safe to call after any deletion — it will not remove assets that are still
   * reachable via undo/redo history.
   */
  garbageCollectAssets: () => void;
}

export interface CanvasHierarchySlice {
  bringToFront: (ids: string[]) => void;
  sendToBack: (ids: string[]) => void;
  setNodeZIndex: (id: string, newZIndex: number) => void;
}

export interface ThemeSlice {
  themeState: ThemeEditorState;
  currentMode: "light" | "dark";
  setThemeState: (state: ThemeEditorState) => void;
  setCurrentMode: (mode: "light" | "dark") => void;
  applyThemePreset: (preset: string) => void;
  resetToCurrentPreset: () => void;
  updateThemeToken: (key: string, value: string | undefined) => void;
  updateThemeTokenImmediate: (key: string, value: string | undefined) => void;
  updateThemeRadius: (value: number, smoothingValue?: number) => void;
  clearThemeTokens: (keys: string[]) => void;
  addCustomFont: (family: string, assetId: string, extension: string) => void;
  removeCustomFont: (id: string) => void;
  reset: (preset?: string) => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

export type AppStore = ProjectSlice &
  CanvasHierarchySlice &
  ThemeSlice & {
    /** Undo/redo one visible step (defined once in app-store). */
    undo: () => void;
    redo: () => void;
  };

export type AppStateCreator<T> = StateCreator<
  AppStore,
  [["zustand/immer", never]],
  [],
  T
>;
