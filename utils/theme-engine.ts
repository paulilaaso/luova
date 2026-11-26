import { COLOR_TOKEN_KEYS } from "@/config/theme-tokens";
import { useThemeStore } from "@/stores/theme-store";
import { useUIStore } from "@/stores/ui-store";
import type { ShadowGroup, ShadowLayer } from "@/types/theme";
import {
  generateLockedThemeCSS,
  generateThemeCSS,
} from "@/utils/generate-theme-css";
import {
  buildShadowGroupCss,
  getShadowMap,
  normalizeShadowTokenValue,
} from "@/utils/shadows";

const LIVE_PREVIEW_STYLE_ID = "theme-live-preview";

function getShadowMapForPreview(
  shadowGroupsOverride?: string
): Record<string, string> {
  const { themeState, currentMode } = useThemeStore.getState();
  const nextThemeState =
    shadowGroupsOverride !== undefined
      ? {
          ...themeState,
          currentMode,
          styles: {
            ...themeState.styles,
            [currentMode]: {
              ...themeState.styles[currentMode],
              "shadow-groups": shadowGroupsOverride,
            },
          },
        }
      : {
          ...themeState,
          currentMode,
        };
  return getShadowMap(nextThemeState);
}

function clearInlineShadowVars(el: HTMLElement): void {
  const propsToRemove: string[] = [];
  for (let i = 0; i < el.style.length; i++) {
    const prop = el.style[i];
    if (prop.startsWith("--shadow-")) {
      propsToRemove.push(prop);
    }
  }
  propsToRemove.forEach((prop) => {
    el.style.removeProperty(prop);
  });
}

function replaceRescopeCSS(css: string): void {
  if (typeof document === "undefined") return;
  let el = document.getElementById(
    LIVE_PREVIEW_STYLE_ID
  ) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = LIVE_PREVIEW_STYLE_ID;
    document.head.appendChild(el);
  }
  const sheet = el.sheet as CSSStyleSheet | null;
  if (sheet && typeof (sheet as any).replaceSync === "function") {
    try {
      (sheet as any).replaceSync(css);
      return;
    } catch {
      // fall through
    }
  }
  el.textContent = css;
}

function applyToken(key: string, value: string | undefined): void {
  if (typeof document === "undefined") return;

  const cssVarName = key === "spacing" ? "spacing-scale" : key;
  const isColorToken = COLOR_TOKEN_KEYS.includes(
    cssVarName as (typeof COLOR_TOKEN_KEYS)[number]
  );
  const colorBridgeVarName = isColorToken ? `color-${cssVarName}` : null;

  const root = document.documentElement;

  root.style.removeProperty(`--${cssVarName}`);
  if (colorBridgeVarName) {
    root.style.removeProperty(`--${colorBridgeVarName}`);
  }

  if (key === "shadow-groups") {
    const shadowMap = getShadowMapForPreview(value ?? "");

    clearInlineShadowVars(root);

    Object.entries(shadowMap).forEach(([name, shadowValue]) => {
      root.style.setProperty(`--${name}`, shadowValue);
    });
    return;
  }

  if (key.endsWith("-shadow")) {
    root.style.removeProperty(`--${key}-drop`);
    root.style.removeProperty(`--${key}-inset`);

    if (!value || value === "") return;

    if (value === "none" || value.startsWith("var(--shadow-")) {
      const shadowMap = getShadowMapForPreview();
      const normalizedShadow = normalizeShadowTokenValue(value, shadowMap);
      if (normalizedShadow) {
        root.style.setProperty(`--${key}`, normalizedShadow.shadow);
        root.style.setProperty(`--${key}-drop`, normalizedShadow.drop);
        root.style.setProperty(`--${key}-inset`, normalizedShadow.inset);
        return;
      }
    }

    root.style.setProperty(`--${key}`, value);
    return;
  }

  if (value && value !== "") {
    root.style.setProperty(`--${cssVarName}`, value);
    if (colorBridgeVarName) {
      root.style.setProperty(`--${colorBridgeVarName}`, `var(--${cssVarName})`);
    }
  }
}

function clearAllThemeCSSVariables(): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;

  const clearFromElement = (el: HTMLElement) => {
    const propsToRemove: string[] = [];
    for (let i = 0; i < el.style.length; i++) {
      const prop = el.style[i];
      if (prop.startsWith("--") && !prop.startsWith("--canvas-")) {
        propsToRemove.push(prop);
      }
    }
    propsToRemove.forEach((prop) => {
      el.style.removeProperty(prop);
    });
  };

  clearFromElement(root);
}

function clearTokensCssVariables(tokens: string[]): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  for (const key of tokens) {
    const cssVarName = key === "spacing" ? "spacing-scale" : key;
    root.style.removeProperty(`--${cssVarName}`);
    if (
      COLOR_TOKEN_KEYS.includes(cssVarName as (typeof COLOR_TOKEN_KEYS)[number])
    ) {
      root.style.removeProperty(`--color-${cssVarName}`);
    }
  }
}

function commitThemeToCompiledCSS(): void {
  if (typeof document === "undefined") return;
  const { themeState } = useThemeStore.getState();
  const { isThemeLocked, lockedThemeState } = useUIStore.getState();
  const css =
    isThemeLocked && lockedThemeState
      ? generateLockedThemeCSS(themeState, lockedThemeState)
      : generateThemeCSS(themeState);

  const root = document.documentElement;

  const clearFromElement = (el: HTMLElement) => {
    const propsToRemove: string[] = [];
    for (let i = 0; i < el.style.length; i++) {
      const prop = el.style[i];
      if (prop.startsWith("--") && !prop.startsWith("--canvas-")) {
        propsToRemove.push(prop);
      }
    }
    propsToRemove.forEach((prop) => {
      el.style.removeProperty(prop);
    });
  };

  clearFromElement(root);

  replaceRescopeCSS(css);
}

/**
 * Apply CSS preview for a single shadow group directly on the DOM.
 * Safe to call on every pointer move — no React/Zustand state touched.
 */
function applyShadowGroupPreview(
  groupId: string,
  layers: ShadowLayer[],
  isDefault: boolean
): void {
  if (typeof document === "undefined") return;
  const cleanId = groupId.replace(/^shadow-/, "");
  const group: ShadowGroup = {
    id: groupId,
    name: "",
    isDefault,
    layers,
  };
  const css = buildShadowGroupCss(group);
  const root = document.documentElement;

  root.style.setProperty(`--shadow-${cleanId}`, css.combined);
  root.style.setProperty(`--shadow-${cleanId}-drop`, css.drop);
  root.style.setProperty(`--shadow-${cleanId}-inset`, css.inset);

  if (cleanId === "default") {
    const standardSizes = ["", "sm", "md", "lg", "xl", "2xl", "xs", "2xs"];
    for (const size of standardSizes) {
      const key = size === "" ? "shadow" : `shadow-${size}`;
      root.style.setProperty(`--${key}`, css.combined);
    }
  }
}

export const ThemeEngine = {
  replaceRescopeCSS,
  applyToken,
  applyShadowGroupPreview,
  clearAllThemeCSSVariables,
  clearTokensCssVariables,
  commitThemeToCompiledCSS,
};
