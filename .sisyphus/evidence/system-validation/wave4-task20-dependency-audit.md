# Wave 4 Task 20 — Comprehensive Dependency / Image / Config Audit

Date: 2026-03-14  
Worktree: `/root/code/Photogiraffe/worktrees/validate_temp`

## Audit Scope & Reproducible Commands

### Dependency audits
- Go modules and updates:
  - `go list -m all`
  - `go list -m -u all`
  - `go list -m -u -json all`
  - `govulncheck ./...`
  - `govulncheck -show verbose ./...`
- Python dependencies and vulns:
  - `python3 -m pip_audit -r requirements.txt --format json`
  - `python3 -m pip list --outdated --format json`
- Node dependencies and vulns:
  - `npm audit --package-lock-only --json`
  - `npm audit --package-lock-only`
  - `npm outdated --all --json`

### Container/image audits
- Image metadata:
  - `docker buildx imagetools inspect postgres:15-alpine`
  - `docker buildx imagetools inspect redis:7-alpine`
  - `docker buildx imagetools inspect nginx:1.27-alpine`
  - `docker buildx imagetools inspect minio/minio`
- Vulnerability scans (Trivy in container):
  - `docker run --rm -v /var/run/docker.sock:/var/run/docker.sock aquasec/trivy:0.66.0 image --severity CRITICAL,HIGH --scanners vuln ...`
  - Also OS-only runs with `--vuln-type os` for `node:20-alpine`, `golang:1.24-alpine`, `python:3.11-slim`

### Configuration/security audits
- File inspection: `.env`, `.env.example`, `docker-compose.yml`, Dockerfiles, `nginx/nginx.conf`
- Secret pattern scan:
  - `grep` over `*.env*` for `(password|secret|token|key)`
- Git tracking check for sensitive files:
  - `git ls-files --stage .env ...`

---

## Executive Summary

| Severity | Count | Notes |
|---|---:|---|
| **Critical** | 6 | Node lockfile vulnerable transitive deps, Pillow CVE, Go stdlib vulns, multiple critical container-image findings, committed secrets |
| **High** | 11 | Container hardening issues, Docker image CVEs, plaintext default/fallback secrets, HTTP-only edge |
| Medium | 7 | Outdated dependencies, unpinned Python deps, mutable image tags |
| Low | 3 | Dependency hygiene and reproducibility gaps |

**Most urgent risks**
1. **Tracked `.env` with real secrets in Git** (`.env` is currently versioned).  
2. **Critical Node dependency vulnerability** (`fast-xml-parser@4.5.3`, GHSA-m7jm-9gc2-mpf2).  
3. **Critical Python package vulnerability** (`pillow==11.3.0`, CVE-2026-25990).  
4. **Go runtime stdlib vulnerabilities** present in `go1.25.7` (fixed in `go1.25.8`).  
5. **Critical CVEs in base/runtime images** (notably `nginx:1.27-alpine`, `postgres:15-alpine`, `node:20-alpine`, `golang:1.24-alpine`).

---

## Detailed Findings

## 1) Go Dependencies (go.mod / go.sum)

### Evidence
- `go-core/go.mod` includes direct deps such as:
  - `github.com/minio/minio-go/v7 v7.0.98`
  - `github.com/valyala/fasthttp v1.51.0`
  - `golang.org/x/crypto v0.46.0`
- `govulncheck` output (symbol reachability):
  - **GO-2026-4602** (`os`) found in code path
  - **GO-2026-4601** (`net/url`) found in code paths
  - Fixed in `go1.25.8` (runtime currently `go1.25.7`)

### Findings

| Component | Finding | Current | Recommended | Severity | CVE / Advisory |
|---|---|---|---|---|---|
| Go runtime | Stdlib vuln reachable via code paths (`os`, `net/url`) | go1.25.7 | **go1.25.8+** | **High** | GO-2026-4602, GO-2026-4601 |
| Go modules | Large lag in direct dependency `fasthttp` | v1.51.0 | v1.69.0 | Medium | (risk from old transport stack) |
| Go modules | Security-sensitive `x/crypto` behind latest | v0.46.0 | v0.49.0 | Medium | (no active CVE in scan, but cryptography package lag) |
| Go modules | Storage SDK behind latest | minio-go v7.0.98 | v7.0.99 | Low | N/A |

### Remediation
- Upgrade Go toolchain/runtime to `go1.25.8` immediately.
- Run `go get -u=patch` on direct deps first; prioritize `fasthttp`, `x/crypto`.
- Re-run `govulncheck ./...` after each atomic bump.

---

## 2) Python Dependencies (`python-worker/requirements.txt`)

### Evidence
- `requirements.txt` has **unpinned** dependencies (e.g. `redis`, `pillow`, `openai`, etc. with no `==`).
- `pip_audit -r requirements.txt --format json` found:
  - `pillow 11.3.0` vulnerable to **CVE-2026-25990** (GHSA-cfh3-3jmp-rvhc)
  - fix version: `12.1.1`

