import { useEffect, useState, type CSSProperties } from "react";

/**
 * Theme-derived constants for recharts scaffolding (grid, axis text, series
 * colors, tooltip). Values are read from the CSS custom properties on
 * :root via getComputedStyle, so charts follow the same dark/light tokens as
 * the rest of the UI. Re-reads whenever the `data-theme` attribute on
 * <html> changes (the mechanism Layout uses to switch themes — including its
 * post-mount initialization, which a plain first render would miss).
 */

export interface ChartTheme {
  /** Resolved --color-border, for CartesianGrid strokes. */
  gridColor: string;
  /** Resolved --color-text-secondary, for axis tick labels. */
  textColor: string;
  /**
   * Categorical series palette (recharts stroke/fill). Order matches the
   * legacy PIE_COLORS: [accent, violet, error, warning, success, cyan, pink,
   * orange]. All token-backed hues (accent/error/warning/success) follow the
   * theme; hues without a token stay fixed.
   */
  series: string[];
  /** Recharts <Tooltip contentStyle> tuned to the design system. */
  tooltipStyle: CSSProperties;
}

// Fallbacks = the dark-theme token values, used before first paint / in
// non-DOM test environments where getComputedStyle has nothing to say.
const FALLBACK_GRID = "#475569";
const FALLBACK_TEXT = "#94a3b8";
const FALLBACK_SERIES = [
  "#3b82f6", // accent
  "#8b5cf6", // violet (no token)
  "#ef4444", // error
  "#eab308", // warning
  "#22c55e", // success
  "#06b6d4", // cyan (no token)
  "#ec4899", // pink (no token)
  "#f97316", // orange (no token)
];

interface ChartTokens {
  gridColor: string;
  textColor: string;
  series: string[];
}

function readChartTokens(): ChartTokens {
  if (typeof window === "undefined" || !document?.documentElement) {
    return { gridColor: FALLBACK_GRID, textColor: FALLBACK_TEXT, series: FALLBACK_SERIES };
  }
  const s = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => s.getPropertyValue(name).trim() || fallback;
  return {
    gridColor: v("--color-border", FALLBACK_GRID),
    textColor: v("--color-text-secondary", FALLBACK_TEXT),
    series: [
      v("--color-accent", FALLBACK_SERIES[0]),
      FALLBACK_SERIES[1],
      v("--color-error", FALLBACK_SERIES[2]),
      v("--color-warning", FALLBACK_SERIES[3]),
      v("--color-success", FALLBACK_SERIES[4]),
      FALLBACK_SERIES[5],
      FALLBACK_SERIES[6],
      FALLBACK_SERIES[7],
    ],
  };
}

function tokensEqual(a: ChartTokens, b: ChartTokens): boolean {
  return a.gridColor === b.gridColor && a.textColor === b.textColor && a.series.every((c, i) => c === b.series[i]);
}

/**
 * Read the categorical series palette from the theme tokens. Used for the
 * module-level PIE_COLORS export in query-detail/shared (which can't re-read
 * per render) and as the base of the hook's `series`.
 */
export function readSeriesColors(): string[] {
  return readChartTokens().series;
}

/**
 * Recharts <Tooltip contentStyle> tuned to the design system. Shared single
 * source (the hook returns it; query-detail/shared re-exports it as
 * TOOLTIP_STYLE for consumers that don't use the hook).
 */
export function chartTooltipStyle(): CSSProperties {
  return {
    backgroundColor: "var(--surface-card)",
    border: "1px solid var(--color-border)",
    borderRadius: 8,
    fontSize: 12,
  };
}

export function useChartTheme(): ChartTheme {
  const [tokens, setTokens] = useState<ChartTokens>(readChartTokens);

  useEffect(() => {
    const update = () => {
      const next = readChartTokens();
      setTokens((prev) => (tokensEqual(prev, next) ? prev : next));
    };
    // Re-read after mount: Layout sets data-theme in an effect, after the
    // first render, so the initial state may reflect the wrong theme.
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  return {
    gridColor: tokens.gridColor,
    textColor: tokens.textColor,
    series: tokens.series,
    tooltipStyle: chartTooltipStyle(),
  };
}
