# System-Wide Validation - Problems

## [2026-03-10T01:36:00Z] Unresolved Issues

### P1: Nginx 502 on proxied health endpoint
- **Description**: Public health check via nginx fails with 502, but direct go-core access works
- **Blocking**: Wave 1 Task 1 completion
- **Investigation in progress**: Background agents gathering diagnostics

### P2: Test coverage gaps identified
- **Go**: No dedicated integration test entrypoint (separate from unit tests)
- **Python**: No unit test framework (pytest/unittest), only integration script
- **Frontend**: No unit or E2E test infrastructure
- **Impact**: Wave 3 test exhaustion tasks will need to work with existing infrastructure only
- **Decision**: Document gaps, do not add new test infrastructure (out of scope for validation campaign)
