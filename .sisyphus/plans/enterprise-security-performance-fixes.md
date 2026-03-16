# Photogiraffe Enterprise Readiness: Security, Bugs & Performance Fixes

## TL;DR

> **Quick Summary**: Comprehensive security hardening, bug fixes, and performance optimization to transform Photogiraffe from development prototype to enterprise-grade production platform.
> 
> **Deliverables**:
> - Fix 13 security vulnerabilities (3 critical, 6 high)
> - Fix 18 reliability bugs (4 critical race conditions, 4 resource leaks)
> - Optimize database performance (N+1 queries, missing indexes)
> - Implement caching layer (Redis)
> - Add enterprise monitoring and logging
> - Enable horizontal scalability
> 
> **Estimated Effort**: Large (4-6 weeks)
> **Parallel Execution**: YES - 5 waves
> **Critical Path**: Security fixes → Bug fixes → Performance optimization → Monitoring

---

## Context

### Original Request
User requested comprehensive security audit, bug fixes, and performance optimization to prepare Photogiraffe for enterprise-class deployment.

### Analysis Summary

**Security Audit Findings**:
- 3 CRITICAL: Weak JWT secret, SQL injection pattern, privilege escalation
- 6 HIGH: Missing CSRF, symmetric JWT, no rate limiting on sensitive endpoints
- 4 MEDIUM: Insufficient input validation, no secrets rotation, overly permissive CORS

**Bug Analysis Findings**:
- 4 CRITICAL: Race conditions (SSE channel panic, login history TOCTOU, unhandled crypto errors, MinIO connection leaks)
- 4 HIGH: Silent failures (notifications, emails, task publishing)
- 5 MEDIUM: SQL injection risk, unvalidated pagination, missing error checks
- 5 LOW: Case-sensitive checks, type conversions, unclosed resources

**Performance Analysis Findings**:
- Database: N+1 queries, missing indexes, inefficient queries
- Caching: No caching layer, repeated DB hits for static data
- Concurrency: Single Python worker, SSE hub lock contention
- Scalability: Stateful components, single points of failure
- Frontend: Large bundle, chatty API, no image optimization

---

## Work Objectives

### Core Objective
Transform Photogiraffe from development prototype to enterprise-grade production platform with:
1. Zero critical security vulnerabilities
2. Zero critical bugs (race conditions, resource leaks)
3. 10x performance improvement under load
4. Horizontal scalability support
5. Production-grade monitoring and observability

### Concrete Deliverables
- Secure JWT implementation with RS256 and proper secret management
- CSRF protection on all state-changing operations
- Fixed race conditions with proper synchronization
- Database indexes on all frequently-queried fields
- Redis caching layer for feature flags, AI config, user profiles
- Python worker pool (3-5 workers) for parallel processing
- Comprehensive error handling with structured logging
- Prometheus metrics and distributed tracing
- Health checks and graceful shutdown

### Definition of Done
- [ ] All CRITICAL and HIGH security issues resolved (verified by security scan)
- [ ] All CRITICAL and HIGH bugs fixed (verified by integration tests)
- [ ] Database query performance <50ms p95 (verified by load testing)
- [ ] System handles 100 concurrent users without degradation
- [ ] Zero goroutine leaks, zero connection leaks (verified by profiling)
- [ ] Horizontal scaling tested with 3+ Go instances
- [ ] Monitoring dashboards operational with key metrics

### Must Have
- Strong JWT secret enforcement (fail-fast if not set)
- CSRF token validation on POST/PUT/DELETE
- Fixed SSE channel race condition
- Fixed MinIO connection leaks
- Database indexes on user_id, photo_id fields
- Redis caching for feature flags and AI config

### Must NOT Have (Guardrails)
- No breaking API changes (maintain backward compatibility)
- No data migration required (schema changes must be additive)
- No downtime deployment (use blue-green or rolling updates)
- No hardcoded secrets in code
- No silent error swallowing (all errors must be logged)

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** — ALL verification is automated.

### Test Decision
- **Infrastructure exists**: YES (Go tests, Python integration tests)
- **Automated tests**: Tests-after (add tests for each fix)
- **Framework**: Go `testing`, Python `pytest`

### QA Policy
Every task includes automated verification scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (CRITICAL SECURITY - Start Immediately):
├── Task 1: Enforce strong JWT secret [quick]
├── Task 2: Fix SQL injection pattern [quick]
├── Task 3: Implement explicit RBAC [quick]
├── Task 4: Add CSRF protection [unspecified-high]
└── Task 5: Migrate JWT to RS256 [unspecified-high]

Wave 2 (CRITICAL BUGS - After Wave 1):
├── Task 6: Fix SSE channel race condition [deep]
├── Task 7: Fix MinIO connection leaks [quick]
├── Task 8: Fix crypto error handling [quick]
├── Task 9: Fix login history race [quick]
└── Task 10: Add comprehensive error handling [unspecified-high]

Wave 3 (DATABASE PERFORMANCE - After Wave 2):
├── Task 11: Add database indexes [quick]
├── Task 12: Fix N+1 queries [unspecified-high]
├── Task 13: Implement Redis caching [unspecified-high]
├── Task 14: Optimize dashboard queries [quick]
└── Task 15: Configure connection pooling [quick]

Wave 4 (SCALABILITY - After Wave 3):
├── Task 16: Migrate SSE to Redis pub/sub [deep]
├── Task 17: Implement Python worker pool [unspecified-high]
├── Task 18: Add rate limiting to all endpoints [unspecified-high]
├── Task 19: Implement secrets rotation [deep]
└── Task 20: Add input validation middleware [unspecified-high]

Wave 5 (MONITORING & OBSERVABILITY - After Wave 4):
├── Task 21: Add Prometheus metrics [unspecified-high]
├── Task 22: Implement structured logging [quick]
├── Task 23: Add distributed tracing [unspecified-high]
├── Task 24: Create health check endpoints [quick]
└── Task 25: Add graceful shutdown [quick]

Wave FINAL (VERIFICATION - After ALL tasks):
├── Task F1: Security scan and penetration test [oracle]
├── Task F2: Load testing (100 concurrent users) [unspecified-high]
├── Task F3: Integration test suite [deep]
└── Task F4: Production readiness checklist [deep]

