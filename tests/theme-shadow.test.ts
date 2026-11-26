import { describe, expect, it } from "vitest";
import { updateThemeToolSchema } from "@/lib/ai/schemas";
import { buildThemePatch } from "@/lib/ai/theme-shadow";
import type { ShadowGroup } from "@/types/theme";

describe("update_theme shadow", () => {
  it("turns typed layers into the one default shadow group", () => {
    const patch = buildThemePatch({
      patch: { light: { primary: "oklch(0.6 0.2 30)" }, dark: {} },
      shadow: [
        {
          type: "drop",
          offsetX: 4,
          offsetY: 4,
          blur: 0,
          spread: 0,
          opacity: 1,
          color: "oklch(0 0 0)",
        },
        {
          type: "inset",
          offsetX: 0,
          offsetY: 1,
          blur: 0,
          spread: 0,
          opacity: 0.4,
          color: "oklch(1 0 0)",
        },
      ],
    });
    const groups = JSON.parse(
      patch.light["shadow-groups"] as string
    ) as ShadowGroup[];
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ id: "default", isDefault: true });
    expect(groups[0].layers.map((l) => [l.type, l.offsetX, l.blur])).toEqual([
      ["drop", "4px", "0px"],
      ["inset", "0px", "0px"],
    ]);
    expect(patch.light.primary).toBe("oklch(0.6 0.2 30)");
  });

  it("drops per-component shadows and keeps the current shadow when none is given", () => {
    const patch = buildThemePatch({
      patch: { light: { "card-shadow": "x", primary: "red" } },
    });
    expect(patch.light).toEqual({ primary: "red" });
  });

  it("wraps a flat patch as light", () => {
    expect(buildThemePatch({ patch: { primary: "red" } })).toEqual({
      light: { primary: "red" },
    });
  });

  it("requires a rationale and accepts shadow layers", () => {
    expect(updateThemeToolSchema.safeParse({ patch: {} }).success).toBe(false);
    expect(
      updateThemeToolSchema.safeParse({
        rationale: "flat",
        patch: {},
        shadow: [],
      }).success
    ).toBe(true);
  });
});
