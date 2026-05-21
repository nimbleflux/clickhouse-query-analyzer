.PHONY: dev dev-backend dev-frontend build clean docker dev-clickhouse seed

BINARY := clickhouse-query-analyzer

dev: dev-clickhouse-wait dev-frontend dev-backend

dev-frontend:
	cd web && npm ci --quiet 2>/dev/null; npm run dev &

dev-backend:
	mkdir -p cmd/server/frontend
	go run ./cmd/server -dev -port 8080

dev-clickhouse:
	cd dev && docker compose up -d

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
	CGO_ENABLED=0 go build -ldflags="-s -w" -o $(BINARY) ./cmd/server

clean:
	rm -rf $(BINARY) cmd/server/frontend web/dist

docker:
	docker build -t clickhouse-query-analyzer .

seed:
	@for i in $$(seq 1 30); do \
		if docker exec dev-clickhouse-1 clickhouse-client --query "SELECT 1" >/dev/null 2>&1; then \
			break; \
		fi; \
		sleep 1; \
	done
	docker exec -i dev-clickhouse-1 clickhouse-client < dev/seed.sql
