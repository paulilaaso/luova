export const DEFAULT_OPENAI_MODEL = "gpt-6.2-sol";

/** Internal policy for both OpenAI API and ChatGPT Plan. No Settings UI. */
export type OpenAIReasoningEffort = "low" | "medium" | "high" | "xhigh";

// Change this to tune all listed models; individual entries can override it.
export const DEFAULT_OPENAI_REASONING_EFFORT: OpenAIReasoningEffort = "medium";

export const OPENAI_REASONING_EFFORT_BY_MODEL: Record<
  string,
  OpenAIReasoningEffort
> = {
  "gpt-5.5": DEFAULT_OPENAI_REASONING_EFFORT,
  "gpt-6.2-sol": DEFAULT_OPENAI_REASONING_EFFORT,
  "gpt-6.2-astra": DEFAULT_OPENAI_REASONING_EFFORT,
  "gpt-6.1-terra": DEFAULT_OPENAI_REASONING_EFFORT,
  "gpt-6.1-sol": DEFAULT_OPENAI_REASONING_EFFORT,
  "gpt-6-sol": DEFAULT_OPENAI_REASONING_EFFORT,
  "gpt-6-luna": DEFAULT_OPENAI_REASONING_EFFORT,
  "gpt-6-astra": DEFAULT_OPENAI_REASONING_EFFORT,
};
