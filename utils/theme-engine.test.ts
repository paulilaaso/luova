import { beforeEach, describe, expect, it } from "vitest";
import { ThemeEngine } from "@/utils/theme-engine";

describe("ThemeEngine", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("style");
    document.body.innerHTML = "";
  });

  it("applies tokens to :root", () => {
    ThemeEngine.applyToken("primary", "oklch(0.5 0 0)");

    expect(document.documentElement.style.getPropertyValue("--primary")).toBe(
      "oklch(0.5 0 0)"
    );
  });

  it("removes shadow companion variables before applying shadow tokens", () => {
    document.documentElement.style.setProperty(
      "--card-shadow-drop",
      "old-drop"
    );
    document.documentElement.style.setProperty(
      "--card-shadow-inset",
      "old-inset"
    );

    ThemeEngine.applyToken("card-shadow", "0 1px 2px rgb(0 0 0 / 0.2)");

    expect(
      document.documentElement.style.getPropertyValue("--card-shadow-drop")
    ).toBe("");
    expect(
      document.documentElement.style.getPropertyValue("--card-shadow-inset")
    ).toBe("");
    expect(
      document.documentElement.style.getPropertyValue("--card-shadow")
    ).toBe("0 1px 2px rgb(0 0 0 / 0.2)");
  });
});
