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
	"sync/atomic"
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
	// from the Query Editor goes through the same driver connection, so
	// executeQueryNative explicitly overrides log_comment per query (see
	// ExecuteOptions.LogComment) — otherwise the connection default here
	// would tag editor queries as internal and hide them from the history.
	managedLogComment = "clicklens"
)

type Client struct {
	conn             driver.Conn
	httpClient       *http.Client
	connURL          string
	connUser         string
	connPass         string
	connDB           string
	skipTLS          bool
	isHTTP           bool
	isCluster        bool
	cluster          string
	clusterDetectErr error
	// version is detected once at connect (see detectVersion) and treated as
	// immutable afterwards, so reads need no synchronization. Empty string
	// means detection failed or hasn't run; callers should check versionErr.
	version    string
	versionErr error
	// serverTimezone is the ClickHouse server's IANA zone name (timezone()),
	// detected once at connect. Empty when detection failed. The frontend
	// uses it to convert server-wall-clock timestamps for display.
	serverTimezone string
	// advisor caches the remote-engine table list for the editor advisor.
	// Initialized in connect() so concurrent editor runs never race on the
	// pointer; its contents are guarded by advisor.mu internally.
	advisor *advisorCache
	// queryLogFallback tracks that the full system.query_log is access-denied
	// for this user and reads should use system.user_query_log (26.8+),
	// which holds only the connecting user's queries. queryLogDenied records
	// that the flip was attempted (so the probe runs once).
	queryLogFallback atomic.Bool
	queryLogDenied   atomic.Bool
	createdAt        time.Time
	// lastUsed is unix-nano, atomic because Get() writes it on every hit
	// while the LRU eviction scan in connect() reads it under p.mu.
	lastUsed atomic.Int64
}

type ConnParams struct {
	URL      string
	User     string
	Password string
	Database string
	SkipTLS  bool
	// NOTE: there is deliberately no connection-level Readonly flag —
	// read-only enforcement lives in the API layer (X-CH-Readonly header +
	// rejectWriteQuery) because it is per-request, not per-connection, in
	// this pool. Real enforcement is a read-only ClickHouse user.
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
			c.touch()
			return c, nil
		}
		p.evict(key, c)
	}

	return p.connect(ctx, params, key)
}

// touch records pool-level last use (LRU ordering only; not query tracking).
func (c *Client) touch() {
	c.lastUsed.Store(time.Now().UnixNano())
}

