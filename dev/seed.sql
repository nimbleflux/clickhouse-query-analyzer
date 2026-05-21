CREATE DATABASE IF NOT EXISTS analytics;

CREATE TABLE IF NOT EXISTS analytics.events
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
ENGINE = MergeTree()
PARTITION BY toYYYYMM(event_time)
ORDER BY (event_time, user_id, event_type)
SETTINGS index_granularity = 8192;

INSERT INTO analytics.events (event_time, event_type, user_id, session_id, page_url, country, city, browser, os, device, duration_ms, bytes_sent, status_code)
SELECT
    now() - intDiv(number, 10) * 60,
    ['page_view', 'click', 'api_call', 'error', 'purchase'][rand32() % 5 + 1],
    rand64() % 100000,
    concat('session_', toString(rand64() % 10000)),
    concat('/page/', toString(rand64() % 500)),
    ['US', 'UK', 'DE', 'FR', 'JP', 'AU', 'CA', 'BR', 'IN', 'NL'][rand32() % 10 + 1],
    ['New York', 'London', 'Berlin', 'Paris', 'Tokyo', 'Sydney', 'Toronto', 'Sao Paulo', 'Mumbai', 'Amsterdam'][rand32() % 10 + 1],
    ['Chrome', 'Firefox', 'Safari', 'Edge'][rand32() % 4 + 1],
    ['Windows', 'macOS', 'Linux', 'iOS', 'Android'][rand32() % 5 + 1],
    ['desktop', 'mobile', 'tablet'][rand32() % 3 + 1],
    rand32() % 5000,
    rand64() % 1000000,
    [200, 200, 200, 200, 404, 500, 301][rand32() % 7 + 1]
FROM numbers(100000);

SYSTEM FLUSH LOGS;
