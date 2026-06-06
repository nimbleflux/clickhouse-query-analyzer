import { formatBytes, formatDuration, formatNumber } from "@/utils";

export interface StorageReadWrite {
  label: string;
  count: number;
  timeUs: number;
  errors: number;
  throttled: number;
  retries: number;
}

export interface StorageThroughput {
  label: string;
  readBytes: number;
  writeBytes: number;
  readTimeUs: number;
  writeTimeUs: number;
}

export interface StorageThrottler {
  label: string;
  count: number;
  blocked: number;
  sleepUs: number;
}

export interface StorageDiskIO {
  label: string;
  read: number;
  write: number;
  readFmt: (v: number) => string;
  writeFmt: (v: number) => string;
}

export interface StorageCompression {
  name: string;
  compressed: number;
  uncompressed: number;
}

export interface StorageExtracted {
  diskIO: StorageDiskIO[];
  compression: StorageCompression[];
  fileOps: [string, number][];
  cache: [string, number][];
  remoteFs: { name: string; value: number }[];
  apiOps: { name: string; s3: number; diskS3: number; azure: number; diskAzure: number }[];
  readWrite: StorageReadWrite[];
  throughput: StorageThroughput[];
  throttlers: StorageThrottler[];
}

const S3_API_OPS = [
  "GetObject", "PutObject", "DeleteObjects", "ListObjects", "HeadObject",
  "CopyObject", "GetObjectTagging", "CreateMultipartUpload", "UploadPart",
  "UploadPartCopy", "CompleteMultipartUpload", "AbortMultipartUpload",
];

const AZURE_API_OPS = [
  "GetObject", "Upload", "StageBlock", "CommitBlockList", "CopyObject",
  "DeleteObjects", "ListObjects", "GetProperties", "CreateContainer",
];

function getVal(events: Record<string, number>, key: string): number {
  return events[key] || 0;
}

