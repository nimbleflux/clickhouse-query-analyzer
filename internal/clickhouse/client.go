package clickhouse

import (
	"context"
	"crypto/sha256"
	"crypto/tls"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	ch "github.com/ClickHouse/clickhouse-go/v2"
	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"
	"github.com/nimbleflux/clickhouse-query-analyzer/internal/metrics"
)

const (
	maxPoolSize    = 50
	connMaxAge     = 1 * time.Hour
	healthCheckInt = 30 * time.Second

	// managedLogComment is stamped into the log_comment setting of every query
	// ClickLens issues itself (introspection, health checks, etc.). It lets the
	// Queries and Fingerprints pages filter out ClickLens's own queries so the
	// user only sees the queries they consciously executed. User-submitted SQL
	// from the Query Editor bypasses the driver and is therefore not tagged.
	managedLogComment = "clicklens"
)

type Client struct {
	conn       driver.Conn
	httpClient *http.Client
	connURL    string
	connUser   string
	connPass   string
	connDB     string
	skipTLS    bool
	isHTTP     bool
	isCluster  bool
	cluster    string
	createdAt  time.Time
	lastUsedAt time.Time
}

type ConnParams struct {
	URL      string
	User     string
	Password string
	Database string
	SkipTLS  bool
	Readonly bool
}

func (p ConnParams) key() string {
	h := sha256.Sum256([]byte(p.Password))
	return fmt.Sprintf("%s|%s|%s|%v|%.16x", p.URL, p.User, p.Database, p.SkipTLS, h)
}

type Pool struct {
	mu      sync.RWMutex
	clients map[string]*Client
	dials   map[string]*sync.Mutex
	done    chan struct{}
}

func NewPool() *Pool {
	p := &Pool{
		clients: make(map[string]*Client),
		dials:   make(map[string]*sync.Mutex),
		done:    make(chan struct{}),
	}
	go p.healthLoop()
	return p
}

func (p *Pool) updatePoolGauge() {
	metrics.PoolConnections.Set(float64(len(p.clients)))
}

func (p *Pool) Get(ctx context.Context, params ConnParams) (*Client, error) {
	key := params.key()

	p.mu.RLock()
	c, ok := p.clients[key]
	p.mu.RUnlock()

	if ok {
		if time.Since(c.createdAt) < connMaxAge {
			c.lastUsedAt = time.Now()
			return c, nil
		}
		p.evict(key, c)
	}

	return p.connect(ctx, params, key)
}

func (p *Pool) healthLoop() {
	ticker := time.NewTicker(healthCheckInt)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			p.checkHealth()
		case <-p.done:
			return
		}
	}
}

func (p *Pool) checkHealth() {
	p.mu.Lock()
	defer p.mu.Unlock()

	for key, c := range p.clients {
		if time.Since(c.createdAt) >= connMaxAge {
			slog.Info("evicting expired connection", "url", c.connURL)
			p.evictLocked(key, c)
			continue
		}
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		if err := c.conn.Ping(ctx); err != nil {
			slog.Warn("evicting unhealthy connection", "url", c.connURL, "error", err)
			p.evictLocked(key, c)
		}
		cancel()
	}
}

func (p *Pool) evict(key string, c *Client) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.evictLocked(key, c)
}

func (p *Pool) evictLocked(key string, c *Client) {
	if existing, ok := p.clients[key]; ok && existing == c {
		delete(p.clients, key)
		c.conn.Close()
		metrics.PoolEvictions.Inc()
		p.updatePoolGauge()
	}
}

func isHTTPScheme(scheme string) bool {
	return scheme == "http" || scheme == "https"
}

func isNativeScheme(scheme string) bool {
	return scheme == "clickhouse" || scheme == "clickhouses" || scheme == ""
}

func isTLSScheme(scheme string) bool {
	return scheme == "https" || scheme == "clickhouses" || strings.HasSuffix(scheme, "s")
}

func (p *Pool) getDialMutex(key string) *sync.Mutex {
	p.mu.Lock()
	defer p.mu.Unlock()
	if m, ok := p.dials[key]; ok {
		return m
	}
	m := &sync.Mutex{}
	p.dials[key] = m
	return m
}

