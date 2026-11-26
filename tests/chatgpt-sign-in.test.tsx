import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as callback } from "@/app/api/auth/chatgpt/callback/route";
import { GET as login } from "@/app/api/auth/chatgpt/login/route";
import AiSettingsDialog from "@/components/ai/AiSettingsDialog";
import {
  buildCallbackUri,
  CHATGPT_PLAN_SCOPE,
  chatGptOpenerOrigin,
} from "@/lib/ai/chatgpt-auth";
import { useAiSettingsStore } from "@/stores/ai-settings-store";

vi.mock("@/lib/ai/chatgpt-id-token", () => ({
  verifyChatGptIdToken: vi.fn(async () => ({ email: "test@example.com" })),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

beforeEach(() => {
  useAiSettingsStore.setState({
    activeProvider: "chatgpt",
    chatgptAuth: null,
    chatgptRegistration: null,
  });
});

describe("ChatGPT sign-in from localhost", () => {
  it.each([
    false,
    true,
  ])("keeps cookies and returns the issued registration (returning sign-in: %s)", async (returning) => {
    const response = await login(
      new NextRequest(
        `http://127.0.0.1:3000/api/auth/chatgpt/login?hostId=urn:uuid:test&openerOrigin=http://localhost:3000${returning ? "&clientId=issued-client" : ""}`
      )
    );
    const authorization = new URL(response.headers.get("location")!);
    expect(authorization.searchParams.get("redirect_uri")).toBe(
      "http://127.0.0.1:3000/api/auth/chatgpt/callback"
    );
    expect(response.cookies.get("chatgpt_opener_origin")?.value).toBe(
      "http://localhost:3000"
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              access_token: "test-token",
              id_token: "verified-in-test",
              scope: CHATGPT_PLAN_SCOPE,
            }),
            { status: 200 }
          )
      )
    );
    const url = new URL("http://127.0.0.1:3000/api/auth/chatgpt/callback");
    url.searchParams.set("state", authorization.searchParams.get("state")!);
    url.searchParams.set("code", "test-code");
    // Returning callbacks may omit client_id: retain the pending registration.
    if (!returning) url.searchParams.set("client_id", "issued-client");
    const result = await callback(
      new NextRequest(url, {
        headers: {
          cookie: response.cookies
            .getAll()
            .map(({ name, value }) => `${name}=${encodeURIComponent(value)}`)
            .join("; "),
        },
      })
    );
    const html = await result.text();
    const popupWindow = { opener: { postMessage: vi.fn() }, close: vi.fn() };
    const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];
    // Execute our callback page with a fake opener to verify its actual destination.
    new Function("window", script)(popupWindow);
    expect(popupWindow.opener.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "CHATGPT_AUTH_SUCCESS",
        tokens: expect.objectContaining({
          accessToken: "test-token",
          clientId: "issued-client",
        }),
      }),
      "http://localhost:3000"
    );
    expect(result.cookies.get("chatgpt_opener_origin")?.maxAge).toBe(0);
  });

  it("does not send credentials to arbitrary origins or different loopback ports", () => {
    for (const origin of [
      "https://example.com",
      "http://localhost:4000",
      "https://localhost:3000",
      "invalid",
    ]) {
      expect(
        chatGptOpenerOrigin(
          "http://127.0.0.1:3000/api/auth/chatgpt/login",
          origin
        )
      ).toBe("http://127.0.0.1:3000");
    }
  });

  it("connects the account after a result from the loopback popup", async () => {
    const popup = { closed: false, close: vi.fn() };
    const open = vi
      .spyOn(window, "open")
      .mockReturnValue(popup as unknown as Window);
    render(<AiSettingsDialog open onOpenChange={() => {}} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Continue with ChatGPT" })
    );
    expect(
      screen.getByRole("button", { name: "Waiting for ChatGPT…" })
    ).toBeDisabled();
    const loginUrl = new URL(String(open.mock.calls[0][0]));
    expect(loginUrl.hostname).toBe("127.0.0.1");
    expect(loginUrl.searchParams.get("openerOrigin")).toBe(
      window.location.origin
    );
    const event = new MessageEvent("message", {
      origin: new URL(buildCallbackUri(window.location.href)).origin,
      data: {
        type: "CHATGPT_AUTH_SUCCESS",
        tokens: {
          accessToken: "test-token",
          grantedScopes: [CHATGPT_PLAN_SCOPE],
          userEmail: "test@example.com",
        },
      },
    });
    Object.defineProperty(event, "source", { value: popup });
    act(() => window.dispatchEvent(event));
    expect(screen.queryByText("Waiting for ChatGPT…")).toBeNull();
    expect(screen.getByText("test@example.com")).toBeInTheDocument();
    expect(useAiSettingsStore.getState().chatgptAuth?.accessToken).toBe(
      "test-token"
    );
  });

  it("clears credentials on logout and reuses the registration after reopening", async () => {
    const hostId = useAiSettingsStore.getState().chatgptHostId;
    useAiSettingsStore.getState().setChatGptAuth({
      clientId: "saved-client",
      userEmail: "test@example.com",
      accessToken: "access-token",
      refreshToken: "refresh-token",
      idToken: "id-token",
      grantedScopes: [CHATGPT_PLAN_SCOPE],
    });
    const fetch = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const popup = { closed: false, close: vi.fn() };
    const open = vi
      .spyOn(window, "open")
      .mockReturnValue(popup as unknown as Window);
    render(<AiSettingsDialog open onOpenChange={() => {}} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    });
    expect(fetch).toHaveBeenCalledWith(
      "/api/auth/chatgpt/logout",
      expect.objectContaining({
        body: JSON.stringify({
          refreshToken: "refresh-token",
          clientId: "saved-client",
        }),
      })
    );
    await act(async () => {
      await useAiSettingsStore.persist.rehydrate();
    });
    const state = useAiSettingsStore.getState();
    expect(state.chatgptAuth).toBeNull();
    expect(state.chatgptRegistration).toEqual({
      clientId: "saved-client",
      userEmail: "test@example.com",
    });
    expect(state.chatgptHostId).toBe(hostId);
    fireEvent.click(
      screen.getByRole("button", { name: "Continue with ChatGPT" })
    );
    const url = new URL(String(open.mock.calls[0][0]));
    expect(url.searchParams.get("clientId")).toBe("saved-client");
    expect(url.searchParams.get("loginHint")).toBe("test@example.com");
    expect(url.searchParams.has("idTokenHint")).toBe(false);
    const authorization = await login(new NextRequest(url));
    const destination = new URL(authorization.headers.get("location")!);
    expect(destination.searchParams.get("client_id")).toBe("saved-client");
    expect(destination.searchParams.get("ext_agent_host_id")).toBe(hostId);
    expect(destination.searchParams.has("agent_name_hint")).toBe(false);
  });

  it("releases the button when the sign-in window is closed", () => {
    const popup = { closed: false, close: vi.fn() };
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    render(<AiSettingsDialog open onOpenChange={() => {}} />);
    vi.useFakeTimers();
    fireEvent.click(
      screen.getByRole("button", { name: "Continue with ChatGPT" })
    );
    popup.closed = true;
    act(() => vi.advanceTimersByTime(1500));
    expect(
      screen.getByRole("button", { name: "Continue with ChatGPT" })
    ).toBeEnabled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Sign-in window closed"
    );
  });

  it("allows retrying after a popup is blocked", () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    render(<AiSettingsDialog open onOpenChange={() => {}} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Continue with ChatGPT" })
    );
    expect(
      screen.getByRole("button", { name: "Continue with ChatGPT" })
    ).toBeEnabled();
    expect(screen.getByRole("alert")).toHaveTextContent("Popup was blocked");
  });
});
