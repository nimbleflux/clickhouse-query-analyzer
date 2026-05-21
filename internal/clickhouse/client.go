package clickhouse

import (
	"context"
	"crypto/tls"
	"fmt"
	"net/url"
	"strings"
	"sync"
	"time"

	ch "github.com/ClickHouse/clickhouse-go/v2"
	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"
)

type Client struct {
	conn      driver.Conn
	connURL   string
	connUser  string
	connPass  string
	skipTLS   bool
	isHTTP    bool
	isCluster bool
	cluster   string
}

type ConnParams struct {
	URL      string
	User     string
	Password string
	Database string
	SkipTLS  bool
}

func (p ConnParams) key() string {
	return fmt.Sprintf("%s|%s|%s|%v", p.URL, p.User, p.Database, p.SkipTLS)
}

type Pool struct {
	mu      sync.RWMutex
	clients map[string]*Client
}

func NewPool() *Pool {
	return &Pool{clients: make(map[string]*Client)}
}

func (p *Pool) Get(ctx context.Context, params ConnParams) (*Client, error) {
	key := params.key()

	p.mu.RLock()
	c, ok := p.clients[key]
	p.mu.RUnlock()

	if ok {
		return c, nil
	}

	return p.connect(ctx, params, key)
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

func (p *Pool) connect(ctx context.Context, params ConnParams, key string) (*Client, error) {
	parsedURL, err := url.Parse(params.URL)
	if err != nil {
		return nil, fmt.Errorf("parsing clickhouse URL: %w", err)
	}

	scheme := strings.ToLower(parsedURL.Scheme)
	useTLS := isTLSScheme(scheme)

	var opts *ch.Options

	if isHTTPScheme(scheme) {
		opts = &ch.Options{
			Protocol:  ch.HTTP,
			Addr:      []string{parsedURL.Host},
			Auth:      ch.Auth{Username: params.User, Password: params.Password, Database: params.Database},
			DialTimeout: time.Second * 10,
		}
		if useTLS {
			opts.TLS = &tls.Config{MinVersion: tls.VersionTLS12, InsecureSkipVerify: params.SkipTLS}
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
			Protocol:  ch.Native,
			Addr:      []string{fmt.Sprintf("%s:%d", host, chPort)},
			Auth:      ch.Auth{Username: params.User, Password: params.Password, Database: params.Database},
			DialTimeout:      time.Second * 10,
			MaxOpenConns:     5,
			MaxIdleConns:     5,
			ConnMaxLifetime:  time.Hour,
			ConnOpenStrategy: ch.ConnOpenInOrder,
			BlockBufferSize:  10,
		}
		if useTLS {
			opts.TLS = &tls.Config{MinVersion: tls.VersionTLS12, InsecureSkipVerify: params.SkipTLS}
		}
	}

	conn, err := ch.Open(opts)
	if err != nil {
		return nil, fmt.Errorf("connecting to clickhouse: %w", err)
	}

	if err := conn.Ping(ctx); err != nil {
		return nil, fmt.Errorf("pinging clickhouse: %w", err)
	}

	isCluster, cluster := detectCluster(ctx, conn)

	c := &Client{
		conn:      conn,
		connURL:   params.URL,
		connUser:  params.User,
		connPass:  params.Password,
		skipTLS:   params.SkipTLS,
		isHTTP:    isHTTPScheme(scheme),
		isCluster: isCluster,
		cluster:   cluster,
	}

	p.mu.Lock()
	p.clients[key] = c
	p.mu.Unlock()

	return c, nil
}

func (p *Pool) CloseAll() {
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
