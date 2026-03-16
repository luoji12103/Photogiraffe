# System-Wide Validation - Decisions

## [2026-03-10T01:36:00Z] Execution Strategy

### Evidence Storage
- Path: `.sisyphus/evidence/system-validation/`
- Format: Markdown files with command outputs and timestamps
- Naming: `wave{N}-task{M}-{scenario}.md`

### Parallel Exploration
- Launched 5 background agents for Wave 1 intelligence gathering:
  1. Health/proxy codepath mapping (explore)
  2. Nginx 502 diagnostics references (librarian)
  3. Auth smoke test surface mapping (explore)
  4. Test command coverage gaps (explore)
- Rationale: Maximize search effort, gather comprehensive context before execution

### Verification Policy
- Every task requires automated + manual verification
- Automated: lsp_diagnostics, build, test suite
- Manual: Read every changed file, verify logic matches requirements
- No task marked complete without both verification types passing

## [2026-03-14] Task 6A Implementation Strategy

### Approach
- Minimal changes to existing `http()` helper
- Extract CSRF token from response headers or JSON body
- Store in global variable for reuse across tests
- Inject into all POST/PUT/DELETE requests

### Design Decisions
- Use global `csrf_token` variable (simplest for existing test structure)
- Extract from `csrf_token` field in auth responses
- Fallback: call `GET /api/auth/csrf-token` if needed
- No retry logic initially (add if tests show token expiration issues)
