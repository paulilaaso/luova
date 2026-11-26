import { describe, expect, it } from "vitest";
import { defaultThemeState } from "@/config/theme";
import type { ThemeEditorState } from "@/types/editor";
import { getShadowMap, normalizeShadowTokenValue } from "@/utils/shadows";

function makeState(lightOverrides: Record<string, string>): ThemeEditorState {
  return {
    ...defaultThemeState,
    currentMode: "light",
    styles: {
      ...defaultThemeState.styles,
      light: {
        ...defaultThemeState.styles.light,
        ...lightOverrides,
      },
    },
  };
}

describe("getShadowMap", () => {
  it("falls back to default shadow groups when shadow-groups is blank", () => {
    const state = makeState({ "shadow-groups": "" });
    const shadowMap = getShadowMap(state);

    expect(shadowMap["shadow-default"]).toBeDefined();
    expect(shadowMap["shadow-default"]).not.toBe("none");
  });

  it("preserves explicit empty shadow groups array", () => {
    const state = makeState({ "shadow-groups": "[]" });
    const shadowMap = getShadowMap(state);

    expect(Object.keys(shadowMap)).toHaveLength(0);
  });
});

describe("normalizeShadowTokenValue", () => {
  const shadowMap = {
    "shadow-default": "0 1px 3px hsl(0 0% 0% / 0.1)",
    "shadow-default-drop": "0 1px 3px hsl(0 0% 0% / 0.1)",
    "shadow-default-inset": "none",
    "shadow-fancy": "0 4px 14px hsl(250 80% 50% / 0.3)",
    "shadow-fancy-drop": "0 4px 14px hsl(250 80% 50% / 0.3)",
    "shadow-fancy-inset": "none",
  };

  it("resolves direct group references", () => {
    expect(normalizeShadowTokenValue("var(--shadow-fancy)", shadowMap)).toEqual(
      {
        shadow: "var(--shadow-fancy)",
        drop: "var(--shadow-fancy-drop)",
        inset: "var(--shadow-fancy-inset)",
      }
    );
  });

  it("falls back missing group references to default", () => {
    expect(normalizeShadowTokenValue("var(--shadow-sm)", shadowMap)).toEqual({
      shadow: "var(--shadow-default)",
      drop: "var(--shadow-default-drop)",
      inset: "var(--shadow-default-inset)",
    });
  });

  it("maps none to none triplet", () => {
    expect(normalizeShadowTokenValue("none", shadowMap)).toEqual({
      shadow: "none",
      drop: "none",
      inset: "none",
    });
  });

  it("returns null for non-shadow variable values", () => {
    expect(
      normalizeShadowTokenValue("0 1px 2px hsl(0 0% 0% / 0.2)", shadowMap)
    ).toBeNull();
  });
});
