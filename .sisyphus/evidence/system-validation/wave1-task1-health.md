# Wave 1 Baseline Verification Evidence

## Task 1: Compose bring-up + health contract

### Execution Time
2026-03-10T01:36:00Z - 01:40:30Z

### Docker Compose Status
```bash
$ docker compose ps
NAME                         STATUS       PORTS
photogiraffe-frontend        Up 6 days    127.0.0.1:3000->3000/tcp
photogiraffe-go-core         Up 6 days    127.0.0.1:8080->8080/tcp
photogiraffe-minio           Up 2 weeks   9000/tcp, 0.0.0.0:9001->9001/tcp
photogiraffe-nginx           Up 11 days   0.0.0.0:80->80/tcp
photogiraffe-postgres        Up 2 weeks   127.0.0.1:5432->5432/tcp
photogiraffe-python-worker   Up 9 days    
photogiraffe-redis           Up 2 weeks   127.0.0.1:6379:6379/tcp
```
**Result**: ✅ PASS - All 7 services running

### Health Endpoint - Direct (go-core:8080)
```bash
$ curl http://localhost:8080/health
Go Core API is healthy! Database connection is active.
```
**Status**: 200 OK  
**Result**: ✅ PASS

### Health Endpoint - Nginx Proxy (port 80)
**Initial Test**:
```bash
$ curl http://localhost/health
<html><head><title>502 Bad Gateway</title></head>...
```
**Status**: 502 Bad Gateway  
**Result**: ❌ FAIL

**Root Cause Analysis**:
- DNS resolution issue: nginx looking for `go-core.lxd` instead of `go-core`
- Upstream reachable by IP: `wget http://172.18.0.5:8080/health` works from nginx container
- Hostname resolves: `getent hosts go-core` returns correct IP
- Issue: Stale DNS cache in nginx

**Remediation**:
```bash
$ docker exec photogiraffe-nginx nginx -s reload
2026/03/10 01:40:15 [notice] 75#75: signal process started
```

**Verification After Fix**:
```bash
$ curl http://localhost/health
Go Core API is healthy! Database connection is active.
```
**Status**: 200 OK  
**Result**: ✅ PASS (after nginx reload)

### Summary
- Services: 7/7 running ✅
- Direct health: PASS ✅
- Nginx proxy health: PASS (after reload) ✅
- Issue documented: Nginx DNS cache required reload
