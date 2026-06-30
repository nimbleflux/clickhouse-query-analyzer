import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "./button";
import { Select } from "./input";

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  pageSizeOptions?: number[];
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}

/**
 * Lightweight client-side pagination bar: "Showing X–Y of N", prev/next, and a
 * page-size selector. Caller slices its list with (page-1)*pageSize..page*pageSize
 * and resets page to 1 when filters change or the list shrinks.
 */
export function Pagination({
  page,
  pageSize,
  total,
  pageSizeOptions = [50, 100, 200],
  onPage,
  onPageSize,
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex items-center gap-2 py-2 text-xs text-[var(--color-text-secondary)]">
      <span>
        Showing {from}–{to} of {total}
      </span>
      <Button variant="ghost" size="sm" onClick={() => onPage(page - 1)} disabled={page <= 1} title="Previous page">
        <ChevronLeft className="h-3.5 w-3.5" />
      </Button>
      <span className="tabular-nums">
        page {page} / {totalPages}
      </span>
      <Button variant="ghost" size="sm" onClick={() => onPage(page + 1)} disabled={page >= totalPages} title="Next page">
        <ChevronRight className="h-3.5 w-3.5" />
      </Button>
      <Select
        value={pageSize}
        onChange={(e) => onPageSize(Number(e.target.value))}
        className="ml-auto h-7 w-20 py-0 text-xs"
        title="Rows per page"
      >
        {pageSizeOptions.map((s) => (
          <option key={s} value={s}>
            {s} / page
          </option>
        ))}
      </Select>
    </div>
  );
}
