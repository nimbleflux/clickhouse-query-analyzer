.PHONY: dev dev-backend dev-frontend build clean docker dev-clickhouse dev-clickhouse-repl dev-clickhouse-s3 seed seed-replication test test-unit test-integration lint vulncheck fmt-check tidy-check

BINARY := clickhouse-query-analyzer
VERSION := $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
LDFLAGS := -s -w -X main.version=$(VERSION)

dev:
	@trap 'kill 0 2>/dev/null; exit 0' INT TERM; \
	$(MAKE) dev-clickhouse-wait && \
	$(MAKE) dev-frontend & \
	$(MAKE) dev-backend & \
	wait

dev-frontend:
	# Only reinstall deps on a cold start; skip the multi-second npm ci on warm
	# runs. Tradeoff: this won't catch lockfile drift on warm starts — run
	# `npm ci` manually if node_modules looks stale. Note: this is a launch-speed
	# nit, not a steady-state CPU fix (Vite is the only long-running process here).
	@if [ ! -d web/node_modules ]; then cd web && npm ci --quiet 2>/dev/null; fi
	cd web && npm run dev

dev-backend:
	# -tags noembed skips embedding the 38 MB frontend build into the dev
	# binary (dev mode reverse-proxies to Vite and never serves the embed).
	# This makes each `go run` restart faster; it does not affect prod builds.
	go run -tags noembed ./cmd/server -dev -port 8080

dev-clickhouse:
	cd dev && docker compose up -d clickhouse

# S3 profile: MinIO + a ClickHouse node with the S3 storage disk, for the
# remote-table advisor and S3-engine demos. NOTE: MinIO's community images
# are no longer publicly pullable (Docker Hub repo deleted, quay.io repo
# auth-required since ~Sep 2026). This target works only if you already
# have the images locally or can authenticate against a registry serving
# them; the error below says so instead of failing cryptically.
dev-clickhouse-s3:
	@for img in quay.io/minio/minio:latest quay.io/minio/mc:latest; do \
		if ! docker image inspect "$$img" >/dev/null 2>&1; then \
			if ! docker pull "$$img" 2>/dev/null; then \
				echo "ERROR: $$img is not pullable."; \
				echo "MinIO removed its public images (Docker Hub repo deleted, quay.io now auth-required)."; \
				echo "Provide the image locally (docker load / your own registry mirror), then retry."; \
				exit 1; \
			fi; \
		fi; \
	done
	cd dev && COMPOSE_PROFILES=s3 docker compose up -d

# Replication demo stack: adds a 2nd ClickHouse node + Keeper. Use this before
# `make seed-replication` (which the target does automatically).
dev-clickhouse-repl:
	cd dev && COMPOSE_PROFILES=repl docker compose up -d

dev-clickhouse-wait: dev-clickhouse
	@echo "Waiting for ClickHouse to be ready..."
	@for i in $$(seq 1 30); do \
		if docker exec $$(cd dev && docker compose ps -q clickhouse) clickhouse-client --query "SELECT 1" >/dev/null 2>&1; then \
			echo "ClickHouse is ready."; \
			exit 0; \
		fi; \
		sleep 1; \
	done; \
	echo "ClickHouse did not become ready in time."; exit 1

build: build-frontend build-backend

build-frontend:
	cd web && npm ci && npm run build
	mkdir -p cmd/server/frontend
	cp -r web/dist/* cmd/server/frontend/

build-backend: build-frontend
	CGO_ENABLED=0 go build -ldflags="$(LDFLAGS)" -o $(BINARY) ./cmd/server

clean:
	rm -rf $(BINARY) cmd/server/frontend web/dist

docker:
	docker build --build-arg VERSION=$(VERSION) -t clickhouse-query-analyzer .

seed:
	@for i in $$(seq 1 30); do \
		if docker exec dev-clickhouse-1 clickhouse-client --query "SELECT 1" >/dev/null 2>&1; then \
			break; \
		fi; \
		sleep 1; \
	done
	docker exec -i dev-clickhouse-1 clickhouse-client < dev/seed.sql

seed-replication: dev-clickhouse-repl
	@for i in $$(seq 1 30); do \
		if docker exec dev-clickhouse-1 clickhouse-client --query "SELECT 1" >/dev/null 2>&1 && \
		   docker exec dev-clickhouse-2-1 clickhouse-client --query "SELECT 1" >/dev/null 2>&1; then \
			break; \
		fi; \
		sleep 1; \
	done
	@echo "Creating ReplicatedMergeTree table on both nodes..."
	docker exec -i dev-clickhouse-1 clickhouse-client < dev/seed-replication.sql
	docker exec -i dev-clickhouse-2-1 clickhouse-client < dev/seed-replication.sql
	@echo "Inserting on node 1 (replicates to node 2)..."
	docker exec -i dev-clickhouse-1 clickhouse-client < dev/seed-replication-data.sql
	@echo "Done. Open the Replication page to watch node 2 pull the parts."

test: test-unit

test-unit:
	go test -race -count=1 ./internal/...

test-integration:
	go test -race -count=1 -tags=integration ./tests/integration/...

lint:
	golangci-lint run ./...

vulncheck:
	govulncheck ./...

fmt-check:
	@test -z "$$(gofmt -l .)"

tidy-check:
	@go mod tidy && git diff --exit-code go.mod go.sum

coverage:
	go test -race -coverprofile=coverage.out ./internal/...
	go tool cover -html=coverage.out -o coverage.html
	@echo "Coverage report written to coverage.html"
