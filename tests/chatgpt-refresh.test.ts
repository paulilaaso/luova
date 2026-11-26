// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveChatGptAccessToken } from "@/lib/ai/chatgpt-session";
import { useAiSettingsStore } from "@/stores/ai-settings-store";

const expired = {
  accessToken: "old-access",
  refreshToken: "old-refresh",
  clientId: "client",
  expiresAt: Date.now() - 1000,
};

afterEach(() => {
  vi.unstubAllGlobals();
  useAiSettingsStore.getState().setChatGptAuth(null);
  localStorage.clear();
});

describe("ChatGPT token refresh", () => {
  it("runs one refresh for concurrent callers, so a refresh token is never reused", async () => {
    useAiSettingsStore.getState().setChatGptAuth(expired);
    const fetchMock = vi.fn(async () =>
      Response.json({
        accessToken: "new-access",
        refreshToken: "new-refresh",
        expiresAt: Date.now() + 3_600_000,
        clientId: "client",
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const tokens = await Promise.all([
      resolveChatGptAccessToken(),
      resolveChatGptAccessToken(),
      resolveChatGptAccessToken(),
    ]);

    expect(tokens).toEqual(["new-access", "new-access", "new-access"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(useAiSettingsStore.getState().chatgptAuth?.refreshToken).toBe(
      "new-refresh"
    );
  });

  it("uses a session another tab already refreshed instead of refreshing again", async () => {
    useAiSettingsStore.getState().setChatGptAuth(expired);
    const fromOtherTab = {
      ...expired,
      accessToken: "tab-access",
      refreshToken: "tab-refresh",
      expiresAt: Date.now() + 3_600_000,
    };
    localStorage.setItem(
      "ai-settings",
      JSON.stringify({ state: { chatgptAuth: fromOtherTab }, version: 2 })
    );
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await resolveChatGptAccessToken()).toBe("tab-access");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
