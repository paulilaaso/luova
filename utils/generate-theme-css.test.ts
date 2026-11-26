import { describe, expect, it } from "vitest";
import { defaultThemeState } from "@/config/theme";
import type { ThemeEditorState } from "@/types/editor";
import { generateLockedThemeCSS } from "@/utils/generate-theme-css";

describe("generateLockedThemeCSS", () => {
  it("pins the app backdrop to the frozen theme's background in both modes", () => {
    const withBackgrounds = (light: string, dark: string) => {
      const state: ThemeEditorState = structuredClone(defaultThemeState);
      state.styles.light.background = light;
      state.styles.dark.background = dark;
      return state;
    };
    const live = withBackgrounds("#111111", "#222222");
    const locked = withBackgrounds("#aaaaaa", "#bbbbbb");

    const css = generateLockedThemeCSS(live, locked);

    expect(css).toMatch(
      /:root:not\(\.dark\) \[data-app-backdrop="true"\] \{\s*background-color: #aaaaaa;/
    );
    expect(css).toMatch(
      /\.dark \[data-app-backdrop="true"\] \{\s*background-color: #bbbbbb;/
    );
  });
});
