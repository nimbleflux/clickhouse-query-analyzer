-- ReplicatedMergeTree seed. Run on BOTH clickhouse nodes (the DDL is
-- identical — {shard}/{replica} macros resolve per-node via config.xml).
-- Creates a replicated copy of analytics.events and inserts on the leader
-- so the replication dashboard has real queue/lag data to display.

CREATE DATABASE IF NOT EXISTS analytics;

CREATE TABLE IF NOT EXISTS analytics.events_replicated
(
    event_id UUID DEFAULT generateUUIDv4(),
    event_time DateTime DEFAULT now(),
    event_type LowCardinality(String),
    user_id UInt64,
    session_id String,
    page_url String,
    country LowCardinality(String),
    city LowCardinality(String),
    browser LowCardinality(String),
    os LowCardinality(String),
    device LowCardinality(String),
    duration_ms UInt32,
    bytes_sent UInt64,
    status_code UInt16
)
ENGINE = ReplicatedMergeTree('/clickhouse/tables/{shard}/analytics/events_replicated', '{replica}')
PARTITION BY toYYYYMM(event_time)
ORDER BY (event_time, user_id, event_type)
SETTINGS index_granularity = 8192;
