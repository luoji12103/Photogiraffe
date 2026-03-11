# Photogiraffe System-Wide Validation & Security Remediation Plan

## TL;DR

> **Quick Summary**: Execute a deep, full-stack validation campaign using Docker Compose to launch all services, run comprehensive functional/security/test verification, and block release on **all severities** until every defect is fixed or explicitly dispositioned.
>
> **Deliverables**:
> - Full-stack startup + health validation evidence
> - Cross-service functional verification matrix (frontend → go-core → redis → python-worker → minio/postgres)
> - Unit/integration/security/concurrency test evidence pack
> - Defect register with deterministic repro + atomic fix commits
> - Final all-gates pass report with zero unresolved blockers under selected policy
>
> **Estimated Effort**: Large
> **Parallel Execution**: YES - 6 waves
> **Critical Path**: Environment gate → Functional critical-path gate → Security gate → Concurrency gate → Remediation loops → Final audit

---

## Context

### Original Request
User asked to launch the entire program, deeply test all functions and security, run all unit tests, detect atomic/concurrency issues, and fix bugs before further optimization.

### Interview Summary
**Key decisions**:
- Runtime mode: **Docker Compose full stack**
- Security depth: **Deep** (baseline + dependency audit + abuse-case checks)
- Release policy: **Block on all severities**

### Metis Review (applied)
Guardrails applied from consultation:
- Freeze scope to validation/remediation; no optimization/feature expansion.
- Enforce deterministic reproducibility for all non-trivial defects.
- Require failing-test-first + minimal fix + regression proof for each bug.
- No manual-only acceptance; all criteria agent-executable.

---

## Work Objectives

### Core Objective
Produce a trustworthy go/no-go decision for correctness and security by running exhaustive, reproducible, full-stack verification and remediation, with evidence-backed closure.

### Concrete Deliverables
- One consolidated validation evidence tree under `.sisyphus/evidence/system-validation/`
- Defect register mapping each finding to severity, repro, fix, and verification status
- Atomic commit trail for every remediation unit
- Final gate report proving all selected gates passed

### Definition of Done
- [ ] All validation gates pass with reproducible commands
- [ ] All discovered findings dispositioned (fixed or explicit deferred-with-rationale)
- [ ] No open findings under current “block on all severities” policy
- [ ] Full rerun of critical suites after final remediation succeeds

### Must Have
- Full-stack launch verification via Docker Compose
- Functional + security + concurrency validation
- Unit/integration suite execution across Go/Python/frontend
- Deterministic evidence artifacts for every gate

### Must NOT Have (Guardrails)
- No optimization tuning tasks unless required to restore correctness/security
- No feature additions
- No broad refactors unrelated to validated defects
- No manual-only verification claims

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** — all acceptance criteria must be command/tool verifiable by agent execution.

### Test Decision
- **Infrastructure exists**: YES
- **Automated tests**: Tests-after + bug-driven TDD for remediations
- **Frameworks**: Go testing, Python script/integration checks, frontend lint/type/build checks

### QA Policy
Every task includes executable QA scenarios with evidence outputs saved under:
`.sisyphus/evidence/system-validation/task-{N}-{scenario}.{ext}`

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Environment & Baseline Gates)
├── Task 1: Compose bring-up + health contract [quick]
├── Task 2: Seed/state policy + deterministic fixtures [quick]
├── Task 3: Service readiness assertions (postgres/redis/minio/go/frontend/worker/nginx) [unspecified-high]
├── Task 4: Baseline smoke for auth + protected routes [quick]
└── Task 5: Evidence harness scaffolding [quick]

Wave 2 (Functional Critical Path Gates)
├── Task 6: Upload→queue→worker→status lifecycle verification [deep]
├── Task 7: Metadata/EXIF/render/export/preset functional matrix [unspecified-high]
├── Task 8: Admin/role boundary matrix [unspecified-high]
├── Task 9: Error-path UX/API contract validation [quick]
└── Task 10: Regression snapshot for current known fixes [quick]

Wave 3 (Unit/Integration/Test Surface Exhaustion)
├── Task 11: Go full suite + race runs (targeted + full) [deep]
├── Task 12: Python worker tests + integration script hardening [unspecified-high]
├── Task 13: Frontend lint/type/build + API proxy behavior checks [quick]
├── Task 14: Cross-service integration rerun with clean state [unspecified-high]
└── Task 15: Flakiness/repeatability checks (N reruns) [quick]

Wave 4 (Deep Security Validation)
├── Task 16: Auth/session/JWT/refresh/rotation abuse checks [deep]
├── Task 17: CSRF/RBAC/rate-limit bypass attempts [deep]
├── Task 18: Input validation/fuzz-lite malformed payload checks [unspecified-high]
├── Task 19: Dependency/image/config audits (Go/Python/Node/containers) [unspecified-high]
└── Task 20: Internal endpoint secret-boundary enforcement [quick]

Wave 5 (Atomic/Concurrency Fault Discovery)
├── Task 21: SSE/event delivery under reconnect/restart stress [deep]
├── Task 22: Queue at-least-once and duplicate-processing checks [deep]
├── Task 23: Parallel upload/export/login contention scenarios [unspecified-high]
├── Task 24: Partial outage resilience (redis/minio restarts) [deep]
└── Task 25: Idempotency and rollback consistency checks [unspecified-high]

Wave 6 (Remediation Loops + Closure)
├── Task 26: Defect triage + prioritization matrix [quick]
├── Task 27: Atomic fix loop (fail test → minimal fix → regression) [deep]
├── Task 28: Full gate rerun after all fixes [deep]
└── Task 29: Final audit pack + release recommendation [oracle]
```

---

## TODOs

---

## Final Verification Wave

- [ ] FV1. **Plan Compliance Audit** — ensure every gate and evidence artifact exists and is reproducible.
- [ ] FV2. **Security Re-audit** — rerun deep security checks after remediations and confirm zero open findings under policy.
- [ ] FV3. **System Regression Rerun** — rerun critical functional + test suites from clean state.
- [ ] FV4. **Scope Fidelity Check** — confirm no optimization/feature creep entered validation campaign.

---

## Commit Strategy

- Atomic defect commits only:
  1) `test(defect-<id>): add failing repro`
  2) `fix(defect-<id>): minimal remediation`
  3) `test(defect-<id>): regression guard`

---

## Success Criteria

### Verification Commands (representative)
```bash
docker compose up -d
docker compose ps
go test ./... && go test -race ./...
python tests/integration_test.py
cd frontend && npm run lint && npx tsc --noEmit && npm run build
```

### Final Checklist
- [ ] Full stack launches cleanly via Compose
- [ ] Critical functional paths pass end-to-end
- [ ] Security deep checks pass with no unresolved findings
- [ ] Concurrency/atomic scenarios pass reproducibly
- [ ] All defects have evidence, atomic fix commits, and regression proof
