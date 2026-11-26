import { generateText } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_OPENAI_MODEL } from "@/config/ai";
import { getModelProviderOptions } from "@/lib/ai/model-options";
import { createModel } from "@/lib/ai/providers";

// Verify the serialized SDK request, since older SDK capability maps can silently
// drop reasoning settings for newer model IDs even when options look correct.
afterEach(() => vi.unstubAllGlobals());

describe.each([
  "openai",
  "chatgpt",
] as const)("%s reasoning requests", (provider) => {
  it.each([
    "",
    "gpt-5.5",
    "gpt-6.2-sol",
    "gpt-6.2-astra",
    "gpt-6.1-terra",
    "gpt-6.1-sol",
    "gpt-6-sol",
    "gpt-6-luna",
    "gpt-6-astra",
  ])("sends the configured effort for %s to the Responses API", async (modelId) => {
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: "resp-test",
            created_at: 0,
            model: modelId || DEFAULT_OPENAI_MODEL,
            object: "response",
            status: "completed",
            output: [
              {
                type: "message",
                id: "msg-test",
                role: "assistant",
                content: [
                  { type: "output_text", text: "Hello", annotations: [] },
                ],
              },
            ],
            usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
          }),
          { headers: { "Content-Type": "application/json" } }
        )
    );
    vi.stubGlobal("fetch", fetch);
    await generateText({
      model: createModel(provider, { apiKey: "test-token", model: modelId }),
      prompt: "Hello",
      maxRetries: 0,
      providerOptions: getModelProviderOptions(provider, modelId),
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toBe("https://api.openai.com/v1/responses");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe(modelId || DEFAULT_OPENAI_MODEL);
    expect(body.reasoning.effort).toBe("medium");
    if (provider === "chatgpt") expect(body.store).toBe(false);
  });
});

it("leaves custom and non-reasoning model settings alone", () => {
  expect(getModelProviderOptions("openai", "gpt-4o").openai).not.toHaveProperty(
    "reasoningEffort"
  );
  expect(getModelProviderOptions("google", "gemini-flash-latest")).toEqual({});
  expect(getModelProviderOptions("chatgpt", "custom-model")).toEqual({
    openai: { store: false },
  });
});
