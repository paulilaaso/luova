import { useAppStore } from "./app-store";
import type { AppStore } from "./types";

export const useThemeStore = Object.assign(
  <T>(selector: (state: AppStore) => T) => useAppStore(selector),
  {
    getState: () => useAppStore.getState(),
    subscribe: (listener: (state: AppStore, prevState: AppStore) => void) =>
      useAppStore.subscribe(listener),
    temporal: {
      getState: () => useAppStore.temporal.getState(),
    },
  }
) as unknown as typeof useAppStore;
