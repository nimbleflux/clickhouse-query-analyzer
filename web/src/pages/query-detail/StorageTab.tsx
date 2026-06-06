import { Cloud } from "lucide-react";
import {
  BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { formatBytes, formatDuration, formatNumber } from "@/utils";
import { ChartSection } from "./shared";
import {
  extractStorageEvents,
  type StorageExtracted,
} from "./storage-types";

const TOOLTIP_STYLE = {
  backgroundColor: "var(--surface-card)",
  border: "1px solid var(--color-border)",
  borderRadius: 8,
  fontSize: 12,
};

export function StorageTab({ events }: { events: Record<string, number> }) {
  const storageEvents: StorageExtracted = extractStorageEvents(events);

  return (
    <div className="space-y-6">
      {storageEvents.diskIO.length > 0 && (
        <ChartSection title="Disk I/O">
          <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] bg-[var(--surface-elevated)]">
                  <th className="px-4 py-2 text-left font-medium text-[var(--color-text-secondary)]">Metric</th>
                  <th className="px-4 py-2 text-right font-medium text-[var(--color-text-secondary)]">Read</th>
                  <th className="px-4 py-2 text-right font-medium text-[var(--color-text-secondary)]">Write</th>
                </tr>
              </thead>
              <tbody>
                {storageEvents.diskIO.map((dio) => (
                  <tr key={dio.label} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="px-4 py-2 text-xs font-medium">{dio.label}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs">{dio.read > 0 ? dio.readFmt(dio.read) : "-"}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs">{dio.write > 0 ? dio.writeFmt(dio.write) : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ChartSection>
      )}

      {storageEvents.compression.length > 0 && (
        <ChartSection title="Compression">
          <ResponsiveContainer width="100%" height={storageEvents.compression.length * 40 + 80}>
            <BarChart data={storageEvents.compression} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis type="number" tick={{ fontSize: 11 }} stroke="var(--color-text-secondary)" tickFormatter={(v: number) => formatBytes(v)} />
              <YAxis dataKey="name" type="category" width={160} tick={{ fontSize: 10 }} stroke="var(--color-text-secondary)" />
              <Tooltip contentStyle={{ ...TOOLTIP_STYLE, zIndex: 50 }} formatter={(v) => formatBytes(Number(v))} />
              <Bar dataKey="compressed" fill="#3b82f6" name="Compressed" />
              <Bar dataKey="uncompressed" fill="#60a5fa" name="Uncompressed" />
              <Legend />
            </BarChart>
          </ResponsiveContainer>
        </ChartSection>
      )}

      {storageEvents.fileOps.length > 0 && (
        <ChartSection title="File Operations">
          <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] bg-[var(--surface-elevated)]">
                  <th className="px-4 py-2 text-left font-medium text-[var(--color-text-secondary)]">Metric</th>
                  <th className="px-4 py-2 text-right font-medium text-[var(--color-text-secondary)]">Value</th>
                </tr>
              </thead>
              <tbody>
                {storageEvents.fileOps.map(([name, value]) => (
                  <tr key={name} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="px-4 py-2 text-xs">{name}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs">{formatNumber(value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ChartSection>
      )}

      {storageEvents.cache.length > 0 && (
        <ChartSection title="Filesystem Cache">
          <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] bg-[var(--surface-elevated)]">
                  <th className="px-4 py-2 text-left font-medium text-[var(--color-text-secondary)]">Metric</th>
                  <th className="px-4 py-2 text-right font-medium text-[var(--color-text-secondary)]">Value</th>
                </tr>
              </thead>
              <tbody>
                {storageEvents.cache.map(([name, value]) => (
                  <tr key={name} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="px-4 py-2 text-xs">{name}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs">
                      {name.toLowerCase().includes("bytes") ? formatBytes(value) :
                       name.toLowerCase().includes("microseconds") ? formatDuration(value / 1000) :
                       formatNumber(value)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ChartSection>
      )}

      {storageEvents.remoteFs.length > 0 && (
        <ChartSection title="Remote Filesystem / Prefetch">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={storageEvents.remoteFs} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis type="number" tick={{ fontSize: 11 }} stroke="var(--color-text-secondary)" allowDecimals={false} />
              <YAxis dataKey="name" type="category" width={180} tick={{ fontSize: 10 }} stroke="var(--color-text-secondary)" />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Bar dataKey="value" fill="#3b82f6" />
            </BarChart>
          </ResponsiveContainer>
        </ChartSection>
      )}

      {storageEvents.apiOps.length > 0 && (
        <ChartSection title="API Operations">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={storageEvents.apiOps}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} stroke="var(--color-text-secondary)" interval={0} angle={-30} textAnchor="end" height={80} />
              <YAxis tick={{ fontSize: 11 }} stroke="var(--color-text-secondary)" allowDecimals={false} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Bar dataKey="s3" fill="#3b82f6" name="S3" />
              <Bar dataKey="diskS3" fill="#60a5fa" name="DiskS3" />
              <Bar dataKey="azure" fill="#f59e0b" name="Azure" />
              <Bar dataKey="diskAzure" fill="#fbbf24" name="DiskAzure" />
              <Legend />
            </BarChart>
          </ResponsiveContainer>
        </ChartSection>
      )}

      {storageEvents.readWrite.length > 0 && (
        <ChartSection title="Remote Storage Read/Write">
          <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] bg-[var(--surface-elevated)]">
                  <th className="px-4 py-2 text-left font-medium text-[var(--color-text-secondary)]">Metric</th>
                  <th className="px-4 py-2 text-right font-medium text-[var(--color-text-secondary)]">Requests</th>
                  <th className="px-4 py-2 text-right font-medium text-[var(--color-text-secondary)]">Time</th>
                  <th className="px-4 py-2 text-right font-medium text-[var(--color-text-secondary)]">Errors</th>
                  <th className="px-4 py-2 text-right font-medium text-[var(--color-text-secondary)]">Throttled</th>
                  <th className="px-4 py-2 text-right font-medium text-[var(--color-text-secondary)]">Retries</th>
                </tr>
              </thead>
              <tbody>
                {storageEvents.readWrite.map((rw) => (
                  <tr key={rw.label} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="px-4 py-2 text-xs font-medium">{rw.label}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs">{formatNumber(rw.count)}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs">{rw.timeUs > 0 ? formatDuration(rw.timeUs / 1000) : "-"}</td>
                    <td className={`px-4 py-2 text-right font-mono text-xs ${rw.errors > 0 ? "text-[var(--color-error)]" : ""}`}>
                      {rw.errors > 0 ? rw.errors : "-"}
                    </td>
                    <td className={`px-4 py-2 text-right font-mono text-xs ${rw.throttled > 0 ? "text-[var(--color-warning)]" : ""}`}>
                      {rw.throttled > 0 ? rw.throttled : "-"}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs">{rw.retries > 0 ? rw.retries : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ChartSection>
      )}

      {storageEvents.throughput.length > 0 && (
        <ChartSection title="Remote Storage Throughput">
          <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] bg-[var(--surface-elevated)]">
                  <th className="px-4 py-2 text-left font-medium text-[var(--color-text-secondary)]">Source</th>
                  <th className="px-4 py-2 text-right font-medium text-[var(--color-text-secondary)]">Bytes Read</th>
                  <th className="px-4 py-2 text-right font-medium text-[var(--color-text-secondary)]">Bytes Written</th>
                  <th className="px-4 py-2 text-right font-medium text-[var(--color-text-secondary)]">Read Time</th>
                  <th className="px-4 py-2 text-right font-medium text-[var(--color-text-secondary)]">Write Time</th>
                </tr>
              </thead>
              <tbody>
                {storageEvents.throughput.map((tp) => (
                  <tr key={tp.label} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="px-4 py-2 text-xs font-medium">{tp.label}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs">{tp.readBytes > 0 ? formatBytes(tp.readBytes) : "-"}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs">{tp.writeBytes > 0 ? formatBytes(tp.writeBytes) : "-"}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs">{tp.readTimeUs > 0 ? formatDuration(tp.readTimeUs / 1000) : "-"}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs">{tp.writeTimeUs > 0 ? formatDuration(tp.writeTimeUs / 1000) : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ChartSection>
      )}

      {storageEvents.throttlers.length > 0 && (
        <ChartSection title="Throttling">
          <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] bg-[var(--surface-elevated)]">
                  <th className="px-4 py-2 text-left font-medium text-[var(--color-text-secondary)]">Throttler</th>
                  <th className="px-4 py-2 text-right font-medium text-[var(--color-text-secondary)]">Passed</th>
                  <th className="px-4 py-2 text-right font-medium text-[var(--color-text-secondary)]">Blocked</th>
                  <th className="px-4 py-2 text-right font-medium text-[var(--color-text-secondary)]">Sleep Time</th>
                </tr>
              </thead>
              <tbody>
                {storageEvents.throttlers.map((th) => (
                  <tr key={th.label} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="px-4 py-2 text-xs font-medium">{th.label}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs">{formatNumber(th.count)}</td>
                    <td className={`px-4 py-2 text-right font-mono text-xs ${th.blocked > 0 ? "text-[var(--color-warning)]" : ""}`}>
                      {th.blocked}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs">
                      {th.sleepUs > 0 ? formatDuration(th.sleepUs / 1000) : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ChartSection>
      )}

      {!storageEvents.diskIO.length && !storageEvents.compression.length && !storageEvents.fileOps.length &&
       !storageEvents.cache.length && !storageEvents.remoteFs.length && !storageEvents.apiOps.length && (
        <div className="flex flex-col items-center gap-4 py-16">
          <Cloud className="h-10 w-10 text-[var(--color-text-secondary)]" />
          <p className="text-sm text-[var(--color-text-secondary)]">No storage I/O data available for this query.</p>
          <p className="max-w-md text-center text-xs text-[var(--color-text-secondary)]">
            This tab shows disk I/O, compression, filesystem cache, and remote storage metrics.
          </p>
        </div>
      )}
    </div>
  );
}
