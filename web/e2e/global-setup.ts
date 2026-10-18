import { execSync } from "node:child_process";

const CH_HTTP = "http://localhost:18123";

/**
 * Seeds the e2e ClickHouse fixtures. Uses the HTTP port of the dev compose
 * stack (docker compose port 18123). Idempotent: recreates its own database
 * every run; never touches seed.sql data.
 */
export default async function globalSetup() {
  // Fail fast with a clear message when the dev ClickHouse isn't running.
  try {
    await ch("SELECT 1", "");
  } catch (e) {
    throw new Error(
      `Dev ClickHouse is not reachable on :18123 (${e}). Run \`make dev-clickhouse && make seed\` first.`
    );
  }

  await ch(`DROP DATABASE IF EXISTS e2e`, "");
  await ch(`CREATE DATABASE e2e`, "");
  // Two monthly partitions so the parts explorer has a per-partition rollup.
  await ch(`CREATE TABLE e2e.events (
    id UInt32,
    region LowCardinality(String),
    value Float64,
    ts DateTime
  ) ENGINE = MergeTree PARTITION BY toYYYYMM(ts) ORDER BY (region, id)`);
  await ch(`INSERT INTO e2e.events
    SELECT number,
           'r' || (number % 5),
           number / 7,
           toDateTime('2026-09-01 00:00:00') + (number % 90000)
    FROM numbers(20000)`);

  // Give the query-history tests something to find regardless of editor
  // interactions: run a few distinctive statements, then force the log flush
  // (query_log buffers ~7.5s by default, which would otherwise flake).
  for (const q of [
    "SELECT count() FROM e2e.events WHERE region = 'r1'",
    "SELECT region, avg(value) FROM e2e.events GROUP BY region ORDER BY region",
  ]) {
    await ch(q);
  }
  await flushLogs();
}

async function ch(query: string, database = "e2e"): Promise<string> {
  // Setup DDL and the connectivity probe pass database="" (the e2e database
  // doesn't exist until created, and CREATE/DROP must not be scoped to it).
  const path = database ? `/?database=${encodeURIComponent(database)}` : "/";
  const res = await fetch(CH_HTTP + path, {
    method: "POST",
    body: query,
  });
  if (!res.ok) {
    throw new Error(`ClickHouse query failed (${res.status}): ${query}\n${await res.text()}`);
  }
  return res.text();
}

export async function flushLogs(): Promise<void> {
  const res = await fetch(CH_HTTP + "/", { method: "POST", body: "SYSTEM FLUSH LOGS" });
  if (!res.ok) throw new Error(`SYSTEM FLUSH LOGS failed: ${await res.text()}`);
  // Give the merge tree a beat to materialize the flushed parts.
  await new Promise((r) => setTimeout(r, 300));
}
