//go:build !noembed

package main

import (
	"embed"
	"io/fs"
)

// frontendEmbed holds the compiled frontend (web/dist → cmd/server/frontend/).
// It is embedded at compile time, so the directory must exist when building
// in the default (production) configuration. See the Makefile build-frontend
// target, which populates it before build-backend.
//
//go:embed all:frontend
var frontendEmbed embed.FS

func getFrontendFS() fs.FS {
	sub, _ := fs.Sub(frontendEmbed, "frontend")
	return sub
}
