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
