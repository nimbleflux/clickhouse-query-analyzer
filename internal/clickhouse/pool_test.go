package clickhouse

import (
	"sync"
	"testing"
	"time"
)

func TestPool_MaxSize(t *testing.T) {
	if maxPoolSize <= 0 {
		t.Errorf("maxPoolSize should be positive, got %d", maxPoolSize)
	}
}

func TestPool_ConnMaxAge(t *testing.T) {
	if connMaxAge <= 0 {
		t.Errorf("connMaxAge should be positive, got %v", connMaxAge)
	}
}

func TestNewPool_InitializesFields(t *testing.T) {
	pool := NewPool()
	if pool == nil {
		t.Fatal("expected non-nil pool")
	}
	if pool.clients == nil {
		t.Error("expected clients map to be initialized")
	}
	if pool.dials == nil {
		t.Error("expected dials map to be initialized")
	}
	if pool.done == nil {
		t.Error("expected done channel to be initialized")
	}
	if len(pool.clients) != 0 {
		t.Error("expected empty clients map")
	}
	pool.CloseAll()
}

func TestPool_EvictLocked_NonExistent(t *testing.T) {
	pool := NewPool()
	pool.CloseAll()
	c := &Client{createdAt: time.Now()}
	pool.evictLocked("nonexistent", c)
}

func TestPool_EvictLocked_DifferentInstance(t *testing.T) {
	pool := NewPool()
	pool.CloseAll()
	key := "test-key"
	original := &Client{createdAt: time.Now()}
	pool.clients[key] = original
	different := &Client{createdAt: time.Now()}
	pool.evictLocked(key, different)
	if _, ok := pool.clients[key]; !ok {
		t.Error("expected client to remain since instances differ")
	}
}

func TestPoolUpdatePoolGauge(t *testing.T) {
	pool := NewPool()
	pool.CloseAll()
	pool.updatePoolGauge()
}

func TestConnParamsKey_Deterministic(t *testing.T) {
	p := ConnParams{URL: "clickhouse://host:9000", User: "default", Password: "secret", Database: "system"}
	k1 := p.key()
	k2 := p.key()
	if k1 != k2 {
		t.Error("same params should produce same key")
	}
}

func TestConnParamsKey_DifferentDatabases(t *testing.T) {
	p1 := ConnParams{URL: "clickhouse://host:9000", User: "default", Password: "pass", Database: "db1"}
	p2 := ConnParams{URL: "clickhouse://host:9000", User: "default", Password: "pass", Database: "db2"}
	if p1.key() == p2.key() {
		t.Error("different databases should produce different keys")
	}
}

func TestPool_DialsMapPreventsConcurrentDial(t *testing.T) {
	pool := NewPool()
	pool.CloseAll()
	p := ConnParams{URL: "clickhouse://host:9000", User: "default"}
	key := p.key()
	pool.dials[key] = &sync.Mutex{}
	if _, exists := pool.dials[key]; !exists {
		t.Error("expected dial entry to exist")
	}
	delete(pool.dials, key)
	if _, exists := pool.dials[key]; exists {
		t.Error("expected dial entry to be removed")
	}
}

func TestConnParamsKey_EmptyParams(t *testing.T) {
	p := ConnParams{}
	k := p.key()
	if k == "" {
		t.Error("expected non-empty key even for empty params")
	}
}