Critical Path: Task 1-5 → Task 6-10 → Task 11-15 → Task 16-20 → Task 21-25 → F1-F4
Parallel Speedup: ~60% faster than sequential
Max Concurrent: 5 (Waves 1-4)
```

---

## TODOs

### Wave 1: CRITICAL SECURITY FIXES

- [x] 1. Enforce Strong JWT Secret

  **What to do**:
  - Modify `go-core/auth/jwt.go` line 24-30: Remove fallback default secret
  - Add startup validation in `main.go`: Fail-fast if `JWT_SECRET` not set or <32 chars
  - Update `.env.example` with secret generation instructions
  - Add validation: JWT_SECRET must be ≥32 characters

  **Must NOT do**:
  - Do not change JWT claims structure (breaking change)
  - Do not invalidate existing tokens (users stay logged in)

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []
  - **Reason**: Simple validation logic, no complex dependencies

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2-5)
  - **Blocks**: None
  - **Blocked By**: None

  **References**:
  - `go-core/auth/jwt.go:24-30` - Current weak default implementation
  - `go-core/main.go:319-322` - Existing JWT_SECRET check (warning only)
  - `.env.example` - Add secret generation instructions

  **Acceptance Criteria**:
  - [ ] Server refuses to start if JWT_SECRET not set
  - [ ] Server refuses to start if JWT_SECRET <32 characters
  - [ ] `.env.example` includes `openssl rand -hex 32` command
  - [ ] Existing valid tokens continue to work

  **QA Scenarios**:
  ```
  Scenario: Server startup without JWT_SECRET
    Tool: Bash
    Preconditions: Unset JWT_SECRET environment variable
    Steps:
      1. unset JWT_SECRET && ./go-core/main
      2. Check exit code and stderr output
    Expected Result: Exit code 1, error message "JWT_SECRET must be set"
    Evidence: .sisyphus/evidence/task-1-no-secret.txt

  Scenario: Server startup with weak JWT_SECRET
    Tool: Bash
    Preconditions: Set JWT_SECRET="short"
    Steps:
      1. JWT_SECRET="short" ./go-core/main
      2. Check exit code and stderr output
    Expected Result: Exit code 1, error message "JWT_SECRET must be at least 32 characters"
    Evidence: .sisyphus/evidence/task-1-weak-secret.txt

  Scenario: Server startup with strong JWT_SECRET
    Tool: Bash
    Preconditions: Set JWT_SECRET to 32+ char string
    Steps:
      1. JWT_SECRET=$(openssl rand -hex 32) ./go-core/main &
      2. curl http://localhost:8080/health
      3. Check response status
    Expected Result: HTTP 200, server starts successfully
    Evidence: .sisyphus/evidence/task-1-strong-secret.txt
  ```

  **Commit**: YES
  - Message: `security(auth): enforce strong JWT secret on startup`
  - Files: `go-core/auth/jwt.go`, `go-core/main.go`, `.env.example`

- [x] 2. Fix SQL Injection Pattern

  **What to do**:
  - Review `go-core/main.go` line 4287-4337: Replace string concatenation with parameterized queries
  - Search codebase for all SQL string concatenation patterns
  - Replace with GORM query builder or properly parameterized raw SQL
  - Add linting rule to prevent future SQL concatenation

  **Must NOT do**:
  - Do not change query results or API responses
  - Do not break existing functionality

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []
  - **Reason**: Pattern replacement, straightforward refactoring

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3-5)
  - **Blocks**: None
  - **Blocked By**: None

  **References**:
  - `go-core/main.go:4287-4337` - String concatenation in SQL
  - `go-core/main.go:1353` - JSONB query with string interpolation
  - GORM documentation: Query builder patterns

  **Acceptance Criteria**:
  - [ ] Zero SQL string concatenation in codebase
  - [ ] All queries use parameterized placeholders
  - [ ] Existing query results unchanged (verified by tests)
  - [ ] Linting rule added to prevent future violations

  **QA Scenarios**:
  ```
  Scenario: Dashboard stats query returns correct data
    Tool: Bash (curl)
    Preconditions: Database with test data, authenticated user
    Steps:
      1. curl -H "Authorization: Bearer $TOKEN" http://localhost:8080/api/admin/stats
      2. Parse JSON response
      3. Verify counts match database query results
    Expected Result: Correct counts, no SQL errors
    Evidence: .sisyphus/evidence/task-2-stats-query.json

  Scenario: Color bucket filter works correctly
    Tool: Bash (curl)
    Preconditions: Photos with dominant_colors in database
    Steps:
      1. curl -H "Authorization: Bearer $TOKEN" "http://localhost:8080/photos?color_bucket=blue"
      2. Verify only blue-tagged photos returned
    Expected Result: Filtered results, no SQL injection
    Evidence: .sisyphus/evidence/task-2-color-filter.json
  ```

  **Commit**: YES
  - Message: `security(db): replace SQL string concatenation with parameterized queries`
  - Files: `go-core/main.go`

- [x] 3. Implement Explicit RBAC

  **What to do**:
  - Replace negative role checks (`role != "SuperAdmin"`) with positive whitelist checks
  - Create `allowedRoles` map for each endpoint
  - Update `requireRole()` middleware to use whitelist approach
  - Add role validation on user creation/update

  **Must NOT do**:
  - Do not change existing role names (breaking change)
  - Do not invalidate existing user sessions

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []
  - **Reason**: Pattern replacement across codebase

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1-2, 4-5)
  - **Blocks**: None
  - **Blocked By**: None

  **References**:
  - `go-core/main.go:4252-4258` - Negative role check pattern
  - `go-core/main.go:126-138` - requireRole middleware
  - Security audit finding: Privilege escalation risk

  **Acceptance Criteria**:
  - [ ] All role checks use positive whitelist (`role == "SuperAdmin"`)
  - [ ] requireRole middleware validates against allowed list
  - [ ] Unknown roles are rejected (403 Forbidden)
  - [ ] Existing functionality unchanged

  **QA Scenarios**:
  ```
  Scenario: SuperAdmin can access admin endpoints
    Tool: Bash (curl)
    Preconditions: SuperAdmin user authenticated
    Steps:
      1. curl -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:8080/api/admin/stats
      2. Check response status
    Expected Result: HTTP 200, stats returned
    Evidence: .sisyphus/evidence/task-3-admin-access.json

  Scenario: StandardUser cannot access admin endpoints
    Tool: Bash (curl)
    Preconditions: StandardUser authenticated
    Steps:
      1. curl -H "Authorization: Bearer $USER_TOKEN" http://localhost:8080/api/admin/stats
      2. Check response status
    Expected Result: HTTP 403, error message "Insufficient permissions"
    Evidence: .sisyphus/evidence/task-3-user-denied.json
  ```

  **Commit**: YES
  - Message: `security(rbac): implement explicit role whitelist checks`
  - Files: `go-core/main.go`

- [x] 4. Add CSRF Protection

  **What to do**:
  - Install `github.com/gofiber/fiber/v2/middleware/csrf` package
  - Add CSRF middleware to Fiber app
  - Generate CSRF tokens on login/register
  - Validate CSRF tokens on POST/PUT/DELETE requests
  - Add CSRF token to frontend API calls

  **Must NOT do**:
  - Do not break existing API clients (provide migration path)
  - Do not require CSRF for internal worker endpoints

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []
  - **Reason**: Requires frontend and backend coordination

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1-3, 5)
  - **Blocks**: None
  - **Blocked By**: None

  **References**:
  - `go-core/main.go:374-378` - CORS configuration (no CSRF)
  - Fiber CSRF middleware docs: https://docs.gofiber.io/api/middleware/csrf
  - Security audit finding: Missing CSRF protection

  **Acceptance Criteria**:
  - [ ] CSRF middleware installed and configured
  - [ ] CSRF tokens generated on auth endpoints
  - [ ] State-changing requests require valid CSRF token
  - [ ] Internal endpoints exempt from CSRF (X-Internal-Secret)
  - [ ] Frontend updated to include CSRF tokens

  **QA Scenarios**:
  ```
  Scenario: POST without CSRF token is rejected
    Tool: Bash (curl)
    Preconditions: Authenticated user
    Steps:
      1. curl -X POST -H "Authorization: Bearer $TOKEN" http://localhost:8080/api/photos/1/favorite
      2. Check response status
    Expected Result: HTTP 403, error "CSRF token missing"
    Evidence: .sisyphus/evidence/task-4-csrf-missing.json

  Scenario: POST with valid CSRF token succeeds
    Tool: Bash (curl)
    Preconditions: Authenticated user with CSRF token
    Steps:
      1. curl -X POST -H "Authorization: Bearer $TOKEN" -H "X-CSRF-Token: $CSRF" http://localhost:8080/api/photos/1/favorite
      2. Check response status
    Expected Result: HTTP 200, favorite added
    Evidence: .sisyphus/evidence/task-4-csrf-valid.json
  ```

  **Commit**: YES
  - Message: `security(csrf): add CSRF protection to state-changing operations`
  - Files: `go-core/main.go`, `go-core/go.mod`, `frontend/src/lib/api.ts`

- [x] 5. Migrate JWT to RS256

  **What to do**:
  - Generate RSA key pair (2048-bit minimum)
  - Store private key securely (env var or secrets manager)
  - Update `auth/jwt.go` to use RS256 instead of HS256
  - Add public key endpoint for token verification
  - Update token validation to use public key

  **Must NOT do**:
  - Do not invalidate existing HS256 tokens immediately (grace period)
  - Do not expose private key

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []
  - **Reason**: Cryptographic implementation, requires careful testing

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1-4)
  - **Blocks**: None
  - **Blocked By**: None

  **References**:
  - `go-core/auth/jwt.go:47` - Current HS256 implementation
  - Security audit finding: Symmetric JWT signing
  - JWT RS256 best practices: https://auth0.com/blog/rs256-vs-hs256/

  **Acceptance Criteria**:
  - [ ] RSA key pair generated (2048-bit)
  - [ ] JWT signed with RS256 using private key
  - [ ] JWT validated with public key
  - [ ] Public key exposed at `/api/auth/jwks.json`
  - [ ] Existing HS256 tokens work during grace period (7 days)

  **QA Scenarios**:
  ```
  Scenario: New tokens use RS256
    Tool: Bash
    Preconditions: Server running with RS256 enabled
    Steps:
      1. curl -X POST http://localhost:8080/api/auth/login -d '{"username":"test","password":"test"}'
      2. Extract access_token from response
      3. Decode JWT header (base64)
      4. Check "alg" field
    Expected Result: "alg": "RS256"
    Evidence: .sisyphus/evidence/task-5-rs256-token.txt

  Scenario: Public key endpoint accessible
    Tool: Bash (curl)
    Preconditions: Server running
    Steps:
      1. curl http://localhost:8080/api/auth/jwks.json
      2. Parse JSON response
      3. Verify "kty": "RSA" present
    Expected Result: HTTP 200, valid JWKS format
    Evidence: .sisyphus/evidence/task-5-jwks.json
  ```

  **Commit**: YES
  - Message: `security(jwt): migrate from HS256 to RS256 signing`
  - Files: `go-core/auth/jwt.go`, `go-core/main.go`, `.env.example`

### Wave 2: CRITICAL BUG FIXES

- [x] 6. Fix SSE Channel Race Condition

  **What to do**:
  - Add channel state tracking (open/closed) with atomic operations
  - Wrap channel sends in defer/recover to catch panics
  - Add channel close detection before sending
  - Implement graceful channel cleanup on unsubscribe

  **Must NOT do**:
  - Do not break existing SSE functionality
  - Do not change SSE message format

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []
  - **Reason**: Complex concurrency issue, requires careful synchronization

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 7-10)
  - **Blocks**: None
  - **Blocked By**: Wave 1 complete

  **References**:
  - `go-core/main.go:48-84` - SSE hub implementation
  - Bug analysis finding: Race condition causing panic
  - Go concurrency patterns: https://go.dev/blog/pipelines

  **Acceptance Criteria**:
  - [ ] No panics when sending to closed channels
  - [ ] Channels properly cleaned up on unsubscribe
  - [ ] SSE messages delivered reliably
  - [ ] Race detector passes (`go test -race`)

  **QA Scenarios**:
  ```
  Scenario: Concurrent subscribe/unsubscribe doesn't panic
    Tool: Bash
    Preconditions: Server running
    Steps:
      1. Run go test -race ./... -run TestSSEConcurrency
      2. Test spawns 100 goroutines subscribing/unsubscribing
      3. Check for race conditions or panics
    Expected Result: All tests pass, no race conditions
    Evidence: .sisyphus/evidence/task-6-sse-race-test.txt

  Scenario: Messages delivered after rapid reconnect
    Tool: Bash
    Preconditions: Server running, authenticated user
    Steps:
      1. Open SSE connection
      2. Close connection
      3. Immediately reopen connection
      4. Trigger event (upload photo)
      5. Verify message received
    Expected Result: Message delivered, no panic
    Evidence: .sisyphus/evidence/task-6-sse-reconnect.txt
  ```

  **Commit**: YES
  - Message: `fix(sse): prevent panic on closed channel send`
  - Files: `go-core/main.go`, `go-core/main_test.go`

- [x] 7. Fix MinIO Connection Leaks

  **What to do**:
  - Wrap all MinIO `get_object()` calls with try/finally
  - Ensure `response.close()` and `response.release_conn()` always called
  - Use context managers where possible
  - Add connection pool monitoring

  **Must NOT do**:
  - Do not change MinIO client initialization
  - Do not break existing file operations

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []
  - **Reason**: Pattern replacement, straightforward fix

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 6, 8-10)
  - **Blocks**: None
  - **Blocked By**: Wave 1 complete

  **References**:
  - `python-worker/main.py:245-248, 554-556, 1164-1173, 1309-1311` - Connection leak locations
  - Bug analysis finding: Resource leak
  - MinIO Python client docs: Connection management

  **Acceptance Criteria**:
  - [ ] All MinIO responses properly closed
  - [ ] Connection pool doesn't exhaust under load
  - [ ] No connection leaks (verified by monitoring)

  **QA Scenarios**:
  ```
  Scenario: Process 100 images without connection exhaustion
    Tool: Bash
    Preconditions: 100 test images in MinIO
    Steps:
      1. python python-worker/main.py &
      2. Publish 100 image processing tasks
      3. Monitor MinIO connection count
      4. Wait for all tasks to complete
      5. Check final connection count
    Expected Result: Connection count returns to baseline
    Evidence: .sisyphus/evidence/task-7-minio-connections.txt
  ```

  **Commit**: YES
  - Message: `fix(worker): ensure MinIO connections always released`
  - Files: `python-worker/main.py`

- [x] 8. Fix Crypto Error Handling

  **What to do**:
  - Add error check after `rand.Read()` in password reset token generation
  - Return error if crypto operation fails
  - Add retry logic for transient failures
  - Log crypto errors for security monitoring

  **Must NOT do**:
  - Do not change token format
  - Do not weaken security

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []
  - **Reason**: Simple error handling addition

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 6-7, 9-10)
  - **Blocks**: None
  - **Blocked By**: Wave 1 complete

  **References**:
  - `go-core/main.go:745-746` - Unhandled rand.Read() error
  - Bug analysis finding: Unhandled crypto error
  - Go crypto best practices

  **Acceptance Criteria**:
  - [ ] rand.Read() errors checked and handled
  - [ ] Failed token generation returns error to user
  - [ ] Crypto errors logged for monitoring

  **QA Scenarios**:
  ```
  Scenario: Password reset with valid crypto
    Tool: Bash (curl)
    Preconditions: User exists in database
    Steps:
      1. curl -X POST http://localhost:8080/api/auth/forgot-password -d '{"email":"test@example.com"}'
      2. Check response status
      3. Verify token generated in database
    Expected Result: HTTP 200, token generated
    Evidence: .sisyphus/evidence/task-8-crypto-success.json
  ```

  **Commit**: YES
  - Message: `fix(auth): handle crypto errors in token generation`
  - Files: `go-core/main.go`

- [x] 9. Fix Login History Race Condition

  **What to do**:
  - Replace TOCTOU pattern with single atomic DELETE query
  - Use `DELETE FROM login_history WHERE id IN (SELECT id FROM login_history WHERE user_id = ? ORDER BY created_at DESC OFFSET 10)`
  - Add database transaction for consistency
  - Add unique constraint to prevent duplicates

  **Must NOT do**:
  - Do not change login history data structure
  - Do not break existing queries

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []
  - **Reason**: SQL query optimization

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 6-8, 10)
  - **Blocks**: None
  - **Blocked By**: Wave 1 complete

  **References**:
  - `go-core/main.go:305-316` - TOCTOU race condition
  - Bug analysis finding: Race condition in deletion
  - PostgreSQL atomic operations

  **Acceptance Criteria**:
  - [ ] Login history deletion is atomic
  - [ ] No race conditions under concurrent logins
  - [ ] Exactly 10 most recent records kept per user

  **QA Scenarios**:
  ```
  Scenario: Concurrent logins don't corrupt history
    Tool: Bash
    Preconditions: User account exists
    Steps:
      1. Run 20 concurrent login requests
      2. Check login_history table
      3. Verify exactly 10 records for user
    Expected Result: Exactly 10 records, no duplicates
    Evidence: .sisyphus/evidence/task-9-concurrent-logins.txt
  ```

  **Commit**: YES
  - Message: `fix(auth): atomic login history cleanup`
  - Files: `go-core/main.go`

- [x] 10. Add Comprehensive Error Handling

  **What to do**:
  - Add error handling to all goroutines (lines 513, 536, 763-764)
  - Implement error channel for goroutine error propagation
  - Add structured logging for all errors
  - Create error handling middleware
  - Add panic recovery middleware

  **Must NOT do**:
  - Do not change API error response format
  - Do not expose internal error details to clients

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []
  - **Reason**: Systematic error handling across codebase

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 6-9)
  - **Blocks**: None
  - **Blocked By**: Wave 1 complete

  **References**:
  - `go-core/main.go:513, 536, 763-764` - Unhandled goroutine errors
  - `go-core/main.go:87-95` - Silent notification failure
  - Bug analysis findings: Silent failures

  **Acceptance Criteria**:
  - [ ] All goroutines have error handling
  - [ ] Errors logged with context (user ID, request ID)
  - [ ] Panic recovery middleware catches crashes
  - [ ] No silent failures

  **QA Scenarios**:
  ```
  Scenario: Email failure is logged
    Tool: Bash
    Preconditions: SMTP misconfigured
    Steps:
      1. Trigger password reset
      2. Check application logs
      3. Verify error logged with context
    Expected Result: Error logged with user email, timestamp
    Evidence: .sisyphus/evidence/task-10-email-error-log.txt

  Scenario: Panic doesn't crash server
    Tool: Bash
    Preconditions: Inject panic in test endpoint
    Steps:
      1. curl http://localhost:8080/test/panic
      2. Check server still responds
      3. curl http://localhost:8080/health
    Expected Result: Panic logged, server still running
    Evidence: .sisyphus/evidence/task-10-panic-recovery.txt
  ```

  **Commit**: YES
  - Message: `fix(errors): add comprehensive error handling and logging`
  - Files: `go-core/main.go`

### Wave 3: DATABASE PERFORMANCE OPTIMIZATION

- [x] 11. Add Database Indexes

  **What to do**:
  - Add index on `photos(user_id)` for user photo listings
  - Add index on `exif_data(photo_id)` for joins
  - Add composite index on `favorites(user_id, photo_id)`
  - Add index on `ai_rate_limit(target_user_id)`
  - Add index on `notifications(user_id, is_read)`
  - Measure query performance before/after

  **Must NOT do**:
  - Do not add indexes on low-cardinality columns
  - Do not create duplicate indexes

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []
  - **Reason**: Straightforward DDL statements

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 12-15)
  - **Blocks**: None
  - **Blocked By**: Wave 2 complete

  **References**:
  - Performance analysis: Missing indexes on frequently-queried fields
  - `go-core/models/models.go` - Model definitions
  - PostgreSQL index best practices

  **Acceptance Criteria**:
  - [ ] All indexes created successfully
  - [ ] Query performance improved (measured with EXPLAIN ANALYZE)
  - [ ] No duplicate indexes
  - [ ] Index usage verified in query plans

  **QA Scenarios**:
  ```
  Scenario: User photo listing query uses index
    Tool: Bash
    Preconditions: Indexes created, test data loaded
    Steps:
      1. psql -c "EXPLAIN ANALYZE SELECT * FROM photos WHERE user_id = 1 LIMIT 20"
      2. Check query plan for index scan
      3. Measure execution time
    Expected Result: Index scan used, <10ms execution time
    Evidence: .sisyphus/evidence/task-11-index-usage.txt
  ```

  **Commit**: YES
  - Message: `perf(db): add indexes on frequently-queried columns`
  - Files: `go-core/database/db.go`

- [x] 12. Fix N+1 Queries

  **What to do**:
  - Add `Preload("ExifData")` to all photo list queries
  - Batch dashboard stats into single query with GROUP BY
  - Use joins instead of separate queries for favorites
  - Implement eager loading for album photos
  - Add query logging to detect future N+1 issues

  **Must NOT do**:
  - Do not change API response format
  - Do not break existing functionality

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []
  - **Reason**: Requires understanding of GORM query patterns

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 11, 13-15)
  - **Blocks**: None
  - **Blocked By**: Wave 2 complete

  **References**:
  - `go-core/main.go:1053, 2807-2810, 4263-4279` - N+1 query locations
  - Performance analysis: N+1 query problems
  - GORM preloading docs

  **Acceptance Criteria**:
  - [ ] Photo list queries preload EXIF data
  - [ ] Dashboard stats use single query
  - [ ] Favorites endpoint uses joins
  - [ ] Query count reduced by 80%+

  **QA Scenarios**:
  ```
  Scenario: Photo list makes minimal queries
    Tool: Bash
    Preconditions: Enable query logging, 20 photos in database
    Steps:
      1. curl http://localhost:8080/photos?limit=20
      2. Count SQL queries in logs
      3. Verify EXIF data included in response
    Expected Result: ≤3 queries (1 count, 1 photos+EXIF, 1 favorites)
    Evidence: .sisyphus/evidence/task-12-query-count.txt
  ```

  **Commit**: YES
  - Message: `perf(db): eliminate N+1 queries with eager loading`
  - Files: `go-core/main.go`

- [x] 13. Implement Redis Caching

  **What to do**:
  - Install Redis caching library (`github.com/go-redis/cache`)
  - Cache feature flags (5min TTL)
  - Cache AI config (1 hour TTL)
  - Cache user profiles (15min TTL)
  - Implement cache invalidation on updates
  - Add cache hit/miss metrics

  **Must NOT do**:
  - Do not cache user-specific data without proper isolation
  - Do not cache sensitive data (passwords, tokens)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []
  - **Reason**: Requires cache strategy design

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 11-12, 14-15)
  - **Blocks**: None
  - **Blocked By**: Wave 2 complete

  **References**:
  - Performance analysis: Missing caching layers
  - `go-core/main.go:351, 428, 800, 825` - Repeated DB queries
  - Redis caching patterns

  **Acceptance Criteria**:
  - [ ] Feature flags cached in Redis
  - [ ] AI config cached in Redis
  - [ ] Cache invalidation works correctly
  - [ ] Cache hit rate >80% after warmup

  **QA Scenarios**:
  ```
  Scenario: Feature flag cache reduces DB load
    Tool: Bash
    Preconditions: Redis running, feature flags in DB
    Steps:
      1. Make 100 requests requiring feature flag check
      2. Count database queries
      3. Check Redis cache hit rate
    Expected Result: <5 DB queries, >95% cache hit rate
    Evidence: .sisyphus/evidence/task-13-cache-hits.txt
  ```

  **Commit**: YES
  - Message: `perf(cache): implement Redis caching for static data`
  - Files: `go-core/main.go`, `go-core/go.mod`

- [x] 14. Optimize Dashboard Queries

  **What to do**:
  - Combine 5 separate count queries into single query with aggregations
  - Use materialized view or cached results for expensive stats
  - Add pagination to admin user list
  - Optimize recent uploads query with index

  **Must NOT do**:
  - Do not change dashboard API response format
  - Do not break existing charts

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []
  - **Reason**: SQL query optimization

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 11-13, 15)
  - **Blocks**: None
  - **Blocked By**: Wave 2 complete

  **References**:
  - `go-core/main.go:2807-2810, 4263-4279` - Sequential count queries
  - Performance analysis: Inefficient dashboard queries

  **Acceptance Criteria**:
  - [ ] Dashboard stats use single query
  - [ ] Query execution time <100ms
  - [ ] Response format unchanged

  **QA Scenarios**:
  ```
  Scenario: Dashboard loads quickly
    Tool: Bash (curl with timing)
    Preconditions: 10,000 photos in database
    Steps:
      1. time curl http://localhost:8080/api/admin/stats
      2. Measure response time
      3. Check query count in logs
    Expected Result: <100ms response time, 1 query
    Evidence: .sisyphus/evidence/task-14-dashboard-perf.txt
  ```

  **Commit**: YES
  - Message: `perf(admin): optimize dashboard queries with aggregations`
  - Files: `go-core/main.go`

- [x] 15. Configure Connection Pooling

  **What to do**:
  - Configure GORM connection pool: `SetMaxOpenConns(25)`, `SetMaxIdleConns(5)`, `SetConnMaxLifetime(5min)`
  - Configure Redis connection pool
  - Add connection pool monitoring
  - Tune based on load testing results

  **Must NOT do**:
  - Do not set pool size too high (resource exhaustion)
  - Do not set pool size too low (connection starvation)

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []
  - **Reason**: Configuration tuning

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 11-14)
  - **Blocks**: None
  - **Blocked By**: Wave 2 complete

  **References**:
  - `go-core/database/db.go:26` - No explicit pool configuration
  - Performance analysis: Connection pool sizing
  - GORM connection pool docs

  **Acceptance Criteria**:
  - [ ] Connection pool configured with optimal settings
  - [ ] No connection exhaustion under load
  - [ ] Pool metrics exposed for monitoring

  **QA Scenarios**:
  ```
  Scenario: Handle 100 concurrent requests
    Tool: Bash (load testing)
    Preconditions: Server running with pool config
    Steps:
      1. ab -n 1000 -c 100 http://localhost:8080/photos
      2. Monitor connection pool usage
      3. Check for connection errors
    Expected Result: All requests succeed, no connection errors
    Evidence: .sisyphus/evidence/task-15-connection-pool.txt
  ```

  **Commit**: YES
  - Message: `perf(db): configure connection pool for optimal performance`
  - Files: `go-core/database/db.go`, `go-core/queue/redis.go`

### Wave 4: SCALABILITY

- [x] 16. Migrate SSE to Redis Pub/Sub

  **What to do**:
  - Replace in-memory SSE hub with Redis pub/sub
  - Subscribe to Redis channels per user
  - Publish events to Redis instead of in-memory channels
  - Enable multi-instance deployment (stateless SSE)
  - Add reconnection logic for Redis failures

  **Must NOT do**:
  - Do not change SSE message format
  - Do not break existing SSE clients

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []
  - **Reason**: Complex distributed system design

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with Tasks 17-20)
  - **Blocks**: None
  - **Blocked By**: Wave 3 complete

  **References**:
  - `go-core/main.go:48-84` - Current in-memory SSE hub
  - Performance analysis: Stateful SSE breaks horizontal scaling
  - Redis pub/sub patterns

  **Acceptance Criteria**:
  - [ ] SSE events published to Redis channels
  - [ ] Multiple Go instances can serve SSE clients
  - [ ] Events delivered to correct users across instances
  - [ ] Graceful degradation on Redis failure

  **QA Scenarios**:
  ```
  Scenario: Events delivered across multiple instances
    Tool: Bash
    Preconditions: 2 Go instances running, Redis pub/sub enabled
    Steps:
      1. Connect SSE client to instance A
      2. Upload photo via instance B
      3. Verify SSE event received on instance A
    Expected Result: Event delivered cross-instance
    Evidence: .sisyphus/evidence/task-16-cross-instance.txt

  Scenario: SSE survives Redis restart
    Tool: Bash
    Preconditions: SSE client connected, Redis running
    Steps:
      1. docker compose restart redis
      2. Wait for reconnection
      3. Trigger event
      4. Verify event delivered
    Expected Result: Reconnection successful, events resume
    Evidence: .sisyphus/evidence/task-16-redis-reconnect.txt
  ```

  **Commit**: YES
  - Message: `feat(sse): migrate to Redis pub/sub for horizontal scaling`
  - Files: `go-core/main.go`, `go-core/queue/redis.go`

- [x] 17. Implement Python Worker Pool

  **What to do**:
  - Modify `python-worker/main.py` to spawn 3-5 worker processes
  - Each worker consumes from same Redis Stream consumer group
  - Add worker health monitoring
  - Implement graceful shutdown for workers
  - Add worker ID to logs for debugging

  **Must NOT do**:
  - Do not change task message format
  - Do not break existing task handlers

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []
  - **Reason**: Multiprocessing implementation

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with Tasks 16, 18-20)
  - **Blocks**: None
  - **Blocked By**: Wave 3 complete

  **References**:
  - `python-worker/main.py:1-50` - Current single-worker implementation
  - Performance analysis: Single worker bottleneck
  - Python multiprocessing patterns

  **Acceptance Criteria**:
  - [ ] 3-5 workers running concurrently
  - [ ] Tasks distributed across workers
  - [ ] No duplicate task processing
  - [ ] 3x throughput improvement

  **QA Scenarios**:
  ```
  Scenario: Multiple workers process tasks in parallel
    Tool: Bash
    Preconditions: 100 image processing tasks queued
    Steps:
      1. Start worker pool (5 workers)
      2. Monitor task completion rate
      3. Verify all 100 tasks completed
      4. Check for duplicate processing
    Expected Result: All tasks complete, no duplicates, <2min total time
    Evidence: .sisyphus/evidence/task-17-worker-pool.txt
  ```

  **Commit**: YES
  - Message: `perf(worker): implement worker pool for parallel processing`
  - Files: `python-worker/main.py`

- [x] 18. Add Rate Limiting to All Endpoints

  **What to do**:
  - Install `github.com/gofiber/fiber/v2/middleware/limiter`
  - Apply rate limiting to all API endpoints (60 req/min per IP)
  - Stricter limits for sensitive endpoints (auth: 5 req/min)
  - Add rate limit headers (X-RateLimit-*)
  - Store rate limit state in Redis (shared across instances)

  **Must NOT do**:
  - Do not rate limit internal worker endpoints
  - Do not break legitimate high-frequency usage

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []
  - **Reason**: Middleware configuration across endpoints

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with Tasks 16-17, 19-20)
  - **Blocks**: None
  - **Blocked By**: Wave 3 complete

  **References**:
  - `nginx/nginx.conf:20-22` - Current nginx rate limiting (auth only)
  - Security audit: No rate limiting on sensitive endpoints
  - Fiber limiter docs

  **Acceptance Criteria**:
  - [ ] All public endpoints rate limited
  - [ ] Rate limit state shared via Redis
  - [ ] Rate limit headers present in responses
  - [ ] 429 status returned when exceeded

  **QA Scenarios**:
  ```
  Scenario: Rate limit enforced on photo upload
    Tool: Bash
    Preconditions: Rate limit 60 req/min configured
    Steps:
      1. Send 70 upload requests in 1 minute
      2. Check responses after 60th request
    Expected Result: First 60 succeed (200), next 10 fail (429)
    Evidence: .sisyphus/evidence/task-18-rate-limit.txt
  ```

  **Commit**: YES
  - Message: `security(rate-limit): add rate limiting to all endpoints`
  - Files: `go-core/main.go`, `go-core/go.mod`

- [ ] 19. Implement Secrets Rotation

  **What to do**:
  - Add support for multiple active JWT signing keys (key versioning)
  - Implement key rotation endpoint (SuperAdmin only)
  - Add grace period for old keys (7 days)
  - Store key metadata in database (created_at, expires_at)
  - Add automated rotation schedule (optional)

  **Must NOT do**:
  - Do not invalidate all tokens on rotation
  - Do not expose private keys in logs

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []
  - **Reason**: Complex cryptographic key management

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with Tasks 16-18, 20)
  - **Blocks**: None
  - **Blocked By**: Wave 3 complete

  **References**:
  - `go-core/auth/jwt.go` - Current single-key implementation
  - Security audit: No secrets rotation mechanism
  - JWT key rotation best practices

  **Acceptance Criteria**:
  - [ ] Multiple signing keys supported
  - [ ] Old tokens valid during grace period
  - [ ] Key rotation endpoint functional
  - [ ] Key metadata tracked in database

  **QA Scenarios**:
  ```
  Scenario: Token valid after key rotation
    Tool: Bash (curl)
    Preconditions: User logged in with token
    Steps:
      1. Get access token
      2. Rotate signing key (admin endpoint)
      3. Use old token to access protected endpoint
      4. Verify still valid (within grace period)
    Expected Result: Old token works for 7 days
    Evidence: .sisyphus/evidence/task-19-key-rotation.txt
  ```

  **Commit**: YES
  - Message: `security(secrets): implement JWT key rotation with grace period`
  - Files: `go-core/auth/jwt.go`, `go-core/main.go`, `go-core/models/models.go`

- [x] 20. Add Input Validation Middleware

  **What to do**:
  - Install validation library (`github.com/go-playground/validator/v10`)
  - Add validation middleware for all request bodies
  - Validate pagination parameters (limit ≤100, offset ≥0)
  - Validate export dimensions (max 8000x8000)
  - Validate file upload sizes and types
  - Return 400 with clear error messages

  **Must NOT do**:
  - Do not break existing valid requests
  - Do not expose internal validation logic

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []
  - **Reason**: Systematic validation across endpoints

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with Tasks 16-19)
  - **Blocks**: None
  - **Blocked By**: Wave 3 complete

  **References**:
  - `go-core/main.go:1053, 1353, 2807` - Unvalidated parameters
  - Security audit: Insufficient input validation
  - Validator library docs

  **Acceptance Criteria**:
  - [ ] All request bodies validated
  - [ ] Pagination limits enforced
  - [ ] Export dimensions capped
  - [ ] Clear validation error messages

  **QA Scenarios**:
  ```
  Scenario: Invalid pagination rejected
    Tool: Bash (curl)
    Preconditions: Server running
    Steps:
      1. curl "http://localhost:8080/photos?limit=1000"
      2. Check response status and error message
    Expected Result: HTTP 400, error "limit must be ≤100"
    Evidence: .sisyphus/evidence/task-20-validation.json
  ```

  **Commit**: YES
  - Message: `security(validation): add comprehensive input validation`
  - Files: `go-core/main.go`, `go-core/go.mod`

### Wave 5: MONITORING & OBSERVABILITY

- [ ] 21. Add Prometheus Metrics

  **What to do**:
  - Install `github.com/gofiber/fiber/v2/middleware/monitor`
  - Expose `/metrics` endpoint for Prometheus scraping
  - Add custom metrics: request duration, active connections, queue depth, cache hit rate
  - Add business metrics: photos uploaded, exports completed, AI requests
  - Configure Prometheus in docker-compose.yml

  **Must NOT do**:
  - Do not expose metrics publicly (internal only)
  - Do not include sensitive data in metrics

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []
  - **Reason**: Metrics instrumentation across codebase

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 5 (with Tasks 22-25)
  - **Blocks**: None
  - **Blocked By**: Wave 4 complete

  **References**:
  - Performance analysis: No monitoring infrastructure
  - Prometheus best practices
  - Fiber monitor middleware docs

  **Acceptance Criteria**:
  - [ ] `/metrics` endpoint returns Prometheus format
  - [ ] Key metrics instrumented (latency, throughput, errors)
  - [ ] Prometheus scrapes metrics successfully
  - [ ] Grafana dashboard displays metrics

  **QA Scenarios**:
  ```
  Scenario: Metrics endpoint accessible
    Tool: Bash (curl)
    Preconditions: Server running
    Steps:
      1. curl http://localhost:8080/metrics
      2. Verify Prometheus format output
      3. Check for key metrics (http_requests_total, etc)
    Expected Result: Valid Prometheus metrics
    Evidence: .sisyphus/evidence/task-21-metrics.txt
  ```

  **Commit**: YES
  - Message: `feat(monitoring): add Prometheus metrics`
  - Files: `go-core/main.go`, `docker-compose.yml`

- [ ] 22. Implement Structured Logging

  **What to do**:
  - Replace fmt.Println with structured logger (`github.com/rs/zerolog`)
  - Add log levels (debug, info, warn, error)
  - Include context in logs (user_id, request_id, trace_id)
  - Configure log output format (JSON for production)
  - Add log sampling for high-volume events

  **Must NOT do**:
  - Do not log sensitive data (passwords, tokens)
  - Do not remove existing error messages

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []
  - **Reason**: Pattern replacement across codebase

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 5 (with Tasks 21, 23-25)
  - **Blocks**: None
  - **Blocked By**: Wave 4 complete

  **References**:
  - `go-core/main.go` - Multiple fmt.Println statements
  - Performance analysis: No structured logging
  - Zerolog documentation

  **Acceptance Criteria**:
  - [ ] All logs use structured logger
  - [ ] Logs include context fields
  - [ ] JSON format in production
  - [ ] No sensitive data in logs

  **QA Scenarios**:
  ```
  Scenario: Logs include request context
    Tool: Bash
    Preconditions: Server running with structured logging
    Steps:
      1. Make authenticated request
      2. Check logs for request_id and user_id
      3. Verify JSON format
    Expected Result: Logs contain context, valid JSON
    Evidence: .sisyphus/evidence/task-22-structured-logs.txt
  ```

  **Commit**: YES
  - Message: `feat(logging): implement structured logging with zerolog`
  - Files: `go-core/main.go`, `go-core/go.mod`

- [ ] 23. Add Distributed Tracing

  **What to do**:
  - Install OpenTelemetry SDK (`go.opentelemetry.io/otel`)
  - Add trace context propagation across services
  - Instrument key operations (DB queries, Redis, MinIO, AI calls)
  - Export traces to Jaeger
  - Add Jaeger service to docker-compose.yml

  **Must NOT do**:
  - Do not add excessive tracing overhead
  - Do not trace sensitive operations

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []
  - **Reason**: Distributed tracing setup

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 5 (with Tasks 21-22, 24-25)
  - **Blocks**: None
  - **Blocked By**: Wave 4 complete

  **References**:
  - Performance analysis: No distributed tracing
  - OpenTelemetry Go docs
  - Jaeger integration guide

  **Acceptance Criteria**:
  - [ ] Traces exported to Jaeger
  - [ ] End-to-end request tracing works
  - [ ] Trace context propagated to Python worker
  - [ ] Jaeger UI shows traces

  **QA Scenarios**:
  ```
  Scenario: Photo upload traced end-to-end
    Tool: Bash
    Preconditions: Jaeger running, tracing enabled
    Steps:
      1. Upload photo via API
      2. Wait for processing to complete
      3. Query Jaeger for trace
      4. Verify spans: upload → queue → worker → callback
    Expected Result: Complete trace with all spans
    Evidence: .sisyphus/evidence/task-23-trace.json
  ```

  **Commit**: YES
  - Message: `feat(tracing): add distributed tracing with OpenTelemetry`
  - Files: `go-core/main.go`, `python-worker/main.py`, `docker-compose.yml`

- [ ] 24. Create Health Check Endpoints

  **What to do**:
  - Add `/health` endpoint (basic liveness check)
  - Add `/health/ready` endpoint (readiness check with dependencies)
  - Check database connectivity, Redis, MinIO availability
  - Return 200 if healthy, 503 if degraded
  - Add health checks to docker-compose.yml

  **Must NOT do**:
  - Do not expose internal system details
  - Do not make health checks expensive

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []
  - **Reason**: Simple endpoint implementation

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 5 (with Tasks 21-23, 25)
  - **Blocks**: None
  - **Blocked By**: Wave 4 complete

  **References**:
  - Performance analysis: No health check endpoints
  - Kubernetes health check patterns

  **Acceptance Criteria**:
  - [ ] `/health` returns 200 when server running
  - [ ] `/health/ready` checks all dependencies
  - [ ] Returns 503 when dependencies unavailable
  - [ ] Docker health checks configured

  **QA Scenarios**:
  ```
  Scenario: Health check passes when healthy
    Tool: Bash (curl)
    Preconditions: All services running
    Steps:
      1. curl http://localhost:8080/health/ready
      2. Check response status and body
    Expected Result: HTTP 200, {"status":"healthy"}
    Evidence: .sisyphus/evidence/task-24-health-check.json
  ```

  **Commit**: YES
  - Message: `feat(health): add health check endpoints`
  - Files: `go-core/main.go`, `docker-compose.yml`

- [ ] 25. Add Graceful Shutdown

  **What to do**:
  - Implement signal handling (SIGTERM, SIGINT)
  - Stop accepting new requests on shutdown signal
  - Wait for in-flight requests to complete (30s timeout)
  - Close database connections gracefully
  - Flush logs and metrics before exit

  **Must NOT do**:
  - Do not terminate active requests immediately
  - Do not lose queued tasks

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []
  - **Reason**: Standard shutdown pattern

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 5 (with Tasks 21-24)
  - **Blocks**: None
  - **Blocked By**: Wave 4 complete

  **References**:
  - Performance analysis: No graceful shutdown
  - Go graceful shutdown patterns
  - Fiber shutdown docs

  **Acceptance Criteria**:
  - [ ] Server handles SIGTERM gracefully
  - [ ] In-flight requests complete before shutdown
  - [ ] Connections closed properly
  - [ ] No data loss on shutdown

  **QA Scenarios**:
  ```
  Scenario: Graceful shutdown completes in-flight requests
    Tool: Bash
    Preconditions: Server running
    Steps:
      1. Start long-running request (export)
      2. Send SIGTERM to server
      3. Verify request completes
      4. Check server exits cleanly
    Expected Result: Request completes, clean exit
    Evidence: .sisyphus/evidence/task-25-graceful-shutdown.txt
  ```

  **Commit**: YES
  - Message: `feat(shutdown): implement graceful shutdown`
  - Files: `go-core/main.go`

### Wave FINAL: VERIFICATION

- [ ] F1. Security Scan and Penetration Test

  **What to do**:
  - Run automated security scanner (gosec for Go, bandit for Python)
  - Verify all CRITICAL and HIGH security issues resolved
  - Test for common vulnerabilities (OWASP Top 10)
  - Verify CSRF protection works
  - Test JWT RS256 implementation
  - Verify rate limiting prevents abuse
  - Check for exposed secrets in code/logs

  **Must NOT do**:
  - Do not perform destructive testing on production data
  - Do not expose findings publicly

  **Recommended Agent Profile**:
  - **Category**: `oracle`
  - **Skills**: []
  - **Reason**: Comprehensive security analysis

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave FINAL (with Tasks F2-F4)
  - **Blocks**: None
  - **Blocked By**: All previous waves complete

  **References**:
  - Security audit findings (13 vulnerabilities)
  - OWASP Top 10: https://owasp.org/www-project-top-ten/
  - gosec: https://github.com/securego/gosec

  **Acceptance Criteria**:
  - [ ] Zero CRITICAL security issues
  - [ ] Zero HIGH security issues
  - [ ] All security tests pass
  - [ ] Security scan report generated

  **QA Scenarios**:
  ```
  Scenario: Automated security scan passes
    Tool: Bash
    Preconditions: gosec and bandit installed
    Steps:
      1. cd go-core && gosec ./...
      2. cd python-worker && bandit -r .
      3. Check for CRITICAL/HIGH findings
    Expected Result: Zero critical/high findings
    Evidence: .sisyphus/evidence/task-f1-security-scan.txt
  ```

  **Commit**: NO

- [ ] F2. Load Testing (100 Concurrent Users)

  **What to do**:
  - Use Apache Bench or k6 for load testing
  - Test 100 concurrent users for 5 minutes
  - Measure response times (p50, p95, p99)
  - Monitor resource usage (CPU, memory, connections)
  - Verify no connection leaks or goroutine leaks
  - Test horizontal scaling (3 Go instances)

  **Must NOT do**:
  - Do not test against production data
  - Do not exceed infrastructure capacity

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []
  - **Reason**: Load testing and analysis

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave FINAL (with Tasks F1, F3-F4)
  - **Blocks**: None
  - **Blocked By**: All previous waves complete

  **References**:
  - Performance analysis: Target 100 concurrent users
  - Definition of Done: <50ms p95 query performance

  **Acceptance Criteria**:
  - [ ] System handles 100 concurrent users
  - [ ] p95 response time <200ms
  - [ ] Zero errors under load
  - [ ] No resource leaks

  **QA Scenarios**:
  ```
  Scenario: 100 concurrent users for 5 minutes
    Tool: Bash (k6)
    Preconditions: All services running, test data loaded
    Steps:
      1. k6 run --vus 100 --duration 5m load-test.js
      2. Monitor metrics during test
      3. Check for errors or timeouts
      4. Verify resource cleanup after test
    Expected Result: <1% error rate, p95 <200ms
    Evidence: .sisyphus/evidence/task-f2-load-test.txt
  ```

  **Commit**: NO

- [ ] F3. Integration Test Suite

  **What to do**:
  - Create comprehensive integration tests covering all critical paths
  - Test authentication flow (register, login, refresh, logout)
  - Test photo upload → processing → retrieval flow
  - Test export workflow end-to-end
  - Test SSE event delivery across instances
  - Test error scenarios and edge cases
  - Run all tests with race detector

  **Must NOT do**:
  - Do not skip error path testing
  - Do not use production credentials

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []
  - **Reason**: Comprehensive test coverage

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave FINAL (with Tasks F1-F2, F4)
  - **Blocks**: None
  - **Blocked By**: All previous waves complete

  **References**:
  - Bug analysis: 18 bugs fixed
  - Existing tests: `python-worker/tests/integration_test.py`

  **Acceptance Criteria**:
  - [ ] All critical paths covered by tests
  - [ ] All tests pass
  - [ ] Race detector passes
  - [ ] Test coverage >70%

  **QA Scenarios**:
  ```
  Scenario: Integration test suite passes
    Tool: Bash
    Preconditions: All services running
    Steps:
      1. go test -race ./... -v
      2. python tests/integration_test.py
      3. Check test results
    Expected Result: All tests pass, no race conditions
    Evidence: .sisyphus/evidence/task-f3-integration-tests.txt
  ```

  **Commit**: NO

- [ ] F4. Production Readiness Checklist

  **What to do**:
  - Verify all "Must Have" items from plan implemented
  - Verify all "Must NOT Have" guardrails respected
  - Check all environment variables documented
  - Verify secrets not hardcoded
  - Check all endpoints have proper error handling
  - Verify monitoring and logging operational
  - Review docker-compose.yml for production readiness
  - Create deployment checklist document

  **Must NOT do**:
  - Do not skip any checklist items
  - Do not approve if critical issues remain

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []
  - **Reason**: Comprehensive readiness review

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave FINAL (with Tasks F1-F3)
  - **Blocks**: None
  - **Blocked By**: All previous waves complete

  **References**:
  - Work Objectives: Must Have / Must NOT Have lists
  - Definition of Done checklist

  **Acceptance Criteria**:
  - [ ] All "Must Have" items present
  - [ ] All "Must NOT Have" items absent
  - [ ] All environment variables documented
  - [ ] Deployment checklist created

  **QA Scenarios**:
  ```
  Scenario: Production readiness checklist complete
    Tool: Bash
    Preconditions: All tasks complete
    Steps:
      1. Review codebase for hardcoded secrets
      2. Verify .env.example complete
      3. Check all endpoints have error handling
      4. Verify monitoring endpoints accessible
    Expected Result: All checklist items pass
    Evidence: .sisyphus/evidence/task-f4-readiness-checklist.md
  ```

  **Commit**: NO

---

## Commit Strategy

**Wave 1 (5 commits)**:
- `security(auth): enforce strong JWT secret on startup`
- `security(db): replace SQL string concatenation with parameterized queries`
- `security(rbac): implement explicit role whitelist checks`
- `security(csrf): add CSRF protection to state-changing operations`
- `security(jwt): migrate from HS256 to RS256 signing`

**Wave 2 (5 commits)**:
- `fix(sse): prevent panic on closed channel send`
- `fix(worker): ensure MinIO connections always released`
- `fix(auth): handle crypto errors in token generation`
- `fix(auth): atomic login history cleanup`
- `fix(errors): add comprehensive error handling and logging`

**Wave 3 (5 commits)**:
- `perf(db): add indexes on frequently-queried columns`
- `perf(db): eliminate N+1 queries with eager loading`
- `perf(cache): implement Redis caching for static data`
- `perf(admin): optimize dashboard queries with aggregations`
- `perf(db): configure connection pool for optimal performance`

**Wave 4 (5 commits)**:
- `feat(sse): migrate to Redis pub/sub for horizontal scaling`
- `perf(worker): implement worker pool for parallel processing`
- `security(rate-limit): add rate limiting to all endpoints`
- `security(secrets): implement JWT key rotation with grace period`
- `security(validation): add comprehensive input validation`

**Wave 5 (5 commits)**:
- `feat(monitoring): add Prometheus metrics`
- `feat(logging): implement structured logging with zerolog`
- `feat(tracing): add distributed tracing with OpenTelemetry`
- `feat(health): add health check endpoints`
- `feat(shutdown): implement graceful shutdown`

**Total: 25 commits** (one per task, Final Verification tasks don't commit)

---

## Success Criteria

### Verification Commands

```bash
# Security verification
gosec ./go-core/...
bandit -r python-worker/

