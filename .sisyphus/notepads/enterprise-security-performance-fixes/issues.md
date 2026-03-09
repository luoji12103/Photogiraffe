# Issues & Gotchas - Enterprise Security & Performance Fixes

This file tracks problems encountered and their solutions.

---

## [2026-03-09T13:31:20Z] Verification Environment Limitation
- Strong-secret startup test advanced past JWT validation and then failed at database connection due local service credentials/availability.
- This still verifies JWT gate behavior because no JWT validation error was emitted before DB initialization.
- `gopls` is not installed in this environment, so LSP diagnostics for changed Go files could not be executed.

## [2026-03-09T14:05:00Z] Task 2 Verification Limitations
- `golangci-lint` CLI is not available in this environment (`command not found`), so full lint execution could not be run locally despite config update.
- Targeted `lsp_diagnostics` for `go-core/main.go` is clean, but workspace-level diagnostics reports many pre-existing Python type issues unrelated to this task.
- Live endpoint verification (`curl /api/admin/stats`) was not executed because this session does not include a running local stack plus valid auth token.
