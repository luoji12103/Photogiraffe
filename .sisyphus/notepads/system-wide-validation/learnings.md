# System-Wide Validation - Learnings

## [2026-03-10T01:36:00Z] Initial Discovery

### Stack Status
- All 7 services running (postgres, redis, minio, go-core, python-worker, frontend, nginx)
- Containers have been up for 2-11 days (stable baseline)

### Health Endpoints
- Direct go-core health: `http://localhost:8080/health` → 200 ✅
- Nginx-proxied health: `http://localhost/health` → 502 ❌
- Nginx can reach go-core internally (verified via `docker exec`)

### Auth Surface
- Protected route `/photos` correctly returns 401 without token
- Auth routes: register, login, refresh, logout, me all mapped
- JWT middleware: `requireJWT()` enforces Bearer token
- Internal routes: `requireInternalSecret()` checks X-Internal-Secret header

### Test Infrastructure
- Go: `go test ./...`, `go test -race ./...` available
- Python: `tests/integration_test.py` (299/301 passing per HANDOFF.md)
- Frontend: `npm run lint`, `npx tsc --noEmit`, `npm run build`
- Missing: Go integration tests, Python unit tests, frontend unit/E2E tests

### Nginx 502 Root Cause Hypothesis
- Upstream `go_core` resolves correctly (ping succeeds)
- Direct upstream fetch works (`wget http://go-core:8080/health` from nginx container)
- Issue likely: nginx config not reloaded after go-core restart, or transient race condition
- Next: Check nginx error logs, verify config reload
## [2026-03-10T01:40:30Z] Wave 1 Complete

### Task 1: Compose bring-up + health contract - ✅ PASS
- All 7 services running
- Direct health check: 200 OK
- Nginx proxy health: 200 OK (after reload to clear DNS cache)
- Protected routes: 401 without auth (correct)

### Root Cause Fixed: Nginx 502
- Issue: Stale DNS cache in nginx container
- Fix: `docker exec photogiraffe-nginx nginx -s reload`
- Permanent solution: Add resolver directive or use IP-based upstream

### Evidence
- Documented at: .sisyphus/evidence/system-validation/wave1-task1-health.md

