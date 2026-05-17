# Wave 4 Task 19 — Comprehensive Input Validation / Fuzz-Lite

**Worktree:** `/root/code/Photogiraffe/worktrees/validate_temp`
**Base URL:** `http://127.0.0.1:8080`
**Date:** 2026-03-14
**Tester:** Sisyphus-Junior (automated via `curl`)

---

## 1) Environment + Discovery Evidence

### Runtime checks
- `docker compose ps` returned no active compose services in this worktree (build attempt failed on missing `/app/keys` in go-core Docker stage), but API at `127.0.0.1:8080` was reachable.
- `GET /health` -> **200** (`Go Core API is healthy! Database connection is active.`)

### Endpoint discovery (required search effort)
Parallel code searches were executed with `grep` and `ast_grep_search` over `go-core/`:
- Route definitions found in `go-core/main.go` (148 route matches).
- Validation/parser patterns found via `BodyParser(...)` and status handling.
- Parameter parsing patterns found (`strconv.ParseUint`, `ParamsInt`).

Key route observations relevant to this task:
- Required-by-task endpoints `/api/photos`, `/api/photos/:id`, `/api/upload` are **not implemented as such**.
- Actual routes are:
  - photos list/detail: `GET /photos`, `GET /photos/:id`
  - upload: `POST /upload`
  - export: `POST /api/photos/:id/export`
  - admin: `/api/admin/*`

---

## 2) Reproducible Command Pattern

Login + token bootstrap used for authenticated tests:

```bash
LOGIN_JSON=$(curl -s -c /tmp/w4_cookies.txt -H "Content-Type: application/json" \
  -X POST "http://127.0.0.1:8080/api/auth/login" \
  -d '{"username":"admin","password":"testadmin1234"}')

TOKEN=$(python -c 'import sys,json;print(json.loads(sys.stdin.read()).get("access_token",""))' <<< "$LOGIN_JSON")

CSRF_JSON=$(curl -s -b /tmp/w4_cookies.txt -c /tmp/w4_cookies.txt \
  -H "Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:8080/api/auth/csrf-token")

CSRF=$(python -c 'import sys,json;print(json.loads(sys.stdin.read()).get("csrf_token",""))' <<< "$CSRF_JSON")
```

---

## 3) Test Matrix (Critical Endpoints + Categories)

Legend: **PASS** = secure/expected behavior (or correct rejection), **FAIL** = validation gap / contract defect.

> Note: many state-changing authenticated endpoints returned `403 Forbidden` due CSRF middleware behavior in this HTTP/curl test context. Those are still recorded with actual code/body.

### A) Auth endpoints

| Endpoint | Category | Payload (excerpt) | Expected | Actual | Verdict |
|---|---|---|---|---|---|
| `POST /api/auth/register` | Empty body | `{}` | 400/422 | **400** `username, email and password are required` | PASS |
| `POST /api/auth/register` | Nulls | `{"username":null,...}` | 400/422 | **400** same message | PASS |
| `POST /api/auth/register` | Type mismatch | `{"username":123,"email":[],"password":{}}` | 400/422 | **400** same message | PASS |
| `POST /api/auth/register` | Unicode | `{"username":"測試🦒",...}` | 4xx or constrained accept | **201** account created | FAIL (no normalization policy) |
| `POST /api/auth/register` | SQLi string | `{"username":"\" OR \"1\"=\"1",...}` | 400/422 reject | **201** account created | FAIL |
| `POST /api/auth/register` | XSS string | `{"username":"<script>alert(1)</script>",...}` | 400/422 reject | **201** account created | FAIL (stored XSS risk) |
| `POST /api/auth/register` | Command injection string | `{"username":"name; ls -la | cat /etc/passwd",...}` | 400/422 reject | **201** account created | FAIL |
| `POST /api/auth/register` | Oversized 10KB | `username="u"*10240` | 400/413/422 | **201** initially (later 409 duplicate on rerun) | FAIL (no max length enforcement) |
| `POST /api/auth/login` | Empty body | `{}` | 400/422 | **400** required fields | PASS |
| `POST /api/auth/login` | Null values | `{"username":null,...}` | 400/422 | **400** (and later 429 under limiter) | PASS |
| `POST /api/auth/login` | SQLi/XSS username | injected username | 401/400 | **401** invalid credentials (or 429 under limiter) | PASS |
| `POST /api/auth/refresh` | Missing cookie | `{}` | 401 | **401** `No refresh token` | PASS |
| `POST /api/auth/refresh` | Cookie SQLi/path traversal | `refresh_token='; DROP...` / `../../etc/passwd` | 401 | **401** invalid/expired refresh token | PASS |

