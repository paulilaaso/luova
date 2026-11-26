import { create } from "zustand";

export interface CyclableGroup {
  id: string;
  label: string;
  options: string[];
  currentValue: string;
  onChange: (value: string) => void;
  priority: number;
}

interface KeyboardNavState {
  groups: Record<string, CyclableGroup>;
  activeGroupId: string | null;
}

interface KeyboardNavActions {
  registerGroup: (group: CyclableGroup) => void;
  unregisterGroup: (id: string) => void;
  updateGroupValue: (id: string, value: string) => void;
  updateGroupOptions: (id: string, options: string[]) => void;
  setActiveGroup: (id: string | null) => void;
  cycleActiveGroup: (direction: "up" | "down") => void;
}

export type KeyboardNavStore = KeyboardNavState & KeyboardNavActions;

export const useKeyboardNavStore = create<KeyboardNavStore>()((set, get) => ({
  groups: {},
  activeGroupId: null,

  registerGroup: (group) => {
    set((state) => ({
      groups: { ...state.groups, [group.id]: group },
      activeGroupId: state.activeGroupId ?? group.id,
    }));
  },

  unregisterGroup: (id) => {
    set((state) => {
      const { [id]: _, ...remaining } = state.groups;
      const newActiveId =
        state.activeGroupId === id
          ? (Object.keys(remaining)[0] ?? null)
          : state.activeGroupId;
      return { groups: remaining, activeGroupId: newActiveId };
    });
  },

  updateGroupValue: (id, value) => {
    set((state) => {
      const group = state.groups[id];
      if (!group) return state;
      return {
        groups: { ...state.groups, [id]: { ...group, currentValue: value } },
      };
    });
  },

  updateGroupOptions: (id, options) => {
    set((state) => {
      const group = state.groups[id];
      if (!group) return state;
      return {
        groups: { ...state.groups, [id]: { ...group, options } },
      };
    });
  },

  setActiveGroup: (id) => {
    set({ activeGroupId: id });
  },

  cycleActiveGroup: (direction) => {
    const { groups, activeGroupId } = get();
    const group = activeGroupId ? groups[activeGroupId] : null;
    if (!group || group.options.length === 0) return;

    const currentIndex = group.options.indexOf(group.currentValue);
    let nextIndex: number;

    if (currentIndex === -1) {
      nextIndex = direction === "down" ? 0 : group.options.length - 1;
    } else if (direction === "down") {
      nextIndex = (currentIndex + 1) % group.options.length;
    } else {
      nextIndex =
        (currentIndex - 1 + group.options.length) % group.options.length;
    }

    const nextValue = group.options[nextIndex];
    group.onChange(nextValue);
    set((state) => ({
      groups: {
        ...state.groups,
        [group.id]: { ...state.groups[group.id], currentValue: nextValue },
      },
    }));
  },
}));
