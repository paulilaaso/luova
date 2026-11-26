// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST, toolChoiceForMode } from "@/app/api/chat/route";
import { acceptsTemperature } from "@/lib/ai/model-options";
import { createInstructions } from "@/lib/ai/prompt-factory";
import {
  createModel,
  normalizeLocalBaseUrl,
  providerRequirements,
} from "@/lib/ai/providers";
import type { AiContextSnapshot } from "@/types/ai";

function chatRequest(
  body: Record<string, unknown>,
  init: { signal?: AbortSignal; origin?: string } = {}
) {
  return new Request("http://127.0.0.1:3000/api/chat", {
    method: "POST",
    signal: init.signal,
    headers: {
      host: "127.0.0.1:3000",
      "content-type": "application/json",
      ...(init.origin ? { origin: init.origin } : {}),
    },
    body: JSON.stringify({
      messages: [
        { id: "1", role: "user", parts: [{ type: "text", text: "a button" }] },
      ],
      context: {
        mode: "create",
        activeTab: "components",
        prompt: "a button",
        selectedIds: [],
      },
      ...body,
    }),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Anthropic provider", () => {
  it("only sends temperature to Claude models that accept it", () => {
    for (const model of [
      "claude-opus-4-5",
      "claude-opus-4-5-20251101",
      "claude-sonnet-4-6",
      "claude-sonnet-4-20250514",
      "claude-3-7-sonnet-20250219",
    ]) {
      expect(acceptsTemperature("anthropic", model)).toBe(true);
    }
    for (const model of [
      "claude-opus-4-7",
      "claude-opus-5-5",
      "claude-sonnet-5-5",
      "claude-haiku-5-5",
      "claude-fable-5-1",
    ]) {
      expect(acceptsTemperature("anthropic", model)).toBe(false);
    }
    expect(acceptsTemperature("chatgpt", "gpt-6-sol")).toBe(false);
    expect(acceptsTemperature("google", "gemini-flash-latest")).toBe(true);
  });

  it("never forces a tool for Claude and puts the rule in the prompt", () => {
    for (const mode of ["create", "edit", "bake", "recreate"] as const) {
      expect(toolChoiceForMode(mode, "anthropic", [], true)).toBe("auto");
    }
    const context: AiContextSnapshot = {
      mode: "create",
      activeTab: "components",
      prompt: "x",
      selectedIds: [],
    };
    expect(createInstructions(context, undefined, "anthropic")).toContain(
      "Respond ONLY by calling the provided tool"
    );
    expect(createInstructions(context, undefined, "google")).not.toContain(
      "Respond ONLY by calling the provided tool"
    );
  });

  it("sends a request current Claude models accept", async () => {
    const sent: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        sent.push({ url: String(input), body: JSON.parse(String(init?.body)) });
        return new Response(
          JSON.stringify({
            type: "error",
            error: { type: "invalid_request_error", message: "test stop" },
          }),
          { status: 400, headers: { "content-type": "application/json" } }
        );
      })
    );

    const res = await POST(
      chatRequest({ activeProvider: "anthropic", apiKey: "k", model: "" })
    );
    await res.text();

    expect(sent[0].url).toContain("api.anthropic.com");
    expect(sent[0].body.model).toBe("claude-opus-5-5");
    expect(sent[0].body).not.toHaveProperty("temperature");
    expect(sent[0].body.tool_choice).toMatchObject({ type: "auto" });
    expect(JSON.stringify(sent[0].body.system)).toContain(
      "Respond ONLY by calling the provided tool"
    );
  });
});

describe("ChatGPT plan provider", () => {
  it("targets the Responses API (openai.responses), not chat completions", () => {
    // Plan OAuth tokens are only valid on POST /v1/responses. Using an
    // OpenAI-compatible (/chat/completions) factory rejects them with 401.
    const model = createModel("chatgpt", {
      apiKey: "oauth-token",
      model: "gpt-6-sol",
    }) as unknown as { provider: string; modelId: string };
    expect(model.provider).toBe("openai.responses");
    expect(model.modelId).toBe("gpt-6-sol");
  });

  it("requires an apiKey (the OAuth access token)", () => {
    expect(providerRequirements.chatgpt).toContain("apiKey");
    expect(() =>
      createModel("chatgpt", { apiKey: "", model: "gpt-6-sol" })
    ).toThrow(/not connected/);
  });
});

describe("OpenRouter provider", () => {
  it("defaults to the auto router's real ID", async () => {
    const sent: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        sent.push({ url: String(input), body: JSON.parse(String(init?.body)) });
        return new Response(
          JSON.stringify({ error: { message: "test stop", code: 400 } }),
          { status: 400, headers: { "content-type": "application/json" } }
        );
      })
    );

    const res = await POST(
      chatRequest({ activeProvider: "openrouter", apiKey: "k", model: "" })
    );
    await res.text();

    expect(sent[0].url).toContain("openrouter.ai");
    expect(sent[0].body.model).toBe("openrouter/auto");
  });
});

describe("chat route", () => {
  it("requires the image attachment for a theme derived from an image", async () => {
    const res = await POST(
      chatRequest({
        activeProvider: "local",
        baseURL: "http://127.0.0.1:9/v1",
        model: "m",
        context: {
          mode: "theme",
          activeTab: "components",
          prompt: "",
          selectedIds: ["image"],
          sourceImage: {
            nodeId: "image",
            assetId: "asset:image-abc",
            rect: { x: 0, y: 0, w: 400, h: 300 },
          },
        },
      })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("requires an image attachment");
  });

  it("rejects requests from other websites", async () => {
    const res = await POST(
      chatRequest(
        { activeProvider: "local", baseURL: "http://127.0.0.1:9/v1" },
        { origin: "https://evil.example" }
      )
    );
    expect(res.status).toBe(403);
  });

  it("aborts the upstream model request when the client disconnects", async () => {
    let upstreamSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        upstreamSignal = init?.signal ?? undefined;
        // A model that keeps streaming until it is cancelled.
        return new Response(new ReadableStream({ start() {} }), {
          headers: { "content-type": "text/event-stream" },
        });
      })
    );

    const client = new AbortController();
    const res = await POST(
      chatRequest(
        {
          activeProvider: "local",
          baseURL: "http://127.0.0.1:9/v1",
          model: "m",
        },
        { signal: client.signal }
      )
    );
    void res.text().catch(() => "");
    await vi.waitFor(() => expect(upstreamSignal).toBeDefined());
    expect(upstreamSignal?.aborted).toBe(false);

    client.abort();
    await vi.waitFor(() => expect(upstreamSignal?.aborted).toBe(true));
  });
});

describe("normalizeLocalBaseUrl", () => {
  it("appends /v1 to a bare server address", () => {
    expect(normalizeLocalBaseUrl("http://127.0.0.1:1234")).toBe(
      "http://127.0.0.1:1234/v1"
    );
    expect(normalizeLocalBaseUrl(" http://localhost:1234/ ")).toBe(
      "http://localhost:1234/v1"
    );
  });

  it("keeps an explicit path as given", () => {
    expect(normalizeLocalBaseUrl("http://127.0.0.1:1234/v1")).toBe(
      "http://127.0.0.1:1234/v1"
    );
    expect(normalizeLocalBaseUrl("http://127.0.0.1:1234/v1/")).toBe(
      "http://127.0.0.1:1234/v1"
    );
    expect(normalizeLocalBaseUrl("http://127.0.0.1:4000/api/openai")).toBe(
      "http://127.0.0.1:4000/api/openai"
    );
  });
});
