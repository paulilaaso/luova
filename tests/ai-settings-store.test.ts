import { describe, expect, it } from "vitest";
import { useAiSettingsStore } from "@/stores/ai-settings-store";

describe("ai-settings-store custom model tags", () => {
  it("mirrors edits from either provider and preserves removals after rehydration", async () => {
    const previous = useAiSettingsStore.getState().customModelTags;
    try {
      useAiSettingsStore.setState({ customModelTags: {} });
      const store = useAiSettingsStore.getState();
      store.addCustomModelTag("openai", "api-model");
      store.addCustomModelTag("chatgpt", "plan-model");
      expect(useAiSettingsStore.getState().customModelTags).toEqual({
        openai: ["api-model", "plan-model"],
        chatgpt: ["api-model", "plan-model"],
      });

      store.removeCustomModelTag("chatgpt", "api-model");
      await useAiSettingsStore.persist.rehydrate();
      expect(useAiSettingsStore.getState().customModelTags).toEqual({
        openai: ["plan-model"],
        chatgpt: ["plan-model"],
      });

      store.setCustomModelTags("openai", []);
      await useAiSettingsStore.persist.rehydrate();
      expect(useAiSettingsStore.getState().customModelTags).toEqual({
        openai: [],
        chatgpt: [],
      });
    } finally {
      useAiSettingsStore.setState({ customModelTags: previous });
    }
  });
});
