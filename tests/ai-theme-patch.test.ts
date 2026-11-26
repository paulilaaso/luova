import { describe, expect, it } from "vitest";
import { defaultThemeState } from "@/config/theme";
import { applyThemePatch } from "@/lib/ai/theme";

describe("applyThemePatch", () => {
  it("merges partial light and dark values without removing existing keys", () => {
    const nextState = applyThemePatch(defaultThemeState, {
      light: {
        primary: "oklch(0.6 0.2 250)",
      },
      dark: {
        background: "oklch(0.2 0.02 250)",
      },
    });

    expect(nextState.styles.light.primary).toBe("oklch(0.6 0.2 250)");
    expect(nextState.styles.dark.background).toBe("oklch(0.2 0.02 250)");
    expect(nextState.styles.light.foreground).toBe(
      defaultThemeState.styles.light.foreground
    );
  });
});
