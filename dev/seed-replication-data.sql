-- Inserts into the replicated table on node 1 only. ReplicatedMergeTree
-- asynchronously ships these parts to node 2 via Keeper — that's the traffic
-- the Replication dashboard should show in system.replicas / system.replication_queue.
-- Run AFTER seed-replication.sql has created the table on both nodes.

INSERT INTO analytics.events_replicated
    (event_time, event_type, user_id, session_id, page_url, country, city, browser, os, device, duration_ms, bytes_sent, status_code)
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
FROM numbers(10000);

-- Force a few merges so the replication queue has GET/merge entries to show.
OPTIMIZE TABLE analytics.events_replicated FINAL;

SYSTEM FLUSH LOGS;
