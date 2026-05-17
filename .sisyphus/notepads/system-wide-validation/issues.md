# System-Wide Validation - Issues

## [2026-03-10T01:36:00Z] Wave 1 Blockers

### Issue 1: Nginx 502 on /health proxy
- **Symptom**: `curl http://localhost/health` returns 502 Bad Gateway
- **Direct access works**: `curl http://localhost:8080/health` returns 200
- **Upstream reachable**: nginx container can ping and wget go-core:8080
- **Impact**: Blocks Task 1 (health contract verification via public endpoint)
- **Status**: Under investigation
- **Next steps**: 
  1. Check nginx error logs for upstream connection details
  2. Verify nginx config matches repository version
  3. Test nginx reload/restart to clear stale upstream state

## [2026-03-10T01:45:00Z] Wave 1 Defects

### D1: Python integration tests - 2 failures (299/301 pass)
- **Tests**: "description persisted", "photo has UserID field"
- **Impact**: 99.3% pass rate, minor failures
- **Priority**: Medium
- **Status**: Needs investigation

### D2: Auth registration returns empty user_id
- **Symptom**: Registration succeeds, tokens generated, but user.id field empty
- **Impact**: Blocks auth smoke test completion
- **Priority**: High
- **Status**: Needs investigation

### D3: Frontend ESLint errors (5 total)
- **Files**: admin/page.tsx (4 unescaped quotes), favorites/page.tsx (1 React effect)
- **Impact**: Code quality, potential runtime issues
- **Priority**: Medium
- **Status**: Needs fixing
