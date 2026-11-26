"use client";

import type { ReactNode } from "react";
import { useThemeCSS } from "@/hooks/use-theme-css";

interface ThemeStyleBlockProps {
  children?: ReactNode;
}

/**
 * Injects the full theme CSS block into the document.
 * Side-effects like font loading and gradient class syncing are now handled
 * by the decoupled ThemeEngineInitializer subscription.
 */
export function ThemeStyleBlock({ children }: ThemeStyleBlockProps) {
  const { css } = useThemeCSS();

  return (
    <>
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: intentional — injects sanitized theme CSS variables */}
      <style dangerouslySetInnerHTML={{ __html: css }} />
      {children}
    </>
  );
}
