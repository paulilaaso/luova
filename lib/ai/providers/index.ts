import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogle } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";
import { DEFAULT_OPENAI_MODEL } from "@/config/ai";

export type AiProvider =
  | "google"
  | "openai"
  | "anthropic"
  | "openrouter"
  | "local"
  | "chatgpt";

export interface ProviderConfig {
  apiKey: string;
  model: string;
  baseURL?: string;
}

export type ModelFactory = (config: ProviderConfig) => LanguageModel;

export const providers: Record<AiProvider, ModelFactory> = {
  google: ({ apiKey, model }) => {
    const provider = createGoogle({ apiKey });
    return provider(model || DEFAULT_MODELS.google);
  },
  openai: ({ apiKey, model }) => {
    const provider = createOpenAI({ apiKey });
    return provider(model || DEFAULT_MODELS.openai);
  },
  anthropic: ({ apiKey, model }) => {
    const provider = createAnthropic({ apiKey });
    return provider(model || DEFAULT_MODELS.anthropic);
  },
  openrouter: ({ apiKey, model }) => {
    const provider = createOpenRouter({ apiKey });
    return provider(model || DEFAULT_MODELS.openrouter);
  },
  local: ({ apiKey, model, baseURL }) => {
    if (!baseURL) {
      throw new Error(
        "Base URL is required for local provider. Add it in AI Settings."
      );
    }
    // The key is optional: many local servers need none, but some require
    // a bearer token.
    const provider = createOpenAICompatible({
      name: "local",
      baseURL: normalizeLocalBaseUrl(baseURL),
      apiKey: apiKey || undefined,
    });
    return provider(model);
  },
  chatgpt: ({ apiKey, model }) => {
    if (!apiKey) {
      throw new Error(
        "ChatGPT plan is not connected. Sign in with ChatGPT in AI Settings."
      );
    }
    // Token-sharing flow: the OAuth access token is sent as the bearer
    // credential (exactly as the SIWC cookbook prescribes: apiKey = token).
    // createOpenAI's default model factory targets the public Responses API
    // (/v1/responses) — the only endpoint plan tokens are valid on.
    // Do NOT use createOpenAICompatible here: it talks to /chat/completions,
    // which rejects plan tokens with 401 Unauthorized.
    // store:false / stream:true are enforced in the chat route via
    // providerOptions ({ openai: { store: false } }) and streaming.
    const provider = createOpenAI({ apiKey });
    return provider(model || DEFAULT_MODELS.chatgpt);
  },
};

/**
 * Local servers often display their bare address (e.g. http://127.0.0.1:1234)
 * while serving the OpenAI-compatible API under /v1. A URL with no path gets
 * /v1 appended; any URL with an explicit path is used as given.
 */
export function normalizeLocalBaseUrl(baseURL: string): string {
  const trimmed = baseURL.trim().replace(/\/+$/, "");
  try {
    const url = new URL(trimmed);
    if (url.pathname === "/" || url.pathname === "") {
      return `${trimmed}/v1`;
    }
  } catch {
    // Not a parseable URL; let the request fail with the original value.
  }
  return trimmed;
}

export function createModel(
  provider: AiProvider,
  config: ProviderConfig
): LanguageModel {
  const factory = providers[provider];
  if (!factory) {
    throw new Error(`Unknown provider: ${provider}.`);
  }
  return factory(config);
}

export const DEFAULT_MODELS: Record<AiProvider, string> = {
  google: "gemini-flash-latest",
  openai: DEFAULT_OPENAI_MODEL,
  anthropic: "claude-opus-5-5",
  openrouter: "openrouter/auto",
  local: "",
  chatgpt: DEFAULT_OPENAI_MODEL,
};

export const providerRequirements: Record<AiProvider, string[]> = {
  openai: ["apiKey"],
  anthropic: ["apiKey"],
  google: ["apiKey"],
  local: ["baseURL"],
  openrouter: ["apiKey"],
  chatgpt: ["apiKey"],
};
