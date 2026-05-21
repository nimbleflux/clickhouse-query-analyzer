FROM node:22-alpine AS frontend
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM golang:1.26-alpine AS backend
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY cmd/ cmd/
COPY internal/ internal/
COPY --from=frontend /app/web/dist cmd/server/frontend/
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /analyzer ./cmd/server

FROM alpine:3.21
RUN apk add --no-cache ca-certificates tzdata
COPY --from=backend /analyzer /usr/local/bin/analyzer
EXPOSE 8080
ENTRYPOINT ["analyzer"]
