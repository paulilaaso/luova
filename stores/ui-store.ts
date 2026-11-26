import { create } from "zustand";
import { persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { defaultThemeState } from "@/config/theme";

export const THEME_ACCORDION_IDS = [
  "hsl-adjustments",
  "base-colors",
  "card-colors",
  "primary-colors",
  "secondary-colors",
  "accent-colors",
  "popover-colors",
  "muted-colors",
  "destructive-colors",
  "border-input-colors",
  "sidebar-colors",
  "chart-colors",
  "fonts",
  "font-scale",
  "letter-spacing",
  "global-shape",
  "control-shape",
  "surface-shape",
] as const;

export type ExpandedAccordions = Record<string, string[]>;

export interface UIState {
  selectedIds: string[];
  inspectorMode: boolean;
  expandedAccordions: ExpandedAccordions;
  forcedOpenPanels: string[];
  isThemeLocked: boolean;
  lockedThemeState: any;
  /** Text Formatting's System switch: theme type scale presets vs free values. */
  systemTypography: boolean;
  /** Spacing's System switch: drags snap to the Tailwind scale vs exact px. */
  systemSpacing: boolean;
  activeMenu: string | null;
  editingTextNodeId: string | null;
  propertiesTab: "components" | "theme" | "code";
  previewMode: boolean;
  /** Pending request for the code editor to reveal a JSX element. */
  codeReveal: CodeReveal | null;
  /** Captured elements whose collapsed speech-bubble button is hidden
   *  (after "Go to Code") until the element is selected again. */
  hiddenBubbleIds: string[];
  /** Node selected by "Go to Code"; its selection keeps the Code tab open. */
  revealSelectId: string | null;
}

export interface CodeReveal {
  /** Component whose source holds the element. */
  componentId: string;
  /** data-ast-index of the element, or null for the top of the file. */
  astIndex: number | null;
}

export interface UIActions {
  selectComponent: (id: string | null) => void;
  selectComponents: (ids: string[]) => void;
  addToSelection: (id: string) => void;
  removeFromSelection: (id: string) => void;
  clearSelection: () => void;
  reset: () => void;
  setSystemTypography: (on: boolean) => void;
  setSystemSpacing: (on: boolean) => void;
  toggleInspectorMode: () => void;
  setInspectorMode: (active: boolean) => void;
  setPreviewMode: (active: boolean) => void;
  setExpandedItems: (panelKey: string, items: string[]) => void;
  getExpandedItems: (panelKey: string) => string[];
  setPanelForcedOpen: (panelKey: string, forced: boolean) => void;
  clearAllForcedOpenPanels: () => void;
  isPanelForcedOpen: (panelKey: string) => boolean;
  lockThemeToState: (state: any) => void;
  unlockTheme: () => void;
  setActiveMenu: (id: string | null) => void;
  setEditingTextNodeId: (id: string | null) => void;
  clearEditingTextNodeId: () => void;
  setPropertiesTab: (tab: "components" | "theme" | "code") => void;
  /** Select `selectId`, open the Code tab and reveal the element there. */
  revealInCode: (
    selectId: string,
    reveal: CodeReveal,
    hideBubbleId?: string
  ) => void;
  clearCodeReveal: () => void;
  /** True (once) if `id` was just selected by "Go to Code". */
  consumeRevealSelect: (id: string) => boolean;
}

export type UIStore = UIState & UIActions;

const initialState: UIState = {
  systemTypography: true,
  systemSpacing: true,
  selectedIds: [],
  inspectorMode: false,
  expandedAccordions: {
    theme: [...THEME_ACCORDION_IDS],
    components: [
      "layout",
      "text-formatting",
      "grid-settings",
      "image-settings",
      "prompt",
      "spacing",
      "shape",
      "typography",
      "colors",
      "visibility",
      "effects",
    ],
    "captured-element": [
      "prompt",
      "spacing",
      "shape",
      "text-formatting",
      "typography",
      "layout",
      "colors",
      "visibility",
      "effects",
    ],
  },
  forcedOpenPanels: [],
  isThemeLocked: true,
  lockedThemeState: defaultThemeState,
  activeMenu: null,
  editingTextNodeId: null,
  propertiesTab: "components",
  previewMode: false,
  codeReveal: null,
  hiddenBubbleIds: [],
  revealSelectId: null,
};

export const useUIStore = create<UIStore>()(
  persist(
    immer((set, get) => ({
      ...initialState,

      selectComponent: (id) => {
        set((state) => {
          state.selectedIds = id ? [id] : [];
          if (id && state.hiddenBubbleIds.includes(id)) {
            state.hiddenBubbleIds = state.hiddenBubbleIds.filter(
              (hidden) => hidden !== id
            );
          }
        });
      },

      selectComponents: (ids) => {
        set((state) => {
          state.selectedIds = ids;
        });
      },

      addToSelection: (id) => {
        set((state) => {
          if (!state.selectedIds.includes(id)) {
            state.selectedIds = [...state.selectedIds, id];
          }
        });
      },

      removeFromSelection: (id) => {
        set((state) => {
          state.selectedIds = state.selectedIds.filter(
            (selectedId) => selectedId !== id
          );
        });
      },

      clearSelection: () => {
        set((state) => {
          state.selectedIds = [];
          state.editingTextNodeId = null;
        });
      },

      reset: () => {
        set((state) => ({
          ...initialState,
          isThemeLocked: state.isThemeLocked,
          lockedThemeState: state.lockedThemeState,
          // Switch preferences outlive a project reset.
          systemTypography: state.systemTypography,
          systemSpacing: state.systemSpacing,
        }));
      },

      setSystemTypography: (on) => {
        set((state) => {
          state.systemTypography = on;
        });
      },

      setSystemSpacing: (on) => {
        set((state) => {
          state.systemSpacing = on;
        });
      },

      toggleInspectorMode: () => {
        set((state) => {
          state.inspectorMode = !state.inspectorMode;
        });
      },

      setInspectorMode: (active) => {
        set((state) => {
          state.inspectorMode = active;
        });
      },

      setPreviewMode: (active) => {
        set((state) => {
          state.previewMode = active;
        });
      },

      setExpandedItems: (panelKey, items) => {
        set((state) => {
          state.expandedAccordions[panelKey] = items;
        });
      },

      getExpandedItems: (panelKey) => {
        const state = get();
        return state.expandedAccordions[panelKey] || [];
      },

      setPanelForcedOpen: (panelKey, forced) => {
        set((state) => {
          if (forced) {
            if (!state.forcedOpenPanels.includes(panelKey)) {
              state.forcedOpenPanels = [...state.forcedOpenPanels, panelKey];
            }
          } else {
            state.forcedOpenPanels = state.forcedOpenPanels.filter(
              (k) => k !== panelKey
            );
          }
        });
      },

      clearAllForcedOpenPanels: () => {
        set((state) => {
          state.forcedOpenPanels = [];
        });
      },

      isPanelForcedOpen: (panelKey) => {
        return get().forcedOpenPanels.includes(panelKey);
      },

      lockThemeToState: (state: any) => {
        set((uiState) => {
          uiState.isThemeLocked = true;
          uiState.lockedThemeState = state;
        });
      },

      unlockTheme: () => {
        set((state) => {
          state.isThemeLocked = false;
        });
      },

      setActiveMenu: (id) => {
        set((state) => {
          state.activeMenu = id;
        });
      },

      setEditingTextNodeId: (id) => {
        set((state) => {
          state.editingTextNodeId = id;
        });
      },

      clearEditingTextNodeId: () => {
        set((state) => {
          state.editingTextNodeId = null;
        });
      },

      setPropertiesTab: (tab) => {
        set((state) => {
          state.propertiesTab = tab;
        });
      },

      revealInCode: (selectId, reveal, hideBubbleId) => {
        set((state) => {
          // Only a changed selection triggers the panel's tab reset.
          const selectionChanges =
            state.selectedIds.length !== 1 || state.selectedIds[0] !== selectId;
          state.revealSelectId = selectionChanges ? selectId : null;
          state.selectedIds = [selectId];
          state.propertiesTab = "code";
          state.codeReveal = reveal;
          if (hideBubbleId && !state.hiddenBubbleIds.includes(hideBubbleId)) {
            state.hiddenBubbleIds.push(hideBubbleId);
          }
        });
      },

      consumeRevealSelect: (id) => {
        if (get().revealSelectId !== id) return false;
        set((state) => {
          state.revealSelectId = null;
        });
        return true;
      },

      clearCodeReveal: () => {
        set((state) => {
          state.codeReveal = null;
        });
      },
    })),
    {
      name: "ui-storage",
      partialize: (state) => ({
        expandedAccordions: state.expandedAccordions,
        isThemeLocked: state.isThemeLocked,
        lockedThemeState: state.lockedThemeState,
        systemTypography: state.systemTypography,
        systemSpacing: state.systemSpacing,
      }),
    }
  )
);
