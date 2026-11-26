import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetGoogleFontsCache,
  ensureFontsLoaded,
  loadGoogleFont,
  loadGoogleFonts,
  registerCustomFont,
} from "@/utils/fonts";

const FONT_LINK_ID = "luova-google-fonts";

beforeEach(() => {
  __resetGoogleFontsCache();
});

afterEach(() => {
  __resetGoogleFontsCache();
});

function getConsolidatedLink(): HTMLLinkElement | null {
  return document.getElementById(FONT_LINK_ID) as HTMLLinkElement | null;
}

function countGoogleFontLinks(): number {
  return document.querySelectorAll(`link[href*="fonts.googleapis.com"]`).length;
}

describe("loadGoogleFont (individual links)", () => {
  it("injects a <link> element for the font", () => {
    loadGoogleFont("Inter");

    const links = document.querySelectorAll(
      `link[href*="fonts.googleapis.com"]`
    );
    expect(links.length).toBe(1);
    expect(links[0].getAttribute("href")).toContain("Inter");
  });

  it("does not create duplicates for the same font", () => {
    loadGoogleFont("Inter");
    loadGoogleFont("Inter");

    expect(countGoogleFontLinks()).toBe(1);
  });

  it("creates separate links for different fonts", () => {
    loadGoogleFont("Inter");
    loadGoogleFont("Roboto");

    expect(countGoogleFontLinks()).toBe(2);
  });

  it("does not touch the consolidated theme link", () => {
    loadGoogleFont("Inter");
    expect(getConsolidatedLink()).toBeNull();
  });

  it("skips system fonts", () => {
    loadGoogleFont("sans-serif");
    expect(countGoogleFontLinks()).toBe(0);
  });

  it("skips custom registered fonts", () => {
    registerCustomFont("MyCustomFont");
    loadGoogleFont("MyCustomFont");
    expect(countGoogleFontLinks()).toBe(0);
  });
});

describe("loadGoogleFonts (consolidated theme link)", () => {
  it("creates a single <link> with all families", () => {
    loadGoogleFonts(["Inter", "Roboto", "Open Sans"]);

    const link = getConsolidatedLink();
    expect(link).not.toBeNull();
    expect(link?.id).toBe(FONT_LINK_ID);
    expect(link?.href).toContain("Inter");
    expect(link?.href).toContain("Roboto");
    expect(link?.href).toContain("Open+Sans");
    // One consolidated link, no individual extras
    expect(countGoogleFontLinks()).toBe(1);
  });

  it("reuses the same element on subsequent calls", () => {
    loadGoogleFonts(["Inter"]);
    const link1 = getConsolidatedLink();
    loadGoogleFonts(["Roboto"]);
    const link2 = getConsolidatedLink();

    expect(link2).toBe(link1);
  });

  it("filters out system fonts", () => {
    loadGoogleFonts(["Inter", "serif"]);

    const href = getConsolidatedLink()?.href ?? "";
    expect(href).toContain("Inter");
    expect(href).not.toContain("serif");
  });
});

describe("ensureFontsLoaded", () => {
  it("extracts font families from theme variables", () => {
    const variables = {
      "font-sans": "Inter, ui-sans-serif, system-ui, sans-serif",
      "font-serif": "Merriweather, ui-serif, serif",
      "font-mono": "JetBrains Mono, ui-monospace, monospace",
      "font-heading": "Poppins, sans-serif",
    };
    ensureFontsLoaded(variables);

    const href = getConsolidatedLink()?.href ?? "";
    expect(href).toContain("Inter");
    expect(href).toContain("Merriweather");
    expect(href).toContain("JetBrains+Mono");
    expect(href).toContain("Poppins");
  });

  it("skips theme-keyword values like 'sans'", () => {
    const variables = {
      "font-sans": "Inter, sans-serif",
      "font-heading": "sans, sans-serif",
    };
    ensureFontsLoaded(variables);

    const href = getConsolidatedLink()?.href ?? "";
    expect(href).toContain("Inter");
    expect(href).not.toContain("?family=sans");
  });

  it("does not inject a link when all values are system fonts", () => {
    const variables = {
      "font-sans": "sans-serif, sans-serif",
      "font-serif": "serif, serif",
    };
    ensureFontsLoaded(variables);
    expect(getConsolidatedLink()).toBeNull();
  });

  it("does not request common system font families from Google", () => {
    ensureFontsLoaded({
      "font-sans": "Architects Daughter, sans-serif",
      "font-serif": '"Times New Roman", Times, serif',
      "font-mono": '"Courier New", Courier, monospace',
    });

    const href = getConsolidatedLink()?.href ?? "";
    expect(href).toContain("Architects+Daughter");
    expect(href).not.toContain("Times+New+Roman");
    expect(href).not.toContain("Courier+New");
  });
});

describe("cross-mechanism dedup", () => {
  it("prevents individual load after consolidated load", () => {
    loadGoogleFonts(["Inter"]);
    expect(countGoogleFontLinks()).toBe(1);

    loadGoogleFont("Inter");
    // Should NOT create a second link
    expect(countGoogleFontLinks()).toBe(1);
  });
});
