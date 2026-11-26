import { describe, expect, it } from "vitest";
import { buildGradientString, parseGradient } from "@/utils/color-converter";

describe("color-converter gradient parsing", () => {
  it("parses linear gradients with oklch() stops produced by buildGradientString", () => {
    const gradient = buildGradientString(
      [
        { id: "a", color: "oklch(0.32 0.11 24)", position: 0 },
        { id: "b", color: "oklch(0.79 0.06 276 / 0.8)", position: 100 },
      ],
      32,
      "linear"
    );

    const parsed = parseGradient(gradient);
    expect(parsed).not.toBeNull();
    expect(parsed?.type).toBe("linear");
    expect(parsed?.angle).toBe(32);
    expect(parsed?.stops).toHaveLength(2);
    expect(parsed?.stops[0].color).toBe("oklch(0.32 0.11 24)");
    expect(parsed?.stops[1].color).toBe("oklch(0.79 0.06 276 / 0.8)");
  });

  it("parses radial gradients with function-based colors and preserves stop positions", () => {
    const gradient =
      "radial-gradient(in oklab 120% 120% at 30% 40%, rgb(255, 0, 0) 10%, oklch(0.9 0.04 210 / 0.6) 90%)";

    const parsed = parseGradient(gradient);
    expect(parsed).not.toBeNull();
    expect(parsed?.type).toBe("radial");
    expect(parsed?.radialScale).toBe(120);
    expect(parsed?.radialPositionX).toBe(30);
    expect(parsed?.radialPositionY).toBe(40);
    expect(parsed?.stops).toHaveLength(2);
    expect(parsed?.stops[0].position).toBe(10);
    expect(parsed?.stops[1].position).toBe(90);
    expect(parsed?.stops[0].color).toBe("rgb(255, 0, 0)");
  });
});
