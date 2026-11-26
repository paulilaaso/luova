const REM_PER_SPACING_UNIT = 0.25;

/**
 * Normalizes Tailwind v4 theme functions that may be emitted inside arbitrary
 * property values from external component generators. Keeping the final CSS as
 * plain browser CSS prevents first-paint/layout collapse before any theme-driven
 * style recalculation happens.
 */
export function normalizeTailwindCssFunctions(css: string): string {
  if (!css.includes("--spacing(")) return css;

  return css.replace(/--spacing\((-?\d*\.?\d+)\)/g, (_match, value) => {
    const units = Number(value);
    if (!Number.isFinite(units)) return _match;
    return `${units * REM_PER_SPACING_UNIT}rem`;
  });
}