// buildOptions translates connection parameters into clickhouse-go driver
// options. It is split out of connect() so the connection-level settings
// (notably the log_comment tag that identifies ClickLens's own queries) can be
// unit-tested without dialing a real server.
func buildOptions(parsedURL *url.URL, params ConnParams) *ch.Options {
	scheme := strings.ToLower(parsedURL.Scheme)
	useTLS := isTLSScheme(scheme)

	var opts *ch.Options
	if isHTTPScheme(scheme) {
		opts = &ch.Options{
			Protocol:    ch.HTTP,
			Addr:        []string{parsedURL.Host},
			Auth:        ch.Auth{Username: params.User, Password: params.Password, Database: params.Database},
			DialTimeout: time.Second * 10,
			Settings:    ch.Settings{"log_comment": managedLogComment},
		}
	} else {
		host := parsedURL.Hostname()
		port := parsedURL.Port()
		if port == "" {
			if useTLS {
				port = "9440"
			} else {
				port = "9000"
			}
		}
		chPort := mustPort(port)

		opts = &ch.Options{
			Protocol:         ch.Native,
			Addr:             []string{fmt.Sprintf("%s:%d", host, chPort)},
			Auth:             ch.Auth{Username: params.User, Password: params.Password, Database: params.Database},
			DialTimeout:      time.Second * 10,
			MaxOpenConns:     5,
			MaxIdleConns:     5,
			ConnMaxLifetime:  time.Hour,
			ConnOpenStrategy: ch.ConnOpenInOrder,
			BlockBufferSize:  10,
			Settings:         ch.Settings{"log_comment": managedLogComment},
		}
	}

	if useTLS {
		opts.TLS = &tls.Config{MinVersion: tls.VersionTLS12, InsecureSkipVerify: params.SkipTLS}
	}
	return opts
}

func (p *Pool) connect(ctx context.Context, params ConnParams, key string) (*Client, error) {
	dialMu := p.getDialMutex(key)
	dialMu.Lock()
	defer dialMu.Unlock()

	p.mu.RLock()
	c, ok := p.clients[key]
	p.mu.RUnlock()
	if ok {
		if time.Since(c.createdAt) < connMaxAge {
			c.lastUsedAt = time.Now()
			return c, nil
		}
		p.evict(key, c)
	}

	parsedURL, err := url.Parse(params.URL)
	if err != nil {
		return nil, fmt.Errorf("parsing clickhouse URL: %w", err)
	}

	scheme := strings.ToLower(parsedURL.Scheme)
	opts := buildOptions(parsedURL, params)

	conn, err := ch.Open(opts)
	if err != nil {
		return nil, fmt.Errorf("connecting to clickhouse: %w", err)
	}

	if err := conn.Ping(ctx); err != nil {
		conn.Close()
		return nil, fmt.Errorf("pinging clickhouse: %w", err)
	}

	isCluster, cluster := detectCluster(ctx, conn)

	var httpCl *http.Client
	if params.SkipTLS {
		httpCl = &http.Client{
			Transport: &http.Transport{
				TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
			},
		}
	} else {
		httpCl = &http.Client{}
	}

	c = &Client{
		conn:       conn,
		httpClient: httpCl,
		connURL:    params.URL,
		connUser:   params.User,
		connPass:   params.Password,
		connDB:     params.Database,
		skipTLS:    params.SkipTLS,
		isHTTP:     isHTTPScheme(scheme),
		isCluster:  isCluster,
		cluster:    cluster,
		createdAt:  time.Now(),
		lastUsedAt: time.Now(),
	}

	p.mu.Lock()
	if len(p.clients) >= maxPoolSize {
		var oldestKey string
		var oldestURL string
		var oldestTime time.Time
		for k, v := range p.clients {
			if oldestKey == "" || v.lastUsedAt.Before(oldestTime) {
				oldestKey = k
				oldestURL = v.connURL
				oldestTime = v.lastUsedAt
			}
		}
		if oldestKey != "" {
			slog.Info("evicting oldest connection to make room", "url", oldestURL)
			if old, ok := p.clients[oldestKey]; ok {
				old.conn.Close()
				delete(p.clients, oldestKey)
				metrics.PoolEvictions.Inc()
			}
		}
	}
	p.clients[key] = c
	p.mu.Unlock()
	p.updatePoolGauge()

	slog.Info("connected to clickhouse", "url", params.URL, "user", params.User, "cluster", isCluster)
	return c, nil
}

func (p *Pool) CloseAll() {
	close(p.done)
	p.mu.Lock()
	defer p.mu.Unlock()
	for _, c := range p.clients {
		c.conn.Close()
	}
	p.clients = make(map[string]*Client)
}

func (c *Client) Close() error {
	return c.conn.Close()
}

func (c *Client) Conn() driver.Conn {
	return c.conn
}

func (c *Client) IsCluster() bool {
	return c.isCluster
}

func (c *Client) Cluster() string {
	return c.cluster
}

func (c *Client) TableRef(table string) string {
	return c.tableRef(table)
}

func (c *Client) tableRef(table string) string {
	if c.isCluster {
		return fmt.Sprintf("clusterAllReplicas('%s', system.%s)", c.cluster, table)
	}
	return fmt.Sprintf("system.%s", table)
}

func detectCluster(ctx context.Context, conn driver.Conn) (bool, string) {
	rows, err := conn.Query(ctx, "SELECT cluster FROM system.clusters LIMIT 1")
	if err != nil {
		return false, ""
	}
	defer rows.Close()

	if rows.Next() {
		var cluster string
		if err := rows.Scan(&cluster); err != nil {
			return false, ""
		}
		return true, cluster
	}
	return false, ""
}

func mustPort(port string) int {
	var p int
	if _, err := fmt.Sscanf(port, "%d", &p); err != nil {
		return 9000
	}
	return p
}