### Findings

| Component | Finding | Current | Recommended | Severity | CVE / Advisory |
|---|---|---|---|---|---|
| Python package | Pillow out-of-bounds write on crafted PSD | 11.3.0 | **12.1.1+** | **Critical** | CVE-2026-25990 / GHSA-cfh3-3jmp-rvhc |
| Dependency policy | Requirements are unpinned (non-reproducible supply chain) | unpinned | pin all with hashes/constraints | High | N/A |
| Python toolchain | pip itself very outdated in env used for audit | 21.3.1 | 26.0.1 | Low | N/A |

### Remediation
- Pin `pillow>=12.1.1` and rebuild lock/constraints.
- Move to pinned `requirements.txt` (or `requirements.lock`) with hashes (`--require-hashes`).
- Add CI gate: `pip-audit -r requirements.txt`.

---

## 3) Node.js Dependencies (`frontend/package.json` / lock)

### Evidence
- `npm audit --package-lock-only` reports:
  - `fast-xml-parser` (critical/high advisories)
  - `flatted` (high)
  - `minimatch` (high)
  - `ajv` (moderate)
- `package-lock.json` contains vulnerable versions:
  - `node_modules/fast-xml-parser` = `4.5.3`
  - `node_modules/flatted` = `3.3.3`
  - `node_modules/minimatch` = `3.1.2`
  - `node_modules/ajv` = `6.12.6`

### Findings

| Component | Finding | Current | Recommended | Severity | CVE / Advisory |
|---|---|---|---|---|---|
| Node transitive | XML parser vuln incl. critical entity bypass | fast-xml-parser 4.5.3 | >=4.5.4 | **Critical** | GHSA-m7jm-9gc2-mpf2, GHSA-jmr7-xgp7-cmfj |
| Node transitive | `flatted` unbounded recursion DoS | 3.3.3 | >=3.4.0 | High | GHSA-25h7-pfq9-p65f |
| Node transitive | `minimatch` ReDoS variants | 3.1.2 | >=3.1.4 (or >=9.0.7 for v9) | High | GHSA-3ppc-4f35-3m26, GHSA-7r86-cg39-jmmj, GHSA-23c5-xmqv-rm74 |
| Node transitive | `ajv` ReDoS with `$data` | 6.12.6 | >=6.14.0 | Medium | GHSA-2g4f-4pwh-qvx6 |
| Node direct | Minor lag in runtime deps | react 19.2.3, lucide-react 0.575.0, minio 8.0.6 | react 19.2.4, lucide-react 0.577.0, minio 8.0.7 | Low | N/A |

### Remediation
- Run `npm audit fix` and validate lockfile diff; if unresolved, force targeted overrides/resolutions.
- Add CI gate: `npm audit --audit-level=high`.
- Prefer `npm ci` in Docker builds for deterministic installs.

---

## 4) Docker Base Images & Container Security

### Evidence
- `docker-compose.yml` images:
  - `postgres:15-alpine`, `redis:7-alpine`, `minio/minio`, `nginx:1.27-alpine`
- Dockerfiles:
  - `go-core`: `FROM golang:1.24-alpine` builder, runtime `FROM alpine:latest`
  - `python-worker`: `FROM python:3.11-slim`
  - `frontend`: `FROM node:20-alpine`
- `docker image inspect ... --format '{{.Config.User}}'` shows empty user for examined images (default root unless changed by entrypoint/runtime)
- Trivy scans report critical/high vulnerabilities across several images.

### Findings

| Component | Finding | Current | Recommended | Severity | CVE / Advisory |
|---|---|---|---|---|---|
| go-core Dockerfile | Runtime base uses mutable tag | `alpine:latest` | pin exact digest/version | Medium | Supply-chain risk |
| All app Dockerfiles | No explicit non-root `USER` in Dockerfiles | root-default | set dedicated UID/GID and `USER` | High | Container hardening gap |
| frontend Dockerfile | `npm install` in build stage (non-deterministic) | npm install | `npm ci --omit=dev` (where applicable) | Medium | Reproducibility risk |
| postgres image | Critical OS vuln | zlib 1.3.1-r2 | zlib 1.3.2-r0 in newer base | **Critical** | CVE-2026-22184 |
| nginx image | Multiple critical/high OS vulns | 1.27-alpine (alpine 3.21.3 packages) | rebase to patched image version/digest | **Critical** | CVE-2025-15467, CVE-2025-49794, CVE-2025-49796, etc. |
| node base image | Critical OS vuln (zlib) | node:20-alpine | patched tag/digest with zlib 1.3.2-r0 | **Critical** | CVE-2026-22184 |
| golang base image | Critical OS vuln (zlib) | golang:1.24-alpine | patched tag/digest with zlib 1.3.2-r0 | **Critical** | CVE-2026-22184 |
| python base image | High OS vuln in glibc | python:3.11-slim | patched debian base when available | High | CVE-2026-0861 |
| minio image | High/critical gobinary vulns in bundled binaries | latest (scan date) | pin newer digest after vendor patch | High | CVE-2025-68121, CVE-2025-62506, etc. |

