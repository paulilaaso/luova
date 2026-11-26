import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_OPENAI_MODEL } from "@/config/ai";

export type AiProvider =
  | "google"
  | "openrouter"
  | "anthropic"
  | "openai"
  | "local"
  | "chatgpt";

export const PROVIDER_LABELS: Record<AiProvider, string> = {
  chatgpt: "ChatGPT (Plan)",
  google: "Google (API)",
  openrouter: "OpenRouter (API)",
  anthropic: "Anthropic (API)",
  openai: "OpenAI (API)",
  local: "Local",
};

export const DEFAULT_MODELS: Record<AiProvider, string> = {
  google: "gemini-flash-latest",
  openrouter: "openrouter/auto",
  anthropic: "claude-opus-5-5",
  openai: DEFAULT_OPENAI_MODEL,
  local: "",
  chatgpt: DEFAULT_OPENAI_MODEL,
};

const OPENAI_MODELS = [
  "gpt-6.2-sol",
  "gpt-6.2-astra",
  "gpt-6.1-terra",
  "gpt-6-luna",
];

export const MODEL_SUGGESTIONS: Record<AiProvider, string[]> = {
  google: [
    "gemini-flash-latest",
    "gemini-pro-latest",
    "gemini-4-hydrogen",
    "gemini-4-neon",
  ],
  openrouter: ["openrouter/auto"],
  anthropic: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"],
  openai: OPENAI_MODELS,
  local: [""],
  chatgpt: OPENAI_MODELS,
};

type CustomModelTags = Partial<Record<AiProvider, string[]>>;

export function getCustomModelTags(
  tags: CustomModelTags,
  provider: AiProvider
): string[] {
  if (provider === "openai" || provider === "chatgpt") {
    return [...new Set([...(tags.openai ?? []), ...(tags.chatgpt ?? [])])];
  }
  return tags[provider] ?? [];
}

export function updateCustomModelTags(
  tags: CustomModelTags,
  provider: AiProvider,
  models: string[]
): CustomModelTags {
  if (provider === "openai" || provider === "chatgpt") {
    return { ...tags, openai: models, chatgpt: models };
  }
  return { ...tags, [provider]: models };
}

export interface ChatGptAuthSession {
  accessToken?: string;
  refreshToken?: string;
  idToken?: string;
  expiresAt?: number;
  clientId?: string;
  userEmail?: string;
  grantedScopes?: string[];
}

/** Non-secret registration details survive logout; credentials never do. */
interface ChatGptRegistration {
  clientId: string;
  userEmail?: string;
}

function registrationFromSession(
  session?: ChatGptAuthSession | null
): ChatGptRegistration | null {
  return session?.clientId
    ? { clientId: session.clientId, userEmail: session.userEmail }
    : null;
}

interface AiSettingsState {
  activeProvider: AiProvider;
  apiKeys: Partial<Record<AiProvider, string>>;
  models: Partial<Record<AiProvider, string>>;
  baseUrls: Partial<Record<AiProvider, string>>;
  customModelTags: Partial<Record<AiProvider, string[]>>;
  mcpEnabled: boolean;
  chatgptHostId: string;
  chatgptAuth: ChatGptAuthSession | null;
  chatgptRegistration: ChatGptRegistration | null;
  setChatGptAuth: (auth: ChatGptAuthSession | null) => void;
  setActiveProvider: (provider: AiProvider) => void;
  setApiKey: (provider: AiProvider, key: string) => void;
  setModel: (provider: AiProvider, model: string) => void;
  setBaseUrl: (provider: AiProvider, url: string) => void;
  addCustomModelTag: (provider: AiProvider, model: string) => void;
  removeCustomModelTag: (provider: AiProvider, model: string) => void;
  setCustomModelTags: (provider: AiProvider, tags: string[]) => void;
  getModel: (provider: AiProvider) => string;
  getBaseUrl: (provider: AiProvider) => string;
  setMcpEnabled: (enabled: boolean) => void;
}

export const useAiSettingsStore = create<AiSettingsState>()(
  persist(
    (set, get) => ({
      activeProvider: "chatgpt",
      apiKeys: {},
      models: {},
      baseUrls: { local: "http://localhost:1234/v1" },
      customModelTags: {},
      mcpEnabled: false,
      chatgptHostId: `urn:uuid:${crypto.randomUUID()}`,
      chatgptAuth: null,
      chatgptRegistration: null,
      setChatGptAuth: (auth) =>
        set((state) => ({
          chatgptAuth: auth,
          chatgptRegistration:
            registrationFromSession(auth) ??
            registrationFromSession(state.chatgptAuth) ??
            state.chatgptRegistration,
        })),
      setActiveProvider: (provider) => set({ activeProvider: provider }),
      setApiKey: (provider, key) =>
        set((state) => ({ apiKeys: { ...state.apiKeys, [provider]: key } })),
      setModel: (provider, model) =>
        set((state) => ({ models: { ...state.models, [provider]: model } })),
      setBaseUrl: (provider, url) =>
        set((state) => ({ baseUrls: { ...state.baseUrls, [provider]: url } })),
      addCustomModelTag: (provider, model) =>
        set((state) => {
          const existing = getCustomModelTags(state.customModelTags, provider);
          if (existing.includes(model)) return state;
          return {
            customModelTags: updateCustomModelTags(
              state.customModelTags,
              provider,
              [...existing, model]
            ),
          };
        }),
      removeCustomModelTag: (provider, model) =>
        set((state) => {
          const existing = getCustomModelTags(state.customModelTags, provider);
          return {
            customModelTags: updateCustomModelTags(
              state.customModelTags,
              provider,
              existing.filter((m) => m !== model)
            ),
          };
        }),
      setCustomModelTags: (provider, tags) =>
        set((state) => ({
          customModelTags: updateCustomModelTags(
            state.customModelTags,
            provider,
            tags
          ),
        })),
      getModel: (provider) =>
        get().models[provider] ?? DEFAULT_MODELS[provider],
      getBaseUrl: (provider) => get().baseUrls[provider] ?? "",
      setMcpEnabled: (enabled) => set({ mcpEnabled: enabled }),
    }),
    {
      name: "ai-settings",
      // Matches the version already saved in browsers. Changing it without a
      // `migrate` function makes zustand discard the saved settings.
      version: 2,
    }
  )
);
