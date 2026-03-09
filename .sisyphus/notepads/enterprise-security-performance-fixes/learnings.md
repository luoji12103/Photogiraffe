# Learnings - Enterprise Security & Performance Fixes

This file tracks conventions, patterns, and insights discovered during implementation.

---

## [2026-03-09T13:24:00Z] Pre-Implementation Analysis

### SQL Injection Patterns Found
- **Line 1353**: `dominant_colors::text ILIKE ?` with string concatenation `"%\""+colorBucket+"\"%"`
- **Lines 4287-4337**: Dashboard stats queries concatenate `uidCond` variable into SQL strings
  - Recent uploads, top cameras, top lenses, color spaces queries
  - Pattern: `database.DB.Raw(sql + uidCond, uidArgs...)`

### RBAC Issues Found
- **44 instances** of negative role checks: `role != "SuperAdmin"`
- Vulnerable to unknown role values bypassing checks
- Positive pattern exists at lines 126-134: `requireRole()` middleware with whitelist

### CSRF Integration Points
- **60+ state-changing routes** need CSRF protection
- **11 internal endpoints** exempt (use X-Internal-Secret)
- **4 auth endpoints** should issue CSRF tokens: register, login, refresh, me
- **50+ frontend API routes** need CSRF middleware

### Code Patterns
- Go backend uses Fiber v2 framework
- GORM for database operations
- JWT authentication with access + refresh tokens
- Internal endpoints use X-Internal-Secret header validation


## [2026-03-09T13:31:20Z] JWT Secret Hardening (Task 1)
- Removed insecure fallback JWT secret in `go-core/auth/jwt.go`; signing key now always comes from `JWT_SECRET`.
- Added fail-fast startup validation in `go-core/main.go`: empty `JWT_SECRET` -> fatal exit; length <32 -> fatal exit.
- Kept JWT claims/token format unchanged; `go test ./auth` confirms token generation/validation behavior remains compatible when valid secret is present.

## [2026-03-09T13:56:00Z] SQL Injection Hardening (Task 2)
- Replaced SQL condition-string concatenation in `/api/stats` with GORM query-builder branching (`isSuperAdmin` + conditional `Where`) to preserve role-based result semantics without dynamic SQL assembly.
- Updated ILIKE filters to parameterized SQL-side wildcard composition (`ILIKE '%' || ? || '%'`) for `search`, `color_bucket`, smart album tag/camera/color rules, and enhanced search camera/lens/color/q filters.
- Replaced date suffix concatenation patterns with parameterized SQL composition (`(? || ' 23:59:59')`) in map filter, smart album `date_range`, and enhanced search `date_to` filters.
- Added `gocritic` with `sqlQuery` check in `go-core/.golangci.yml` to strengthen static detection of risky SQL construction alongside existing gosec G201/G202 rules.
- Repository grep verification for SQL query-string concatenation patterns now returns no matches.

## [2026-03-09T14:01:00Z] RBAC Explicit Whitelist (Task 3)
- Replaced all 44 negative role checks (`role != "SuperAdmin"`) with positive whitelist pattern
- Pattern: `if role == "SuperAdmin" || condition { } else { return forbidden }`
- Eliminates implicit allow-by-default vulnerability where unknown role values could bypass checks
- All authorization points now explicitly check for allowed roles before granting access
- Build passes with zero syntax errors, logic inversion verified correct

## [2026-03-09T14:06:00Z] RBAC Role Check Normalization Follow-up (Task 3)
- Confirmed `requireRole` middleware (lines 126-134) already implements allow-list checks and rejects unknown roles with 403.
- Confirmed `go-core/main.go` now contains zero `role != "SuperAdmin"` occurrences; checks are expressed as explicit allow conditions with deny-by-default fallback.
- Verified `go test ./...` passes after formatting, preserving existing behavior while tightening role-check semantics.

