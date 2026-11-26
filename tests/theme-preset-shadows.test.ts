import { describe, expect, it } from "vitest";
import { defaultThemeState } from "@/config/theme";
import { getPresetThemeStyles } from "@/utils/theme-preset-helper";

function getDefaultDropLayer(shadowGroupsJson: string | undefined) {
  const groups = JSON.parse(shadowGroupsJson || "[]") as Array<{
    id: string;
    isDefault?: boolean;
    layers: Array<{
      type: "drop" | "inset";
      color: string;
      opacity: string;
      blur: string;
      spread: string;
      offsetX: string;
      offsetY: string;
    }>;
  }>;
  const defaultGroup =
    groups.find((group) => group.id === "default" || group.isDefault) ||
    groups[0];
  return defaultGroup?.layers.find((layer) => layer.type === "drop");
}

describe("preset shadow styles", () => {
  it("uses the same Default styles for initialization and preset selection", () => {
    expect(defaultThemeState.styles).toEqual(getPresetThemeStyles("default"));
  });

  it("stores preset shadows as shadow-groups", () => {
    const styles = getPresetThemeStyles("violet-bloom");
    const drop = getDefaultDropLayer(styles.light["shadow-groups"]);

    expect(drop).toBeDefined();
    expect(drop?.opacity).toBe("0.16");
    expect(drop?.offsetY).toBe("2px");
    expect(drop?.blur).toBe("3px");
  });

  it("uses var(--shadow-default) for component shadow tokens", () => {
    const styles = getPresetThemeStyles("violet-bloom");

    expect(styles.light["card-shadow"]).toBe("var(--shadow-default)");
    expect(styles.light["input-shadow"]).toBe("var(--shadow-default)");
    expect(styles.light["select-shadow"]).toBe("var(--shadow-default)");
    expect(styles.light["dropdown-shadow"]).toBe("var(--shadow-default)");
    expect(styles.light["popover-shadow"]).toBe("var(--shadow-default)");
    expect(styles.light["table-shadow"]).toBe("var(--shadow-default)");
    expect(styles.light["accordion-shadow"]).toBe("var(--shadow-default)");
  });

  it("uses dark shadow-groups when provided by the preset", () => {
    const styles = getPresetThemeStyles("twitter");
    const darkDrop = getDefaultDropLayer(styles.dark["shadow-groups"]);

    expect(darkDrop).toBeDefined();
    expect(darkDrop?.color).toBe("rgba(29,161,242,0.25)");
    expect(styles.dark["dropdown-shadow"]).toBe("var(--shadow-default)");
  });

  it("applies the same shadow setup to Default and Modern Minimal", () => {
    for (const preset of ["default", "modern-minimal"] as const) {
      const styles = getPresetThemeStyles(preset);

      expect(styles.light["dropdown-shadow"]).toBe("var(--shadow-default)");
      expect(styles.light["popover-shadow"]).toBe("var(--shadow-default)");
      expect(styles.light["btn-shadow"]).toBe("var(--shadow-default)");
      expect(getDefaultDropLayer(styles.light["shadow-groups"])).toBeDefined();
    }
  });
});