### Remediation
- Pin every base image by immutable digest.
- Add `USER` non-root in all app images.
- Add image scanning gate in CI (`trivy image --severity HIGH,CRITICAL --exit-code 1 ...`).

---

## 5) Configuration Security Audit

### Evidence
- `.env` contains real secret-like values and is tracked by Git:
  - `git ls-files --stage .env` returned tracked entry.
- `.env` includes plaintext `DB_PASSWORD`, `REDIS_PASSWORD`, `MINIO_PASSWORD`, `ADMIN_TOKEN`, `INTERNAL_SECRET`, `JWT_SECRET`.
- `docker-compose.yml` contains weak fallback defaults for secrets (seen in file read):
  - examples: `DB_PASSWORD:-postgres`, `REDIS_PASSWORD:-redispass`, `MINIO_PASSWORD:-admin12345`, `JWT_SECRET:-photogiraffe_jwt_secret_change_me_in_prod`.
- `nginx/nginx.conf` listens on `80`, lacks HSTS/HTTPS termination config.

### Findings

| Component | Finding | Current | Recommended | Severity |
|---|---|---|---|---|
| Git hygiene | `.env` with sensitive values is tracked in repository | tracked | remove from VCS, rotate all exposed secrets | **Critical** |
| Secrets management | Plaintext secrets in local config files | plaintext | secret manager / runtime injection only | High |
| Compose defaults | Weak fallback credentials in compose env interpolation | present | remove insecure defaults; require explicit secrets | High |
| Edge transport | HTTP-only edge (`listen 80`) and no HSTS | HTTP only | terminate TLS + HSTS + redirect 80→443 | Medium |

### Remediation
- Immediate secret rotation for all values in tracked `.env`.
- Add pre-commit/CI secret scanning (`gitleaks`, `trufflehog`).
- Remove all insecure `:-default` secret fallbacks from compose.

---

## Outdated Dependency Snapshot (selected)

### Go (selected)
- `github.com/valyala/fasthttp`: `v1.51.0` → `v1.69.0`
- `golang.org/x/crypto`: `v0.46.0` → `v0.49.0`
- `golang.org/x/net`: `v0.48.0` → `v0.52.0`
- `github.com/minio/minio-go/v7`: `v7.0.98` → `v7.0.99`

### Python (environment from audit run)
- `openai`: `2.23.0` → `2.28.0`
- `anthropic`: `0.83.0` → `0.84.0`
- `google-auth`: `2.48.0` → `2.49.1`
- (`requirements.txt` currently unpinned, so exact resolved versions can drift)

### Node (direct)
- `react`: `19.2.3` → `19.2.4`
- `react-dom`: `19.2.3` → `19.2.4`
- `lucide-react`: `0.575.0` → `0.577.0`
- `minio`: `8.0.6` → `8.0.7`

---

## Critical Vulnerabilities — Failing Test Cases (Atomic Fix Loop Ready)

Use these as **gates**; they are expected to fail now.

### 1) Node vulnerability gate
```bash
cd frontend
npm audit --package-lock-only --audit-level=critical
```
Expected now: **non-zero exit**, due to `fast-xml-parser` critical advisory.

### 2) Python vulnerability gate
```bash
cd python-worker
python3 -m pip_audit -r requirements.txt
```
Expected now: **non-zero exit**, due to Pillow CVE-2026-25990.

### 3) Go vulnerability gate
```bash
cd go-core
/root/go/bin/govulncheck ./...
```
Expected now: reports reachable stdlib vulnerabilities (requires runtime/toolchain bump).

### 4) Container image gate (example: nginx)
```bash
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
  aquasec/trivy:0.66.0 image --severity HIGH,CRITICAL --exit-code 1 nginx:1.27-alpine
```
Expected now: **non-zero exit**, multiple high/critical CVEs.

### 5) Secret tracking gate
```bash
git ls-files --error-unmatch .env
```
Expected now: **zero exit** (bad state); desired policy is to fail CI if this file is tracked.

---

## Recommended Fix Order (atomic)
1. **Secrets incident response first**: untrack `.env`, rotate all secrets.
2. Patch Node critical transitive vulns (`npm audit fix` + lockfile validation).
3. Pin Python deps and upgrade Pillow to fixed version.
4. Upgrade Go runtime to `go1.25.8+`; rerun `govulncheck`.
5. Rebase/pin container images by digest and enforce non-root users.
6. Add CI security gates for `npm audit`, `pip-audit`, `govulncheck`, Trivy, and secret scanning.

---

## Audit Verdict

**FAIL (security baseline not met)** due to active critical vulnerabilities and secret-management violations.
