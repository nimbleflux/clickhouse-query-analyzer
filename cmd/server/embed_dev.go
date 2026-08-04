//go:build noembed

package main

import (
	"io/fs"
	"os"
	"path/filepath"
)

// Dev-only frontend FS: serves files from web/dist on disk if present, else
// an empty FS. This avoids embedding the 38 MB of build output into every
// `go run` during development. Dev mode (-dev) never reads it anyway — the
// router reverse-proxies to the Vite dev server — but getFrontendFS() must
// still compile and return a non-nil fs.FS.
//
// Build with: go run -tags noembed ./cmd/server -dev -port 8080
type devFrontendFS struct {
	root string
	fsys fs.FS
}

func newDevFrontendFS() *devFrontendFS {
	// Resolve once, relative to the binary's working directory (repo root).
	for _, candidate := range []string{"web/dist", "../web/dist"} {
		if abs, err := filepath.Abs(candidate); err == nil {
			if _, err := os.Stat(filepath.Join(abs, "index.html")); err == nil {
				fsys := os.DirFS(abs)
				return &devFrontendFS{root: abs, fsys: fsys}
			}
		}
	}
	return &devFrontendFS{fsys: emptyFS{}}
}

func (d *devFrontendFS) Open(name string) (fs.File, error) {
	return d.fsys.Open(name)
}

// emptyFS is a no-content fallback for when web/dist doesn't exist.
type emptyFS struct{}

func (emptyFS) Open(string) (fs.File, error) { return nil, fs.ErrNotExist }

var devFrontend = newDevFrontendFS()

func getFrontendFS() fs.FS {
	return devFrontend
}
