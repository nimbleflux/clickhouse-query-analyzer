import type { Recommendation } from "@/api/types";

export type AnalysisMode = "single" | "database" | "all";
export type SortField = "table" | "rows" | "bytes" | "recs" | "severity";

export const CATEGORY_LABELS: Record<string, string> = {
  data_type: "Data Type",
  order_by: "ORDER BY",
  partition_by: "PARTITION BY",
  index: "Skipping Index",
  codec: "Codec",
  health: "Table Health",
};

export const CATEGORY_ORDER = ["data_type", "order_by", "partition_by", "index", "codec", "health"];

export const SEVERITY_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };

export const CONFIDENCE_TOOLTIPS: Record<string, string> = {
  high: "Based on sufficient data — reliable recommendation",
  medium: "Based on moderate data — consider verifying before applying",
  low: "Based on limited data — verify with a full scan or larger sample before applying",
};

export function severityScore(recs: Recommendation[]): number {
  return recs.reduce((sum, r) => sum + (SEVERITY_RANK[r.severity] || 0), 0);
}

export function groupByCategory(recs: Recommendation[]): Record<string, Recommendation[]> {
  const result: Record<string, Recommendation[]> = {};
  for (const r of recs) {
    const cat = r.category || "other";
    if (!result[cat]) result[cat] = [];
    result[cat].push(r);
  }
  for (const k of Object.keys(result)) {
    result[k].sort((a, b) => (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0));
  }
  return result;
}

export function countBySeverity(recs: Recommendation[]): { high: number; medium: number; low: number } {
  const counts = { high: 0, medium: 0, low: 0 };
  for (const r of recs) {
    if (r.severity in counts) counts[r.severity as keyof typeof counts]++;
  }
  return counts;
}
