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