// idleFor reports how long since the client was last handed out by Get().
func (c *Client) idleFor() time.Duration {
	if ts := c.lastUsed.Load(); ts > 0 {
		return time.Since(time.Unix(0, ts))
	}
	return time.Since(c.createdAt)
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
	// Snapshot under RLock and ping outside the lock: a slow node (5s ping
	// timeout) must not block Get() for every other tenant of the pool.
	p.mu.RLock()
	snapshot := make(map[string]*Client, len(p.clients))
	for key, c := range p.clients {
		snapshot[key] = c
	}
	p.mu.RUnlock()

	for key, c := range snapshot {
		if time.Since(c.createdAt) >= connMaxAge {
			slog.Info("evicting expired connection", "url", redactURL(c.connURL))
			p.evict(key, c)
			continue
		}
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		if err := c.conn.Ping(ctx); err != nil {
			slog.Warn("evicting unhealthy connection", "url", redactURL(c.connURL), "error", err)
			p.evict(key, c)
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
	return scheme == "https" || scheme == "clickhouses"
}

// redactURL strips userinfo from a connection URL before it reaches the
// logs. Users occasionally paste `clickhouse://user:password@host:9000`;
// without this the password would end up in plaintext server logs.
func redactURL(rawURL string) string {
	u, err := url.Parse(rawURL)
	if err != nil || u.User == nil {
		return rawURL
	}
	u.User = url.User(u.User.Username())
	return u.String()
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
			MaxOpenConns:     10,
			MaxIdleConns:     10,
			ConnMaxLifetime:  time.Hour,
			ConnOpenStrategy: ch.ConnOpenInOrder,
			BlockBufferSize:  10,
			// LZ4 on the wire: system-table result sets (query_log pages,
			// trace rows) shrink several-fold for negligible CPU cost.
			Compression: &ch.Compression{Method: ch.CompressionLZ4},
			Settings:    ch.Settings{"log_comment": managedLogComment},
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
			c.touch()
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

	isCluster, cluster, clusterErr := detectCluster(ctx, conn)
	version, versionErr := detectVersion(ctx, conn)
	tz := detectTimezone(ctx, conn)

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
		conn:             conn,
		httpClient:       httpCl,
		connURL:          params.URL,
		connUser:         params.User,
		connPass:         params.Password,
		connDB:           params.Database,
		skipTLS:          params.SkipTLS,
		isHTTP:           isHTTPScheme(scheme),
		isCluster:        isCluster,
		cluster:          cluster,
		clusterDetectErr: clusterErr,
		version:          version,
		versionErr:       versionErr,
		serverTimezone:   tz,
		advisor:          &advisorCache{},
		createdAt:        time.Now(),
	}
	c.touch()

	p.mu.Lock()
	// Pool full: evict the least-recently-used client, preferring one that
	// has been idle for a while — closing a connection that some request is
	// actively querying fails that query mid-flight. The idle threshold
	// keeps eviction from stalling entirely on a fully-hot pool.
	const idleEvictThreshold = time.Minute
	var oldestKey string
	var oldestURL string
	var maxIdle time.Duration
	for k, v := range p.clients {
		if idle := v.idleFor(); idle >= idleEvictThreshold && idle > maxIdle {
			oldestKey, oldestURL, maxIdle = k, v.connURL, idle
		}
	}
	if oldestKey == "" {
		// Everything is hot: fall back to strict LRU by last use.
		for k, v := range p.clients {
			if idle := v.idleFor(); idle > maxIdle {
				oldestKey, oldestURL, maxIdle = k, v.connURL, idle
			}
		}
	}
	if oldestKey != "" {
		slog.Info("evicting connection to make room", "url", redactURL(oldestURL), "idle", maxIdle.Round(time.Second))
		if old, ok := p.clients[oldestKey]; ok {
			old.conn.Close()
			delete(p.clients, oldestKey)
			metrics.PoolEvictions.Inc()
		}
	}
	p.clients[key] = c
	p.mu.Unlock()
	p.updatePoolGauge()

	slog.Info("connected to clickhouse", "url", redactURL(params.URL), "user", params.User, "cluster", isCluster)
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

// ClusterDetectErr returns the error from cluster detection, if any. Non-nil
// only when the system.clusters query itself failed (access denied / table
// absent) — NOT when the cluster simply has no entries.
func (c *Client) ClusterDetectErr() error {
	return c.clusterDetectErr
}

// Version returns the cached server version string (e.g. "26.7.2.59"),
// detected once at connect time. Returns "" if detection failed — check
// VersionErr for the cause. Safe for concurrent reads: the field is written
// once during connect and read-only afterwards.
func (c *Client) Version() string {
	return c.version
}

// VersionErr returns the error from version detection, if any. Non-nil only
// when the SELECT version() query itself failed at connect.
func (c *Client) VersionErr() error {
	return c.versionErr
}

// ClusterNote returns a human explanation when cluster-wide queries couldn't
// be set up, or "" otherwise. Centralized so every page reports the same
// message instead of each re-deriving it.
func (c *Client) ClusterNote() string {
	if c.clusterDetectErr == nil {
		return ""
	}
	return "Showing the local node only — cluster-wide queries are unavailable. Your ClickHouse user may lack SELECT access to system.clusters."
}

func (c *Client) TableRef(table string) string {
	return c.tableRef(table)
}

func (c *Client) tableRef(table string) string {
	if c.isCluster {
		// quoteStr handles quotes/backslashes in odd cluster names — a
		// broken name would otherwise corrupt every cluster-wide query.
		return fmt.Sprintf("clusterAllReplicas(%s, system.%s)", quoteStr(c.cluster), table)
	}
	return fmt.Sprintf("system.%s", table)
}

func detectCluster(ctx context.Context, conn driver.Conn) (bool, string, error) {
	rows, err := conn.Query(ctx, "SELECT cluster FROM system.clusters LIMIT 1")
	if err != nil {
		// Query failed (access denied / table absent) — distinct from a
		// cluster that simply has no entries, which returns no error below.
		return false, "", err
	}
	defer rows.Close()

	if rows.Next() {
		var cluster string
		if err := rows.Scan(&cluster); err != nil {
			return false, "", err
		}
		// system.clusters can name clusters that aren't actually usable
		// (stale configs, single-node docker images ship sample entries).
		// Validate with a cheap fan-out probe before committing to
		// cluster-wide queries everywhere; failure degrades to local-node.
		probeCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
		defer cancel()
		probe, probeErr := conn.Query(probeCtx, fmt.Sprintf("SELECT 1 FROM clusterAllReplicas(%s, system.one) LIMIT 1", quoteStr(cluster)))
		if probeErr != nil {
			return false, "", fmt.Errorf("cluster %q unusable (%w) — using the local node", cluster, probeErr)
		}
		probe.Close()
		return true, cluster, nil
	}
	return false, "", nil
}

// detectVersion reads the server version once at connect time so feature
// gates (e.g. EXPLAIN ANALYZE, available 26.7+) don't re-query version() on
// every invocation. The result is cached on the Client and never changes for
// the life of the connection.
func detectVersion(ctx context.Context, conn driver.Conn) (string, error) {
	var version string
	if err := conn.QueryRow(ctx, "SELECT version()").Scan(&version); err != nil {
		return "", err
	}
	return version, nil
}

// detectTimezone reads the server's IANA zone name once at connect. Best
// effort: an empty result just means the UI shows timestamps as stored.
func detectTimezone(ctx context.Context, conn driver.Conn) string {
	var tz string
	if err := conn.QueryRow(ctx, "SELECT timezone()").Scan(&tz); err != nil {
		return ""
	}
	return tz
}

// ServerTimezone returns the server's IANA timezone name ("" if detection
// failed at connect). Safe for concurrent reads: written once at connect.
func (c *Client) ServerTimezone(_ context.Context) string {
	return c.serverTimezone
}

func mustPort(port string) int {
	var p int
	if _, err := fmt.Sscanf(port, "%d", &p); err != nil {
		return 9000
	}
	return p
}
