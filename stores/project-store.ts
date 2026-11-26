import { useAppStore } from "./app-store";
import type { AppStore, ProjectSlice } from "./types";

export const useProjectStore = Object.assign(
  <T>(selector: (state: AppStore) => T) => useAppStore(selector),
  {
    getState: () => useAppStore.getState(),
    setState: (...args: Parameters<typeof useAppStore.setState>) =>
      useAppStore.setState(...args),
    subscribe: (listener: (state: AppStore, prevState: AppStore) => void) =>
      useAppStore.subscribe(listener),
    temporal: {
      getState: () => useAppStore.temporal.getState(),
    },
  }
) as unknown as typeof useAppStore;

export type { ProjectSlice as ProjectStore };
