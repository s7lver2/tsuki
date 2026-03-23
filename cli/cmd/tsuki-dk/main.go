// ─────────────────────────────────────────────────────────────────────────────
//  tsuki-dk — Tsuki Development Kit
//
//  Install:
//    tsuki install tsuki-team/tsuki-dk
//
//  Or build from source:
//    cd cli && go build -o tsuki-dk ./cmd/tsuki-dk
// ─────────────────────────────────────────────────────────────────────────────

package main

import (
	"os"

	"github.com/tsuki/cli/internal/dk"
)

func main() {
	if err := dk.Execute(); err != nil {
		os.Exit(1)
	}
}