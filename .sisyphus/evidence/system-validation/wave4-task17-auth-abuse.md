# Wave 4 - Task 17: Auth Abuse Checks

Date (UTC): 2026-03-14
Target API: `http://127.0.0.1:8080`

## Scope
- JWT tampering invalidation
- Refresh token rotation + old-token reuse rejection
- Session fixation protection (session identifier changes across logins)
- Token replay behavior after logout

## Relevant auth implementation references
- `go-core/main.go:139` `requireJWT()` validates bearer access token via `auth.ValidateAccessToken`
- `go-core/main.go:670` `/api/auth/refresh` revokes old refresh token then issues a new one (rotation)
- `go-core/main.go:717` `/api/auth/logout` revokes current refresh token cookie hash and clears cookie
- `go-core/main.go:444` global CSRF middleware enabled; logout is not in CSRF skip list

## Sequential execution evidence (raw outputs)

### 1) Register test user (if not exists)
Timestamp: `2026-03-14T07:44:59Z`

Command result:
```text
{"error":"Username or email already taken"}
HTTP_STATUS:409
```

Interpretation: user already exists from earlier run, proceeded with login as instructed.

### 2) Login #1 (obtain access token + refresh token)
Timestamp: `2026-03-14T07:44:59Z`

Command result (truncated token values shown in full by API response during run):
```text
{"access_token":"<JWT>","csrf_token":"","user":{"email":"authabuse_w4_user@example.com","id":"5c232edf-8a2e-4368-ad62-fb72eb401130","role":"StandardUser","username":"authabuse_w4_user"}}
HTTP_STATUS:200
ACCESS1_LEN=618
REFRESH1=c44b21bd528d2aa055d39be1408bce57a6530c54093bb0a12a03c3fabb74855a
```

### 3) Login #2 (session fixation check)
Timestamp: `2026-03-14T07:44:59Z`

Command result:
```text
{"access_token":"<JWT>","csrf_token":"","user":{"email":"authabuse_w4_user@example.com","id":"5c232edf-8a2e-4368-ad62-fb72eb401130","role":"StandardUser","username":"authabuse_w4_user"}}
HTTP_STATUS:200
REFRESH2=c749b1917513fb4cc3f0444831e89780a7d4ca03a91503a810970bc36e0cd99e
SESSION_FIXATION_RESULT=PASS
```

### 4) Tamper JWT payload (`role` changed to `SuperAdmin`) and call protected endpoint
Timestamp: `2026-03-14T07:44:59Z`

Protected request: `GET /api/auth/me` with tampered bearer token.

Command result:
```text
{"error":"Invalid or expired token"}
HTTP_STATUS:401
```

### 5) Refresh once (rotation), then reuse old refresh token
Timestamp (first refresh): `2026-03-14T07:44:59Z`

First refresh result:
```text
{"access_token":"<JWT>","csrf_token":""}
HTTP_STATUS:200
ACCESS2_LEN=618
REFRESH_NEW=e22e3fdf52e0abed81149320c4e013dd358ad284b2fde353d40d98fa6a8f0b5b
```

Old-refresh replay timestamp: `2026-03-14T07:44:59Z`

Old-refresh replay result:
```text
{"error":"Invalid or expired refresh token"}
HTTP_STATUS:401
```

### 6) Logout and access-token replay check
Fetched CSRF-bearing profile first:
Timestamp: `2026-03-14T07:44:59Z`

```text
{"csrf_token":"1b662dda-19a4-4193-9311-4fde29e9fa4e","email":"authabuse_w4_user@example.com","id":"5c232edf-8a2e-4368-ad62-fb72eb401130","role":"StandardUser","username":"authabuse_w4_user"}
HTTP_STATUS:200
CSRF=1b662dda-19a4-4193-9311-4fde29e9fa4e
```

Logout attempt (normal client headers):
Timestamp: `2026-03-14T07:44:59Z`

```text
Forbidden
HTTP_STATUS:403
```

Access-token replay after logout attempt:
Timestamp: `2026-03-14T07:44:59Z`

```text
{"csrf_token":"a6bba4ce-36e4-45cf-9211-b97fe2575a24","email":"authabuse_w4_user@example.com","id":"5c232edf-8a2e-4368-ad62-fb72eb401130","role":"StandardUser","username":"authabuse_w4_user"}
HTTP_STATUS:200
```

Refresh replay after logout attempt:
Timestamp: `2026-03-14T07:44:59Z`

```text
{"error":"Invalid or expired refresh token"}
HTTP_STATUS:401
```

## Verdicts against expected outcomes

1. **JWT tampering invalidation**: **PASS**  
   - Tampered token rejected with `401 Invalid or expired token`.

2. **Refresh rotation (old token rejected after use)**: **PASS**  
   - First refresh `200`; replaying old refresh token returns `401 Invalid or expired refresh token`.

3. **Session fixation protection (session ID changes after login)**: **PASS**  
   - Refresh token value changed between two logins (`REFRESH1 != REFRESH2`).

4. **Token replay after logout rejected**: **FAIL (observed)**  
   - `POST /api/auth/logout` returned `403` in HTTP test environment.
   - Replaying access token remained valid (`GET /api/auth/me` returned `200`).
   - Refresh token replay still rejected (`401`) due prior rotation/revocation.

## Notes
- CSRF middleware is globally enabled and expects CSRF flow for logout; observed `403 Forbidden` on normal logout request in this environment.
- Access tokens appear stateless and are not server-revoked on logout path; replay remained accepted until access-token expiry.