# Bug verification
go test -race ./go-core/...
python python-worker/tests/integration_test.py

# Performance verification
psql -c "EXPLAIN ANALYZE SELECT * FROM photos WHERE user_id = 1 LIMIT 20"
ab -n 1000 -c 100 http://localhost:8080/photos

# Monitoring verification
curl http://localhost:8080/metrics
curl http://localhost:8080/health/ready

# Load testing
k6 run --vus 100 --duration 5m load-test.js
```

### Final Checklist

**Security (13 issues → 0)**:
- [ ] No weak JWT secrets (enforced on startup)
- [ ] No SQL injection vulnerabilities
- [ ] Explicit RBAC with whitelists
- [ ] CSRF protection on all state-changing operations
- [ ] JWT uses RS256 asymmetric signing
- [ ] Rate limiting on all endpoints
- [ ] Secrets rotation mechanism implemented
- [ ] Comprehensive input validation

**Bugs (18 issues → 0)**:
- [ ] SSE channel race condition fixed
- [ ] MinIO connection leaks fixed
- [ ] Crypto error handling added
- [ ] Login history race condition fixed
- [ ] All goroutines have error handling
- [ ] No silent failures

**Performance**:
- [ ] Database indexes added (5+ indexes)
- [ ] N+1 queries eliminated
- [ ] Redis caching implemented
- [ ] Dashboard queries optimized
- [ ] Connection pooling configured
- [ ] Query performance <50ms p95
- [ ] System handles 100 concurrent users

**Scalability**:
- [ ] SSE uses Redis pub/sub (stateless)
- [ ] Python worker pool (3-5 workers)
- [ ] Horizontal scaling tested (3+ instances)

**Observability**:
- [ ] Prometheus metrics exposed
- [ ] Structured logging implemented
- [ ] Distributed tracing operational
- [ ] Health check endpoints functional
- [ ] Graceful shutdown implemented

**Production Readiness**:
- [ ] All environment variables documented
- [ ] No hardcoded secrets
- [ ] Monitoring dashboards operational
- [ ] Load testing passed
- [ ] Integration tests pass
- [ ] Security scan clean