## [2026-03-09T14:28:00Z] JWT RS256 Migration (Task 5)
- Added `go-core/auth/keymanager.go` with RSA key loading (PKCS#8 preferred, PKCS#1 fallback), singleton initialization, and JWKS generation (`kty/use/alg/kid/n/e`).
- Migrated access token signing from HS256 to RS256 in `go-core/auth/jwt.go` while preserving claims format (`uid`, `username`, `role`, registered claims).
- Implemented validation compatibility window: RS256 validation via public key; HS256 fallback gated by `JWT_HS256_GRACE_UNTIL` (RFC3339) for migration grace period.
- Added `GET /api/auth/jwks.json` in `go-core/main.go` and startup key initialization fail-fast (`auth.InitKeys()`).
- Added `.gitignore` protection for `go-core/keys/*.pem`; updated `.env.example` with RSA key paths, key generation commands, `JWT_KEY_ID`, and grace-window configuration.

## [2026-03-09T14:21:00Z] CSRF Protection (Task 4)
- Added Fiber v2 CSRF middleware with Double Submit Cookie pattern
- Configuration: `__Host-csrf_` cookie, 30min expiration, header lookup `X-Csrf-Token`
- Exempted internal endpoints (X-Internal-Secret header) and auth endpoints (login, register, refresh, forgot/reset password)
- Frontend: AuthContext fetches CSRF token after login, stores in memory, includes in POST/PUT/DELETE via authFetch
- CORS updated to allow X-Csrf-Token header

## [2026-03-09T14:21:00Z] JWT RS256 Migration (Task 5)
- Generated RSA 2048-bit key pair in go-core/keys/ (jwt-private.pem, jwt-public.pem)
- Created auth/keymanager.go: loads keys with path fallback logic, generates JWKS format
- Updated auth/jwt.go: GenerateAccessToken uses RS256, ValidateAccessToken accepts both RS256 and HS256 (grace period)
- Grace period: 7 days from JWT_RS256_DEPLOYED_AT or JWT_HS256_GRACE_UNTIL env var
- Added JWKS endpoint: GET /api/auth/jwks.json returns public key in RFC 7517 format
- Added go-core/keys/*.pem to .gitignore to prevent committing private keys

## [2026-03-09T14:40:00Z] SSE Hub Race/Panic Hardening (Task 6)
- Reworked SSE hub storage to `map[uint][]*sseClient`, where each client tracks channel lifecycle with `atomic.Bool` (`closed`) plus buffered channel.
- Added `sseClient.send()` guard + `defer/recover` so concurrent broadcasts to recently-closed channels are ignored safely instead of panicking.
- Added `sseClient.close()` with `CompareAndSwap(false, true)` to guarantee idempotent close and prevent double-close panics during concurrent unsubscribe paths.
- Kept SSE external API unchanged (`sseSubscribe`/`sseUnsubscribe` still use `chan string`) while internally mapping channel→client for atomic state checks and graceful cleanup.
- Verification: `go test -race ./...` passed and `go build .` passed in `go-core`.


## [2026-03-09T14:35:23Z] Login History TOCTOU Cleanup Fix (Task 9)
- Replaced multi-step `Find` + per-row `Delete` cleanup in `recordLoginHistory` with one SQL statement via `database.DB.Exec`, eliminating race windows between selection and deletion under concurrent logins.
- Cleanup now atomically deletes all rows for a user beyond the newest 10 using `ORDER BY created_at DESC OFFSET 10`, preserving the existing 10-record retention policy exactly.

## [2026-03-09T14:35:40Z] Password Reset Crypto Error Handling (Task 8)
- Added explicit error handling for  in forgot-password token generation path in .
- On CSPRNG failure, handler now logs contextual error ( + error) and returns HTTP 500 with existing JSON error shape ().
- Token size/format and reset flow semantics remain unchanged on success path.

## [2026-03-09T14:35:57Z] Password Reset Crypto Error Handling (Task 8)
- Added explicit error handling for rand.Read(rawBytes) in forgot-password token generation path in go-core/main.go.
- On CSPRNG failure, handler now logs contextual error (email + error) and returns HTTP 500 with existing JSON error shape ({"error": "Failed to generate reset token"}).
- Token size/format and reset flow semantics remain unchanged on success path.

## Task 10: Goroutine Error Handling & Panic Recovery

### Changes Made
1. **Panic Recovery Middleware**: Added Fiber's recover middleware with stack trace logging
   - Import alias: `fiberrecover` to avoid conflict with builtin `recover`
   - Logs panic details: path, method, panic value
   
2. **Goroutine Error Handling**: Wrapped all goroutines with defer/recover
   - Lines 588, 592, 611: `recordLoginHistory` goroutines (3 instances)
   - Line 884: `sendEmail` goroutine with error logging
   - Pattern: Capture variables as function params to avoid closure issues

3. **Structured Logging**: Added error logging to `createNotification`
   - Logs userID, notification type, and DB errors
   - Silent failures now visible in logs

### Key Patterns
```go
// Goroutine with panic recovery
go func(uid uint, ip, ua string) {
    defer func() {
        if r := recover(); r != nil {
            log.Printf("[goroutine panic] funcName: %v", r)
        }
    }()
    doWork(uid, ip, ua)
}(capturedVars...)
```

### Verification
- `go build` passes without errors
- All goroutines now have panic recovery
- Database errors in createNotification are logged

## [2026-03-09T14:42:00Z] Python Worker MinIO Connection Cleanup (Task 7)
- Wrapped every `minio_client.get_object(...)` read path in `python-worker/main.py` with guarded handle pattern (`response = None`/`resp = None`) plus `try/finally`.
- Standardized deterministic release in `finally` via `close()` + `release_conn()` for process image, AI analysis, watermark loading, export image download, album export proxy/raw fallback, and infer-params download paths.
- In proxy→raw fallback path, added explicit cleanup of partially opened proxy response before opening raw object to avoid duplicate live sockets under exception path.
- Verification run: `python -m py_compile python-worker/main.py` passed after changes.
