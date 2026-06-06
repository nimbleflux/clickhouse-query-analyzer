import { Zap } from "lucide-react";
import type { Recommendation } from "@/api/types";
import { CATEGORY_ORDER, CATEGORY_LABELS, groupByCategory } from "./types";
import { RecommendationCard } from "./RecommendationCard";

interface RecommendationCardsProps {
  recommendations: Recommendation[];
}

export function RecommendationCards({ recommendations }: RecommendationCardsProps) {
  if (recommendations.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-[var(--color-success)]/30 bg-[var(--state-success)] p-4 text-sm text-[var(--color-success)]">
        <Zap className="h-4 w-4" /> No optimizations needed — table looks good!
      </div>
    );
  }

  const grouped = groupByCategory(recommendations);

  return (
    <div className="space-y-4">
      {CATEGORY_ORDER.map((cat) => {
        const recs = grouped[cat];
        if (!recs || recs.length === 0) return null;
        return (
          <div key={cat}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">
              {CATEGORY_LABELS[cat] || cat}
            </h3>
            <div className="space-y-2">
              {recs.map((r, i) => <RecommendationCard key={i} rec={r} />)}
            </div>
          </div>
        );
      })}
      {/* Render any categories not in CATEGORY_ORDER */}
      {Object.keys(grouped)
        .filter((cat) => !CATEGORY_ORDER.includes(cat))
        .map((cat) => {
          const recs = grouped[cat];
          return (
            <div key={cat}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">
                {cat}
              </h3>
              <div className="space-y-2">
                {recs.map((r, i) => <RecommendationCard key={i} rec={r} />)}
              </div>
            </div>
          );
        })}
    </div>
  );
}
