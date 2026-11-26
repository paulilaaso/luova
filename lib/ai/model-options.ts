import {
  OPENAI_REASONING_EFFORT_BY_MODEL,
  type OpenAIReasoningEffort,
} from "@/config/ai";
import { type AiProvider, DEFAULT_MODELS } from "@/lib/ai/providers";

/**
 * Claude models from Opus 4.7 on reject non-default sampling parameters with
 * a 400; only Claude 3.x and 4.0–4.6 accept them.
 */
const ANTHROPIC_SAMPLING_MODEL =
  /^claude-(?:3[-.]|(?:opus|sonnet|haiku)-4(?:-[0-6])?(?:-\d{8})?$)/;

/** Whether the route may send its own temperature to this model. */
export function acceptsTemperature(
  provider: AiProvider,
  model: string
): boolean {
  if (provider === "chatgpt") return false;
  if (provider === "anthropic") {
    return ANTHROPIC_SAMPLING_MODEL.test(model || DEFAULT_MODELS.anthropic);
  }
  return true;
}

type ModelProviderOptions = {
  openai?: {
    store?: boolean;
    reasoningEffort?: OpenAIReasoningEffort;
    forceReasoning?: boolean;
  };
};

export function getModelProviderOptions(
  provider: AiProvider,
  model: string
): ModelProviderOptions {
  if (provider !== "openai" && provider !== "chatgpt") return {};
  const modelId = (model || DEFAULT_MODELS[provider]).replace(
    /-\d{4}-\d{2}-\d{2}$/,
    ""
  );
  const reasoningEffort = Object.hasOwn(
    OPENAI_REASONING_EFFORT_BY_MODEL,
    modelId
  )
    ? OPENAI_REASONING_EFFORT_BY_MODEL[modelId]
    : undefined;
  return {
    openai: {
      ...(provider === "chatgpt" ? { store: false } : {}),
      ...(reasoningEffort
        ? {
            reasoningEffort,
            // The installed SDK's capability map predates GPT-6. Without this,
            // it silently drops reasoningEffort for those models.
            forceReasoning: true,
          }
        : {}),
    },
  };
}