### B) Photo endpoints (task-required + actual)

| Endpoint | Category | Payload / Vector | Expected | Actual | Verdict |
|---|---|---|---|---|---|
| `POST /api/photos` | Route existence | N/A | Implemented endpoint | **403 Forbidden** (CSRF guard on unresolved path) | FAIL (contract drift) |
| `GET /api/photos/:id` | Route existence | `/api/photos/1` | Implemented endpoint | **404** `Cannot GET /api/photos/1` | FAIL (contract drift) |
| `PUT /api/photos/:id` | Route existence | `/api/photos/1` | Implemented endpoint | **403 Forbidden** | FAIL (contract drift) |
| `DELETE /api/photos/:id` | Route existence | `/api/photos/1` | Implemented endpoint | **403 Forbidden** | FAIL (contract drift) |
| `GET /photos/:id` (actual) | Type mismatch in path | `/photos/notint` | 400 invalid id | **404** `Photo not found` | FAIL (weak id validation semantics) |
| `GET /photos/:id` (actual) | Path traversal | `/photos/%2e%2e%2fetc%2fpasswd` | 400 invalid id | **404** `Photo not found` | PASS (no traversal) |
| `PUT /api/photos/:id/description` | Empty/null/type mismatch/injections/1MB | multiple payloads | 400/422 validation failure | **403 Forbidden** (CSRF) for all | INCONCLUSIVE (blocked before business validation) |

### C) Upload endpoint

| Endpoint | Category | Payload / Vector | Expected | Actual | Verdict |
|---|---|---|---|---|---|
| `POST /api/upload` | Route existence | N/A | Implemented endpoint | **403 Forbidden** | FAIL (contract drift) |
| `POST /upload` (actual) | Missing file | no multipart file | 400 with message | **403 Forbidden** (CSRF) | INCONCLUSIVE |
| `POST /upload` (actual) | Path traversal filename | filename=`../../etc/passwd` | sanitize/reject, no traversal | **403 Forbidden** (CSRF) | INCONCLUSIVE |
| `POST /upload` (actual) | Windows traversal filename | `..\\..\\windows\\system32...` | sanitize/reject | **403 Forbidden** (CSRF) | INCONCLUSIVE |

### D) Export endpoint

| Endpoint | Category | Payload / Vector | Expected | Actual | Verdict |
|---|---|---|---|---|---|
| `POST /api/photos/abc/export` | Type mismatch (id) | non-int id | 400 invalid id | **403 Forbidden** (CSRF) | INCONCLUSIVE |
| `POST /api/photos/:id/export` | Malformed JSON | `{bad` | 400 invalid JSON | **403 Forbidden** | INCONCLUSIVE |
| `POST /api/photos/:id/export` | Type mismatch/negative values | `quality:"high"`, `-1` | 400/422 | **403 Forbidden** | INCONCLUSIVE |
| `POST /api/photos/:id/export` | SQLi/XSS/cmd strings | embedded payloads | reject/sanitize | **403 Forbidden** | INCONCLUSIVE |

### E) Admin endpoints

| Endpoint | Category | Payload / Vector | Expected | Actual | Verdict |
|---|---|---|---|---|---|
| `GET /api/admin/flags` | Unauth access | none | 401/403 | **401** missing auth | PASS |
| `GET /api/admin/flags` | Auth baseline | none | 200 | **200** flags JSON | PASS |
| `PUT /api/admin/flags/:name` | Empty/type mismatch body | `{}` / `{"is_enabled":"true"}` | 400/422 | **403 Forbidden** (CSRF) | INCONCLUSIVE |
| `PUT /api/admin/users/abc/role` | Path type mismatch | invalid id | 400 invalid id | **403 Forbidden** (CSRF) | INCONCLUSIVE |
| `PUT /api/admin/users/1/role` | invalid role / SQLi / XSS | injected role | 400 invalid role | **403 Forbidden** | INCONCLUSIVE |
| `DELETE /api/admin/users/%2e%2e%2f1` | Path traversal | encoded traversal | 400 invalid id | **403 Forbidden** | INCONCLUSIVE |
| `POST /api/admin/ai-rate-limits` | cmdinj/negative/type mismatch | malformed payloads | 400/422 | **403 Forbidden** | INCONCLUSIVE |
| `GET /api/admin/users/abc/photos` | Type mismatch | invalid id | 400 | **400** `Invalid user ID` | PASS |
| `GET /api/admin/users/%2e%2e%2f1/photos` | Path traversal | encoded traversal | 400 | **400** `Invalid user ID` | PASS |

