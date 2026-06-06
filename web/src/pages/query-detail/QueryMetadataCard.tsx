import { Database, Table2, FunctionSquare, FileOutput, FileInput, Type, GitBranch } from "lucide-react";
import type { QueryLogEntry } from "@/api/types";
import { formatBytes, formatNumber } from "@/utils";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface QueryMetadataCardProps {
  query: QueryLogEntry;
}

function MetadataRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  if (!value || (Array.isArray(value) && value.length === 0)) return null;
  return (
    <div className="flex items-start gap-2 border-b border-[var(--color-border)] py-1.5 last:border-0">
      <span className="mt-0.5 flex items-center gap-1 text-xs text-[var(--color-text-secondary)]">
        {icon}
        {label}
      </span>
      <span className="ml-auto text-right text-xs text-[var(--color-text-primary)]">{value}</span>
    </div>
  );
}

function BadgeList({ items, max = 6 }: { items: string[]; max?: number }) {
  if (!items || items.length === 0) return null;
  const display = items.slice(0, max);
  const overflow = items.length - display.length;
  return (
    <div className="flex flex-wrap justify-end gap-1">
      {display.map((item, i) => (
        <Badge key={`${item}-${i}`} variant="outline" className="font-mono text-[10px]">
          {item}
        </Badge>
      ))}
      {overflow > 0 && (
        <Badge variant="outline" className="text-[10px] opacity-70">
          +{overflow}
        </Badge>
      )}
    </div>
  );
}

export function QueryMetadataCard({ query }: QueryMetadataCardProps) {
  const hasDatabases = query.databases && query.databases.length > 0;
  const hasTables = query.tables && query.tables.length > 0;
  const hasFunctions = query.used_functions && query.used_functions.length > 0;
  const hasAggFunctions = query.used_aggregate_functions && query.used_aggregate_functions.length > 0;
  const hasStorages = query.used_storages && query.used_storages.length > 0;
  const hasAnything = query.query_kind || hasDatabases || hasTables || hasFunctions || hasAggFunctions || hasStorages || query.written_rows > 0 || query.written_bytes > 0 || query.result_bytes > 0;

  if (!hasAnything) return null;

  return (
    <Card className="p-4">
      <div className="mb-3 text-xs font-medium text-[var(--color-text-secondary)]">Query Anatomy</div>
      <MetadataRow
        icon={<Type className="h-3 w-3" />}
        label="Type"
        value={
          <span className="flex items-center gap-1.5">
            <Badge variant={query.type === "QueryFinish" ? "success" : query.exception ? "error" : "outline"} className="text-[10px]">
              {query.type}
            </Badge>
            {query.query_kind && (
              <Badge variant="outline" className="text-[10px]">
                {query.query_kind}
              </Badge>
            )}
          </span>
        }
      />
      {query.is_initial_query === 0 && (
        <MetadataRow
          icon={<GitBranch className="h-3 w-3" />}
          label="Initial Query"
          value={<span className="font-mono text-[10px]">{query.initial_query_id}</span>}
        />
      )}
      <MetadataRow
        icon={<Database className="h-3 w-3" />}
        label="Databases"
        value={<BadgeList items={query.databases || []} />}
      />
      <MetadataRow
        icon={<Table2 className="h-3 w-3" />}
        label="Tables"
        value={<BadgeList items={query.tables || []} max={4} />}
      />
      {query.written_rows > 0 && (
        <MetadataRow
          icon={<FileOutput className="h-3 w-3" />}
          label="Written"
          value={
            <span className="font-mono">
              {formatNumber(query.written_rows)} rows ({formatBytes(query.written_bytes)})
            </span>
          }
        />
      )}
      {query.result_bytes > 0 && (
        <MetadataRow
          icon={<FileInput className="h-3 w-3" />}
          label="Result Size"
          value={<span className="font-mono">{formatBytes(query.result_bytes)}</span>}
        />
      )}
      <MetadataRow
        icon={<FunctionSquare className="h-3 w-3" />}
        label="Functions"
        value={<BadgeList items={query.used_functions || []} max={8} />}
      />
      {hasAggFunctions && (
        <MetadataRow
          icon={<FunctionSquare className="h-3 w-3" />}
          label="Aggregate Functions"
          value={<BadgeList items={query.used_aggregate_functions || []} max={6} />}
        />
      )}
      {hasStorages && (
        <MetadataRow
          icon={<Database className="h-3 w-3" />}
          label="Storages"
          value={<BadgeList items={query.used_storages || []} />}
        />
      )}
    </Card>
  );
}
