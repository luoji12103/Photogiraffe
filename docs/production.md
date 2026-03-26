# Production Runbook

Photogiraffe now has a single supported application edge contract:

- `/api/*` goes through the Next.js proxy layer.
- `/share/*` goes through the Next.js app.
- Go Core stays private behind the frontend and worker.

That keeps development and production behavior aligned, especially for refresh-token rotation, CSRF forwarding, SSE, and path translation.

## Recommended Topology

```text
Internet -> reverse proxy / ingress -> nginx -> frontend -> go-core
                                                |          |-> postgres
                                                |          |-> redis
                                                |          |-> minio
                                                |-> browser clients
python-worker ----------------------------------^
```

## Bring Up A Production-Like Stack

1. Copy the environment template and set strong secrets.
2. Set `APP_ORIGIN` to the public origin you will serve.
3. Set `FRONTEND_URL` to the same public origin so password-reset and email links point to the real app.
4. Start the production compose file:

```bash
docker compose -f docker-compose.production.yml up -d --build
```

This profile keeps PostgreSQL, Redis, Go Core, and the Next.js app off host ports by default. Only nginx is public, while MinIO console and observability surfaces stay bound to `127.0.0.1`.

## Required Environment

Minimum production variables:

```dotenv
APP_ORIGIN=https://photos.example.com
FRONTEND_URL=https://photos.example.com
DB_PASSWORD=<strong password>
REDIS_PASSWORD=<strong password>
MINIO_USER=<strong username>
MINIO_PASSWORD=<strong password>
INTERNAL_SECRET=<48+ random chars>
JWT_SECRET=<32+ random chars>
```

Generate secrets:

```bash
openssl rand -hex 24   # INTERNAL_SECRET
openssl rand -hex 32   # JWT_SECRET
```

## Quality Gates

Run these before shipping:

```bash
cd go-core && go test ./...
cd frontend && npm ci && npm run build && npm run typecheck && npm run lint
python -m py_compile python-worker/main.py test_exif.py tests/integration_test.py
```

The repo also includes [`.github/workflows/quality.yml`](/root/code/Photogiraffe/.github/workflows/quality.yml) to enforce those checks in CI.

## Operational Notes

- Backup jobs currently produce a metadata-only ZIP archive with `manifest.json` and `metadata.json`. Original image binaries remain in object storage.
- Export and backup jobs now run through a durable async-task layer with:
  - persisted task state in PostgreSQL
  - retry scheduling with exponential backoff
  - stale-lease reclaim when a worker dies mid-task
  - dead-letter state plus manual retry from the admin page
- Backup completion and failures now emit in-app notifications and SSE toasts.
- Export completion and failures now also create notification-center entries.
- The worker now consumes `backup_queue` and `auto_tag_queue`; those jobs no longer disappear into Redis without a consumer.
- Thumbnail paths are standardized on the `thumb/` object prefix.

## Async Task Operations

- Open `/admin` and use the `异步任务` tab to inspect `pending`, `processing`, `retry_scheduled`, `completed`, and `dead_letter` tasks.
- A worker-backed task is only acknowledged in Redis after Go Core records a durable `succeed` or `fail` transition.
- `dead_letter` means the task exhausted `max_attempts`. Use the admin retry action to reset it and republish the job.
- Backup and export retries reset the user-facing job record back to `pending` before republishing.

## Troubleshooting

- If exports or backups stop progressing, check the admin jobs tab for `retry_scheduled` or `dead_letter` entries.
- If a worker is killed mid-task, wait for the lease window to expire; Go Core will reclaim the stale task and requeue it automatically.
- If a manual retry returns a warning instead of immediate success, the task was persisted but Redis publish failed. The sweeper will retry publication automatically.
- Ensure `FRONTEND_URL` matches `APP_ORIGIN` before testing password-reset or email-driven flows.

## TLS

The bundled nginx config serves HTTP on port `80`. For internet-facing deployments, terminate TLS in front of nginx or replace the nginx config with your certificate-enabled configuration before exposing the service publicly.

## Upgrade Checklist

Before upgrading:

1. Run the quality gates locally or in CI.
2. Take a database backup and object-storage snapshot.
3. Pull the new image or rebuild with `--build`.
4. Restart with `docker compose -f docker-compose.production.yml up -d`.
5. Verify:

```bash
curl -fsS http://127.0.0.1/health
curl -fsS http://127.0.0.1/health/ready
```

6. Confirm login, upload, export, backup, and notification flows.

## Current Limits

This runbook hardens the current architecture, but it does not yet add:

- restore tooling for backup archives
- explicit schema migrations
- a hosted/cloud control plane

Those remain good next steps, but the repository is now in a much more supportable state than the original demo-oriented baseline.
