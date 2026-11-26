import type { UIMessage } from "ai";
import { create } from "zustand";
import { executeAgenticFix } from "@/lib/ai/auto-fix";
import type { AiStatus, PropertiesPanelTab } from "@/types/ai";

interface AiStoreState {
  status: AiStatus;
  error: string | null;
  propertiesTab: PropertiesPanelTab;
  activeMode: import("@/types/ai").AiMode | null;
  messages: UIMessage[];
  assistantText: string;
  currentStatus: string;
  initialAppSnapshot: string | null;
  /**
   * The selection the current request was built from, including fresh
   * wireframes auto-armed in create mode. Null outside a TopBar request
   * (MCP, auto-fix), where the live canvas selection applies.
   */
  armedSelectionIds: string[] | null;
  prompt: string;
  setStatus: (status: AiStatus) => void;
  setError: (error: string | null) => void;
  setPropertiesTab: (tab: PropertiesPanelTab) => void;
  setActiveMode: (mode: import("@/types/ai").AiMode | null) => void;
  setMessages: (messages: UIMessage[]) => void;
  setAssistantText: (text: string) => void;
  setCurrentStatus: (status: string) => void;
  setInitialAppSnapshot: (snapshot: string | null) => void;
  setArmedSelectionIds: (ids: string[] | null) => void;
  setPrompt: (prompt: string) => void;
  runtimeErrors: Record<
    string,
    {
      error: string;
      code: string;
      nodeId: string;
    }
  >;
  isFixingError: boolean;
  abortController: AbortController | null;
  reportRuntimeError: (nodeId: string, error: string, code: string) => void;
  clearRuntimeError: (nodeId: string) => void;
  clearAllRuntimeErrors: () => void;
  setIsFixingError: (value: boolean) => void;
  stopFix: () => void;
  triggerAiFix: (nodeId: string, error: string, code: string) => Promise<void>;
  assistantMessageId: string | null;
  clearState: () => void;
}

const initialState = {
  status: "idle" as AiStatus,
  error: null,
  propertiesTab: "components" as PropertiesPanelTab,
  activeMode: null as import("@/types/ai").AiMode | null,
  messages: [] as UIMessage[],
  assistantText: "",
  currentStatus: "",
  initialAppSnapshot: null as string | null,
  armedSelectionIds: null as string[] | null,
  prompt: "",
  runtimeErrors: {} as Record<
    string,
    {
      error: string;
      code: string;
      nodeId: string;
    }
  >,
  isFixingError: false,
  abortController: null as AbortController | null,
  assistantMessageId: null as string | null,
};

export const useAiStore = create<AiStoreState>()((set, get) => ({
  ...initialState,

  setStatus: (status) => {
    set({ status });
  },

  setError: (error) => {
    set({ error, status: error ? "error" : get().status });
  },

  setPropertiesTab: (tab) => {
    set({ propertiesTab: tab });
  },

  setActiveMode: (mode) => {
    set({ activeMode: mode });
  },

  setMessages: (messages) => {
    set({ messages });
  },

  setAssistantText: (text) => {
    set({ assistantText: text });
  },

  setCurrentStatus: (status) => {
    set({ currentStatus: status });
  },

  setInitialAppSnapshot: (snapshot) => {
    set({ initialAppSnapshot: snapshot });
  },

  setArmedSelectionIds: (ids) => {
    set({ armedSelectionIds: ids });
  },

  setPrompt: (prompt) => {
    set({ prompt });
  },

  clearState: () => {
    set({
      status: "idle",
      error: null,
      assistantText: "",
      currentStatus: "",
      messages: [],
      activeMode: null,
      armedSelectionIds: null,
      // Preserve initialAppSnapshot so "Keep Both" can still access it
    });
  },

  reportRuntimeError: (nodeId, error, code) => {
    set((state) => {
      const existing = state.runtimeErrors[nodeId];
      if (existing && existing.error === error && existing.code === code)
        return state;
      return {
        runtimeErrors: {
          ...state.runtimeErrors,
          [nodeId]: {
            error,
            code,
            nodeId,
          },
        },
      };
    });
  },

  clearRuntimeError: (nodeId) => {
    set((state) => {
      const newRuntimeErrors = { ...state.runtimeErrors };
      delete newRuntimeErrors[nodeId];
      return { runtimeErrors: newRuntimeErrors };
    });
  },

  clearAllRuntimeErrors: () => {
    set({ runtimeErrors: {} });
  },

  setIsFixingError: (value) => {
    set({
      isFixingError: value,
      ...(value === false ? { currentStatus: "" } : {}),
    });
  },

  stopFix: () => {
    get().abortController?.abort();
    set({
      isFixingError: false,
      runtimeErrors: {},
      status: "ready" as AiStatus,
      currentStatus: "",
      abortController: null,
    });
  },

  triggerAiFix: async (nodeId, error, code) => {
    const state = get();

    if (
      state.isFixingError ||
      state.status === "thinking" ||
      state.status === "streaming"
    ) {
      return;
    }

    get().abortController?.abort();
    const ac = new AbortController();
    set({
      abortController: ac,
      status: "thinking" as AiStatus,
      isFixingError: true,
      error: null,
      assistantText: "",
      currentStatus: "",
      messages: [],
      runtimeErrors: {
        ...state.runtimeErrors,
        [nodeId]: { error, code, nodeId },
      },
    });

    try {
      await executeAgenticFix({ nodeId, error, code, signal: ac.signal });
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        console.error("Fix error:", e);
      }
    }
  },
}));
