package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var (
	HTTPRequestsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "cl_http_requests_total",
		Help: "Total number of HTTP requests",
	}, []string{"method", "path", "status"})

	HTTPRequestDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "cl_http_request_duration_seconds",
		Help:    "HTTP request duration in seconds",
		Buckets: prometheus.DefBuckets,
	}, []string{"method", "path"})

	PoolConnections = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "cl_pool_connections",
		Help: "Current number of cached ClickHouse connections",
	})

	PoolEvictions = promauto.NewCounter(prometheus.CounterOpts{
		Name: "cl_pool_evictions_total",
		Help: "Total number of connection pool evictions",
	})
)
