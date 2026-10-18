/**
 * Helpers for the editor result chart view: deciding which columns are
 * plottable, coercing cell values to numbers (nulls/NaN are skipped so
 * recharts draws gaps), and building the point list for a LineChart.
 */

export interface ResultColumn {
  name: string;
  type: string;
}

export interface ChartPoint {
  /** X value as rendered on the axis (label or number). */
  x: string | number;
  /** Raw X label; used for the axis even when x is numeric. */
  label: string;
  /** One entry per selected Y column; missing/null → absent (gap in the line). */
  values: Record<string, number | undefined>;
}

/** Peel Nullable(...)/LowCardinality(...) wrappers down to the base type. */
function baseType(type: string): string {
  let t = (type || "").trim();
  while (/^(nullable|lowcardinality)\(/i.test(t) && t.endsWith(")")) {
    t = t.slice(t.indexOf("(") + 1, -1).trim();
  }
  return t.toLowerCase();
}

/** ClickHouse numeric-ish types: UInt/Int/Float/Decimal (outermost type). */
export function isNumericType(type: string): boolean {
  return /^(uint|int|float|decimal)/.test(baseType(type));
}

/** Date/DateTime columns make the best default X axis. */
export function isTemporalType(type: string): boolean {
  return /^(date|datetime)/.test(baseType(type));
}

/** Coerce a cell value to a finite number; null/undefined/NaN → undefined (gap). */
export function toNumber(val: unknown): number | undefined {
  if (val === null || val === undefined || val === "") return undefined;
  const n = typeof val === "number" ? val : Number(val);
  return Number.isFinite(n) ? n : undefined;
}

export interface BuildChartPointsResult {
  points: ChartPoint[];
  /** True when the input had more rows than the built-in cap (1000). */
  truncated: boolean;
}

const MAX_CHART_ROWS = 1000;

/**
 * Build chart points from result rows. `xColumn` names the axis column; when
 * it is empty (all-numeric result), points fall back to the 1-based row index.
 * Rows beyond MAX_CHART_ROWS are dropped (noted to the user via `truncated`).
 */
export function buildChartPoints(
  rows: Record<string, unknown>[],
  xColumn: string,
  yColumns: string[],
): BuildChartPointsResult {
  const limited = rows.length > MAX_CHART_ROWS ? rows.slice(0, MAX_CHART_ROWS) : rows;
  const points = limited.map((row, i) => {
    const rawX = xColumn ? row[xColumn] : i + 1;
    const displayX =
      rawX === null || rawX === undefined
        ? i + 1
        : typeof rawX === "object"
          ? JSON.stringify(rawX)
          : (rawX as string | number);
    const values: Record<string, number | undefined> = {};
    for (const col of yColumns) {
      values[col] = toNumber(row[col]);
    }
    return {
      x: displayX,
      label: displayX === i + 1 && !xColumn ? String(i + 1) : String(displayX),
      values,
    };
  });
  return { points, truncated: rows.length > MAX_CHART_ROWS };
}

/**
 * Default X axis column: first temporal column, else first non-numeric one,
 * else "" (row index) when every column is numeric.
 */
export function defaultXColumn(columns: ResultColumn[]): string {
  const temporal = columns.find((c) => isTemporalType(c.type));
  if (temporal) return temporal.name;
  const nonNumeric = columns.find((c) => !isNumericType(c.type));
  return nonNumeric ? nonNumeric.name : "";
}
