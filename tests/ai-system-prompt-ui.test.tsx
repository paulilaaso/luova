/**
 * End-to-end binding test for the per-project System Prompt UI.
 *
 * Guards the complete cycle between the AI Settings dialog, the project store,
 * and the JSON serializer/deserializer:
 *   toggle + type in the dialog → store → exportJSON → reset → loadProjectJSON
 *   → the dialog reflects the restored prompt.
 *
 * The store unit tests cover serialization; this test specifically verifies
 * that the UI bindings never decouple from store state.
 */

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import AiSettingsDialog from "@/components/ai/AiSettingsDialog";
import { useAiSettingsStore } from "@/stores/ai-settings-store";
import { useProjectStore } from "@/stores/project-store";

function flush(ms = 60): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getPromptInput(): HTMLInputElement {
  const el = document.getElementById("system-prompt-toggle");
  if (!el) throw new Error("system-prompt-toggle not found");
  return el as HTMLInputElement;
}

function getPromptToggle(): HTMLElement {
  // base-ui renders a hidden <input id="system-prompt-toggle"> plus a visible
  // <span role="switch"> sibling; the span is the interactive control.
  const btn = getPromptInput().parentElement?.querySelector('[role="switch"]');
  if (!btn) throw new Error("system prompt switch button not found");
  return btn as HTMLElement;
}

afterEach(cleanup);

beforeEach(() => {
  useProjectStore.getState().reset();
  useAiSettingsStore.setState({
    apiKeys: {},
    models: {},
    baseUrls: {},
    customModelTags: {},
  });
});

describe("AiSettingsDialog — per-project system prompt", () => {
  it("reflects store state and commits edits live", async () => {
    await act(async () => {
      render(<AiSettingsDialog open onOpenChange={() => {}} />);
    });

    // Initially disabled → no textarea.
    expect(getPromptToggle()).toHaveAttribute("aria-checked", "false");
    expect(screen.queryByPlaceholderText(/Additional instructions/)).toBeNull();

    // Toggle on → textarea appears and store flips immediately.
    await act(async () => {
      fireEvent.click(getPromptToggle());
    });
    expect(getPromptToggle()).toHaveAttribute("aria-checked", "true");
    expect(useProjectStore.getState().systemPromptEnabled).toBe(true);

    // Type → store updates live (no dialog Save required).
    const textarea = screen.getByPlaceholderText(/Additional instructions/);
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "Use Tailwind only." } });
    });
    expect(useProjectStore.getState().systemPrompt).toBe("Use Tailwind only.");
  });

  it("survives an export → reset → load round trip", async () => {
    await act(async () => {
      render(<AiSettingsDialog open onOpenChange={() => {}} />);
    });

    await act(async () => {
      fireEvent.click(getPromptToggle());
    });
    const textarea = screen.getByPlaceholderText(/Additional instructions/);
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "Round trip prompt" } });
    });

    // Save to JSON, wipe, reload from JSON.
    const json = await useProjectStore.getState().exportJSON();
    await act(async () => {
      useProjectStore.getState().reset();
    });
    await act(async () => {
      useProjectStore.getState().loadProjectJSON(json, { handle: null });
      await flush();
    });

    expect(useProjectStore.getState().systemPrompt).toBe("Round trip prompt");
    expect(useProjectStore.getState().systemPromptEnabled).toBe(true);
    // The dialog reflects the restored state.
    expect(getPromptToggle()).toHaveAttribute("aria-checked", "true");
    expect(
      (
        screen.getByPlaceholderText(
          /Additional instructions/
        ) as HTMLTextAreaElement
      ).value
    ).toBe("Round trip prompt");
  });
});
