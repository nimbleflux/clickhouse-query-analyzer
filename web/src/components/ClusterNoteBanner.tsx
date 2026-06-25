import { Info } from "lucide-react";

// Renders the cluster-detection caveat (if any) returned by the backend.
// Fires only when the connecting user couldn't read system.clusters — the page
// then runs in local-only mode. Distinct from the partial-errors banner: this
// is about query *mode*, not a missing section.
export function ClusterNoteBanner({ note }: { note?: string }) {
  if (!note) return null;
  return (
    <div className="flex items-start gap-2 rounded-lg border border-[var(--color-accent)]/30 bg-[var(--state-accent)] px-4 py-2 text-xs text-[var(--color-text-secondary)]">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-accent)]" />
      <span>{note}</span>
    </div>
  );
}