export function extractStorageEvents(events: Record<string, number>): StorageExtracted {
  const diskIO: StorageDiskIO[] = [];
  const diskIORows: [string, string, string, string, (v: number) => string, (v: number) => string][] = [
    ["Elapsed", "Elapsed Time", "DiskReadElapsedMicroseconds", "DiskWriteElapsedMicroseconds", (v: number) => formatDuration(v / 1000), (v: number) => formatDuration(v / 1000)],
    ["Bytes", "Bytes", "DiskReadBytes", "DiskWriteBytes", formatBytes, formatBytes],
  ];
  for (const [, label, readKey, writeKey, readFmt, writeFmt] of diskIORows) {
    const read = getVal(events, readKey);
    const write = getVal(events, writeKey);
    if (read > 0 || write > 0) {
      diskIO.push({ label, read, write, readFmt, writeFmt });
    }
  }

  const compression: StorageCompression[] = [];
  const compressionPairs: [string, string, string][] = [
    ["ReadCompressedBytes", "Read (Compressed/Uncompressed)", "UncompressedReadBufferBytes"],
    ["WriteCompressedBytes", "Write (Compressed/Uncompressed)", "UncompressedWriteBufferBytes"],
  ];
  for (const [compKey, name, uncompKey] of compressionPairs) {
    const compressed = getVal(events, compKey);
    const uncompressed = getVal(events, uncompKey);
    if (compressed > 0 || uncompressed > 0) {
      compression.push({ name, compressed, uncompressed });
    }
  }

  const fileOpsKeys = [
    "FileOpen", "FileOpenFailed", "SeekCount", "ReadCompressedBytes",
    "CreatedReadBufferOrdinary", "CreatedReadBufferDirectIO", "CreatedReadBufferMMap",
    "CreatedWriteBufferOrdinary", "CreatedWriteBufferDirectIO",
    "IOBufferAllocBytes", "IOBufferAllocs",
    "ArenaAllocBytes", "ArenaAllocChunks",
    "MMappedFileCacheHits", "MMappedFileCacheMisses",
  ];
  const fileOps = fileOpsKeys
    .map((k) => [k, getVal(events, k)] as [string, number])
    .filter(([, v]) => v > 0);

  const apiOpsMap = new Map<string, { s3: number; diskS3: number; azure: number; diskAzure: number }>();

  for (const op of S3_API_OPS) {
    const s3 = getVal(events, `S3${op}`);
    const diskS3 = getVal(events, `DiskS3${op}`);
    if (s3 > 0 || diskS3 > 0) apiOpsMap.set(op, { ...(apiOpsMap.get(op) || { s3: 0, diskS3: 0, azure: 0, diskAzure: 0 }), s3, diskS3 });
  }
  for (const op of AZURE_API_OPS) {
    const azure = getVal(events, `Azure${op}`);
    const diskAzure = getVal(events, `DiskAzure${op}`);
    if (azure > 0 || diskAzure > 0) apiOpsMap.set(op, { ...(apiOpsMap.get(op) || { s3: 0, diskS3: 0, azure: 0, diskAzure: 0 }), azure, diskAzure });
  }

  const apiOps = Array.from(apiOpsMap.entries())
    .map(([name, vals]) => ({ name, ...vals }))
    .filter((r) => r.s3 + r.diskS3 + r.azure + r.diskAzure > 0);

  const readWrite: StorageReadWrite[] = [];
  for (const [prefix, label] of [["S3", "S3"], ["DiskS3", "DiskS3"], ["Azure", "Azure"], ["DiskAzure", "DiskAzure"]] as [string, string][]) {
    const rc = getVal(events, `${prefix}ReadRequestsCount`);
    const wc = getVal(events, `${prefix}WriteRequestsCount`);
    if (rc > 0 || wc > 0) {
      readWrite.push({
        label,
        count: rc + wc,
        timeUs: getVal(events, `${prefix}ReadMicroseconds`) + getVal(events, `${prefix}WriteMicroseconds`),
        errors: getVal(events, `${prefix}ReadRequestsErrors`) + getVal(events, `${prefix}WriteRequestsErrors`),
        throttled: getVal(events, `${prefix}ReadRequestsThrottling`) + getVal(events, `${prefix}WriteRequestsThrottling`),
        retries: getVal(events, `${prefix}ReadRequestRetryableErrors`) + getVal(events, `${prefix}WriteRequestRetryableErrors`),
      });
    }
  }

  const throughput: StorageThroughput[] = [];
  for (const [prefix, label] of [["S3", "S3"], ["Azure", "Azure"]] as [string, string][]) {
    const rb = getVal(events, `ReadBufferFrom${prefix}Bytes`);
    const wb = getVal(events, `WriteBufferFrom${prefix}Bytes`);
    const rt = getVal(events, `ReadBufferFrom${prefix}Microseconds`);
    const wt = getVal(events, `WriteBufferFrom${prefix}Microseconds`);
    if (rb > 0 || wb > 0 || rt > 0 || wt > 0) {
      throughput.push({ label, readBytes: rb, writeBytes: wb, readTimeUs: rt, writeTimeUs: wt });
    }
  }

  const throttlers: StorageThrottler[] = [];
  for (const [prefix, label] of [
    ["S3GetRequest", "S3 GET"], ["S3PutRequest", "S3 PUT"],
    ["DiskS3GetRequest", "DiskS3 GET"], ["DiskS3PutRequest", "DiskS3 PUT"],
    ["AzureGetRequest", "Azure GET"], ["AzurePutRequest", "Azure PUT"],
    ["DiskAzureGetRequest", "DiskAzure GET"], ["DiskAzurePutRequest", "DiskAzure PUT"],
    ["RemoteRead", "Remote Read"], ["RemoteWrite", "Remote Write"],
    ["QueryRemoteRead", "Query Remote Read"], ["QueryRemoteWrite", "Query Remote Write"],
  ] as [string, string][]) {
    const count = getVal(events, `${prefix}ThrottlerCount`);
    const blocked = getVal(events, `${prefix}ThrottlerBlocked`);
    const sleepUs = getVal(events, `${prefix}ThrottlerSleepMicroseconds`);
    if (count > 0 || blocked > 0 || sleepUs > 0) {
      throttlers.push({ label, count, blocked, sleepUs });
    }
  }

  const remoteFsKeys = [
    "RemoteFSSeeks", "RemoteFSPrefetches", "RemoteFSCancelledPrefetches",
    "RemoteFSUnusedPrefetches", "RemoteFSPrefetchedReads", "RemoteFSPrefetchedBytes",
    "RemoteFSUnprefetchedReads", "RemoteFSUnprefetchedBytes", "RemoteFSLazySeeks",
    "RemoteFSSeeksWithReset", "RemoteFSBuffers",
  ];
  const remoteFs = remoteFsKeys
    .map((k) => ({ name: k.replace("RemoteFS", ""), value: getVal(events, k) }))
    .filter((r) => r.value > 0);

  const cacheKeys = [
    "CachedReadBufferReadFromCacheHits", "CachedReadBufferReadFromCacheMisses",
    "CachedReadBufferReadFromSourceMicroseconds", "CachedReadBufferReadFromCacheMicroseconds",
    "CachedReadBufferReadFromSourceBytes", "CachedReadBufferReadFromCacheBytes",
    "CachedReadBufferCacheWriteBytes", "CachedReadBufferCacheWriteMicroseconds",
    "CachedWriteBufferCacheWriteBytes", "CachedWriteBufferCacheWriteMicroseconds",
  ];
  const cache = cacheKeys
    .map((k) => [k, getVal(events, k)] as [string, number])
    .filter(([, v]) => v > 0);

  return { diskIO, compression, fileOps, cache, remoteFs, apiOps, readWrite, throughput, throttlers };
}

export { formatBytes, formatDuration, formatNumber };
