import { afterEach, describe, expect, it } from "vitest";
import { useUIStore } from "@/stores/ui-store";

afterEach(() => {
  useUIStore.getState().setSystemTypography(true);
  useUIStore.getState().setSystemSpacing(true);
});

describe("System switch preferences", () => {
  it("stay as set across selections and a project reset", () => {
    const ui = useUIStore.getState();
    ui.setSystemTypography(false);
    ui.setSystemSpacing(false);

    ui.selectComponent("a");
    ui.clearSelection();
    ui.selectComponent("a");
    useUIStore.getState().reset();

    expect(useUIStore.getState().systemTypography).toBe(false);
    expect(useUIStore.getState().systemSpacing).toBe(false);
  });
});
