# ClickLens

A single-binary tool with a built-in web UI to analyze ClickHouse query executions. Connect to any ClickHouse instance, explore query logs, drill into CPU/memory/IO usage per thread, view flame graphs, compare queries side by side, and run ad-hoc SQL.

## Features

- **System Dashboard** — Overview of uptime, active queries/merges/parts, database sizes, top tables by size and part count, system metrics and events. Replica status and replication queue for clusters.
- **Query List** — Browse, filter, sort, and paginate through `system.query_log` including failed queries
- **Query Detail** — Overview with RAM/CPU/IO time-series charts, top ProfileEvents, thread breakdown with role inference, memory analysis, storage I/O stats, and settings
- **Flame Graphs** — Canvas-based flame graphs from `system.trace_log` (Memory/MemorySample/MemoryPeak/CPU/Real) with auto-detection of available trace types
- **Visual EXPLAIN** — Interactive collapsible tree view of the execution plan, plus raw pipeline and syntax views
- **Thread Breakdown** — Per-thread role inference (Coordinator, Scan+Filter, Aggregator, I/O Pool), pipeline visualization from EXPLAIN PIPELINE, top DB functions from trace data
- **Query Fingerprints** — Group queries by `normalized_query_hash`, view aggregated stats (count, avg/P50/P95 latency, memory, I/O), drill into per-fingerprint performance trends over time
- **Running Queries** — Live view of `system.processes` with auto-refresh, kill query support
- **SQL Editor** — CodeMirror 6 editor with schema browser sidebar, column type display, copy-on-hover cells, and "View Analysis" link to jump to profiling data
- **Saved Queries** — Save, load, search, import, and export queries. Saved queries are stored in browser localStorage and organized in an accordion sidebar panel.
- **Parameterized Queries** — Use `{{param_name}}` syntax in any query to define parameters. Parameter input fields appear automatically in the sidebar. Values are substituted at execution time. Escape with `\{{` for literal `{{`.
- **Query Comparison** — Side-by-side diff of two queries including ProfileEvents metrics
- **Cluster Support** — Auto-detects `system.clusters`, uses `clusterAllReplicas`
- **Table Optimizer** — Analyze single tables, entire databases, or all databases for ClickHouse optimization opportunities including LowCardinality, integer right-sizing, Nullable removal, ORDER BY/PARTITION BY suggestions, skipping indices, codec recommendations, and table health checks. Generates copy-ready ALTER TABLE DDL. Bulk analysis streams results in real-time via SSE.

## Screenshots

### System Dashboard
![System Dashboard](docs/screenshot-dashboard.png)

### Query Detail
![Query Detail](docs/screenshot-query-detail.png)

### Query Fingerprints
![Query Fingerprints](docs/screenshot-fingerprint.png)

### SQL Editor
![SQL Editor](docs/screenshot-editor.png)

### Query Comparison
![Query Comparison](docs/screenshot-compare.png)

### Table Optimizer
![Table Optimizer](docs/screenshot-table-optimizer.png)

## Quick Start

### Docker

```bash
docker pull ghcr.io/nimbleflux/clickhouse-query-analyzer:latest
docker run -p 8080:8080 ghcr.io/nimbleflux/clickhouse-query-analyzer:latest
```

Open http://localhost:8080 and enter your ClickHouse connection details in the top bar.

### Binary

Download from [Releases](https://github.com/nimbleflux/clickhouse-query-analyzer/releases) for your platform:

```bash
# Linux/macOS
chmod +x clickhouse-query-analyzer-*
./clickhouse-query-analyzer-linux-amd64 -port 8080
```

### Build from Source

```bash
make build
./clickhouse-query-analyzer
```

## Connection

The tool connects to ClickHouse via the browser — no ClickHouse credentials are stored server-side. Supported URL schemes:

| Scheme | Protocol | TLS |
|--------|----------|-----|
| `clickhouse://host:9000` | Native TCP | No |
| `clickhouses://host:9440` | Native TCP | Yes |
| `http://host:8123` | HTTP API | No |
| `https://host:8443` | HTTP API | Yes |

For self-signed certificates, check "Skip TLS verify" in the connection bar.

### TLS Certificates for ClickHouse Connections

ClickLens connects to ClickHouse from the browser, so TLS certificates must be trusted by the **client browser** (or the system running the browser), not by the ClickLens server.

- **Trusted CA** — If ClickHouse uses a certificate from a public CA (e.g. Let's Encrypt), no extra steps are needed.
- **Internal / self-signed CA** — Install the CA certificate on each machine running the browser:
  - **macOS**: Add to Keychain → System keychain → set to "Always Trust"
  - **Linux**: Copy to `/usr/local/share/ca-certificates/` and run `sudo update-ca-certificates`
  - **Windows**: Import into "Trusted Root Certification Authorities" via certmgr.msc
- **Skip TLS verify** — For development or air-gapped environments, check "Skip TLS verify" in the connection bar. This disables certificate validation for that connection.
- **Docker** — When running ClickLens behind a reverse proxy (nginx, Caddy, Traefik) that terminates TLS, mount the certificate and key into the proxy container. Example for nginx:

  ```yaml
  services:
    clicklens:
      image: ghcr.io/nimbleflux/clickhouse-query-analyzer:latest
      ports:
        - "8080:8080"
    nginx:
      image: nginx:alpine
      ports:
        - "443:443"
      volumes:
        - ./nginx.conf:/etc/nginx/nginx.conf:ro
        - ./certs/tls.crt:/etc/nginx/tls.crt:ro
        - ./certs/tls.key:/etc/nginx/tls.key:ro
  ```

## Dev Environment

```bash
# Start ClickHouse with sample data
make dev-clickhouse
make seed

# Run with hot-reload frontend
make dev
```

The dev ClickHouse runs on ports 18123 (HTTP) and 19000 (native) to avoid conflicts with existing instances. Connect using `clickhouse://localhost:19000` or `http://localhost:18123`.

## Architecture

- **Backend**: Go with Chi router, `clickhouse-go/v2` driver (native + HTTP), stateless connection pool
- **Frontend**: React + TypeScript + Vite + Tailwind CSS + Recharts + CodeMirror 6
- **Single binary**: Frontend embedded via `//go:embed`, served as static files
- **Stateless**: Connection params sent via `X-CH-*` headers per request, backend pools connections keyed by URL+user+db

## License

MIT