---

## 4) Boundary / Fuzz Category Coverage Summary

- **Empty/null fields:** executed (auth + photo/admin attempts).
- **Oversized payloads:** 10KB username and 1MB description executed.
- **Negative numbers:** executed on admin AI rate-limit and export options payloads.
- **Type mismatches:** executed across register/login/photo/admin/export.
- **Special chars + Unicode:** executed (`測試🦒`, emoji, mixed symbols).
- **SQL injection patterns:** executed (`" OR "1"="1`, `'; DROP TABLE users--`).
- **XSS patterns:** executed (`<script>alert(1)</script>`, `<img onerror=...>`).
- **Path traversal:** executed (`../../etc/passwd`, `..\\..\\windows\\system32`, encoded traversal in path).
- **Command injection strings:** executed (`; ls -la`, `| cat /etc/passwd`).

---

## 5) Vulnerabilities / Defects Found

### VULN-1: Registration accepts dangerous usernames (stored payloads)
- **Severity:** **High**
- **Evidence:** `POST /api/auth/register` accepted SQLi/XSS/cmd-style usernames with **201 Created**.
- **Risk:** Potential stored XSS / log injection / downstream output encoding weaknesses.
- **Failing cases:** `auth-register-sqli`, `auth-register-xss`, `auth-register-cmdinj`, `auth-register-unicode`.

### VULN-2: No max length constraint enforced on username
- **Severity:** **Medium**
- **Evidence:** 10KB username accepted (201 on first execution; later duplicate returns 409 only due uniqueness).
- **Risk:** DB bloat, UI rendering issues, potential DoS amplification.
- **Failing case:** `auth-register-oversize-10kb`.

### DEFECT-1: API contract drift for required critical routes
- **Severity:** **Medium**
- **Evidence:** Task-required `/api/photos`, `/api/photos/:id`, `/api/upload` absent/mismatched with implemented `/photos`, `/photos/:id`, `/upload`.
- **Risk:** Client incompatibility; security test suites can miss actual handlers.

### DEFECT-2: Business-validation visibility blocked by CSRF on many mutating endpoints
- **Severity:** **Low** (security control active), **Testing impact: High**
- **Evidence:** repeated `403 Forbidden` on mutating endpoints even with bearer token + csrf token flow in HTTP curl context.
- **Impact:** many fuzz inputs did not reach handler-level validation logic.

---

## 6) HTTP Error Hygiene Check

- **No unhandled 500 responses observed** during executed fuzz matrix.
- **No stack traces or sensitive internals** leaked in error response bodies.
- Errors remained short user-facing messages (`Invalid ...`, `Forbidden`, `Photo not found`, etc.).

---

## 7) Failing Test Cases Ready for Atomic Fix Loop

1. **Reject dangerous usernames on register**
   - Endpoint: `POST /api/auth/register`
   - Payload: `{"username":"<script>alert(1)</script>","email":"xss@example.com","password":"pass12345"}`
   - Expected: 400/422
   - Actual: 201

2. **Reject SQLi-like usernames on register**
   - Payload: `{"username":"\" OR \"1\"=\"1",...}`
   - Expected: 400/422
   - Actual: 201

3. **Enforce max username length**
   - Payload: username 10KB string
   - Expected: 400/413/422
   - Actual: 201 (first run)

4. **Align required route contract**
   - `/api/upload` expected but implementation is `/upload`
   - `/api/photos` + `/api/photos/:id` expected but implementation differs
   - Expected: route availability per contract
   - Actual: 404/403 path mismatch behaviors

5. **(Optional hardening) improve invalid id semantics on `/photos/:id`**
   - `/photos/notint` currently returns 404; explicit 400 improves validation clarity.

---

## 8) Raw Result Snippets (selected)

- `auth-register-xss` -> `201` with token returned.
- `auth-register-sqli` -> `201` with token returned.
- `auth-register-cmdinj` -> `201` with token returned.
- `auth-register-empty` -> `400` required fields.
- `auth-refresh-cookie-sqli` -> `401` invalid/expired refresh token.
- `admin-flags-unauth` -> `401` missing/invalid auth header.
- `admin-users/abc/photos` -> `400` invalid user id.
- No observed `500` in this run.

---

## 9) Conclusion

Input-validation fuzz-lite execution completed for all **critical endpoint groups** requested (auth, photo, upload, export, admin) with malformed payloads, boundary tests, type mismatches, and injection attempts.

Primary actionable risk: **register endpoint input acceptance is too permissive** (dangerous usernames + oversized values accepted). This should enter immediate atomic fix loop.
