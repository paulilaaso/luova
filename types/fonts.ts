export type FontCategory =
  | "sans-serif"
  | "serif"
  | "display"
  | "handwriting"
  | "monospace";

// App's font info type
export type FontInfo = {
  family: string;
  category: FontCategory;
  variants: string[];
  variable: boolean;
};

export type PaginatedFontsResponse = {
  fonts: FontInfo[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
};
