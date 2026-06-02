.PHONY: dev dev-backend dev-frontend build clean docker dev-clickhouse seed test test-unit test-integration lint vulncheck fmt-check tidy-check

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
	cd web && npm ci --quiet 2>/dev/null; npm run dev

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
