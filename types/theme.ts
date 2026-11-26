import {
  OPTIONAL_TOKEN_KEYS,
  type THEME_TOKENS,
  TOKEN_KEYS,
} from "@/config/theme-tokens";

type TokenKey = keyof typeof THEME_TOKENS;

type KnownTokenValues = { [K in TokenKey]: string };

export type ThemeStyleProps = KnownTokenValues & {
  /** Permissive index for dynamic/AI-added token keys. */
  [key: string]: string | undefined;
} & {
  /** Custom fonts uploaded by the user (stored per mode). */
  customFonts?: CustomFont[];
};

export type ThemeStyles = {
  light: ThemeStyleProps;
  dark: ThemeStyleProps;
  customFonts?: CustomFont[];
};

export interface CustomFont {
  id: string;
  family: string;
  assetId: string;
  extension: string;
}

export type ThemePreset = {
  source?: "SAVED" | "BUILT_IN";
  createdAt?: string;
  label?: string;
  styles: {
    light: Partial<ThemeStyleProps>;
    dark: Partial<ThemeStyleProps>;
  };
};

// Define shadow layer type for dynamic multiple shadows
export interface ShadowLayer {
  id: string;
  type: "drop" | "inset";
  offsetX: string;
  offsetY: string;
  blur: string;
  spread: string;
  opacity: string;
  color: string;
  visible?: boolean;
}

// Define shadow group containing multiple layers
export interface ShadowGroup {
  id: string;
  name: string;
  isDefault: boolean;
  visible?: boolean;
  layers: ShadowLayer[];
}

export { OPTIONAL_TOKEN_KEYS, TOKEN_KEYS };
