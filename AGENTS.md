# Photogiraffe - Agent Knowledge Base

Multi-language photo management platform: Go backend + Python worker + Next.js frontend.

---

## Architecture

```
Browser → Next.js (3000) → Go Core API (8080) → PostgreSQL + MinIO + Redis
                                                      ↓
                                              Python Worker (async tasks)
```

**Services**: postgres, redis, minio, go-core, python-worker, frontend, nginx

---

## Build/Test/Lint Commands

### Go (go-core/)

```bash
# Build
cd go-core && go build -o main .

# Run locally (requires env vars)
./main

# Test all
go test ./...

# Test single package
go test ./auth

# Test single function
go test -run TestGenerateAccessToken ./auth

# Format
go fmt ./...

# Vet
go vet ./...

# Tidy dependencies
go mod tidy
```

### Python (python-worker/)

```bash
# Install dependencies
pip install -r python-worker/requirements.txt

# Run worker (requires env vars)
python python-worker/main.py

# Run integration tests (requires Go Core running at :8080)
python tests/integration_test.py

# Run single test file
python test_exif.py

# No linting config - manual PEP 8 compliance
```

### Frontend (frontend/)

```bash
# Install
cd frontend && npm install

# Dev server
npm run dev

# Build
npm run build

# Production server
npm start

# Lint
npm run lint

# Lint specific file
npx eslint src/app/page.tsx

# Type check
npx tsc --noEmit
```

### Docker

```bash
# Start all services
docker compose up -d

# Rebuild specific service
docker compose up -d --build go-core

# View logs
docker compose logs -f go-core
docker compose logs -f python-worker
docker compose logs -f frontend

# Stop all
docker compose down

# Reset everything (⚠ deletes data)
docker compose down -v
```

---

## Code Style Guidelines

### Go (go-core/)

**Naming**:
- Functions: `camelCase` (private), `PascalCase` (public)
- Types/Structs: `PascalCase`
- Packages: lowercase
- Constants: `UPPER_SNAKE_CASE`

**Imports** (3 groups, blank line separated):
```go
import (
    // 1. Standard library
    "fmt"
    "time"
    
    // 2. Internal packages
    "photogiraffe/core/auth"
    "photogiraffe/core/models"
    
    // 3. External packages
    "github.com/gofiber/fiber/v2"
    "gorm.io/gorm"
)
```

**Error Handling**:
```go
if err != nil {
    return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
        "error": "User-friendly message",
    })
}
```

**Patterns**:
- Middleware returns `fiber.Handler`
- Use `c.Locals("userID", ...)` for context
- Defer cleanup: `defer file.Close()`
- Goroutines for async: `go sendEmail(...)`

### Python (python-worker/)

**Naming**:
- Functions: `snake_case`
- Private functions: `_leading_underscore`
- Constants: `UPPER_SNAKE_CASE`
- Classes: `PascalCase` (rare)

**Imports** (2 groups):
```python
# Standard library
import os
import time
import logging

# Third-party
from PIL import Image
import redis
from minio import Minio
```

**Type Hints**: Optional (minimal usage in codebase)

**Error Handling**:
```python
try:
    result = risky_operation()
except Exception as e:
    logger.error(f"Operation failed: {e}")
    return False  # or raise
```

**Logging**: Use `logger.error()`, `logger.warning()`, `logger.debug()`

### TypeScript (frontend/)

**Naming**:
- Functions: `camelCase`
- Components: `PascalCase`
- Types/Interfaces: `PascalCase`
- Constants: `UPPER_SNAKE_CASE`

**Imports** (auto-sorted by ESLint):
```typescript
// React/Next
import { useState } from 'react'
import Image from 'next/image'

// Third-party
import { motion } from 'framer-motion'

// Local (use @ alias)
import { Button } from '@/components/ui/button'
import type { Photo } from '@/types'
```

**Types**: Always use TypeScript strict mode
```typescript
// Prefer interfaces for objects
interface Photo {
  id: string
  filename: string
}

// Use type for unions/primitives
type Status = 'pending' | 'completed' | 'failed'
```

**Error Handling**:
```typescript
try {
  const res = await fetch('/api/photos')
  if (!res.ok) throw new Error('Failed to fetch')
  const data = await res.json()
} catch (error) {
  console.error('Error:', error)
  toast.error('Failed to load photos')
}
```

**Patterns**:
- Functional components with hooks
- Use `'use client'` for client components
- API routes proxy to Go Core
- Tailwind for styling

---

## Key Conventions

**Authentication**:
- JWT access tokens (15 min) + refresh tokens (7 days)
- Refresh tokens rotate on use
- First registered user = SuperAdmin

**File Storage**:
- MinIO buckets: `photos` (originals), `thumbnails`, `exports`
- Path format: `{userID}/{photoID}/{filename}`

**Task Queue**:
- Redis Streams: `image_processing_queue`
- Python worker consumes tasks
- Worker calls `/internal/photos/:id/status` to update

**Database**:
- PostgreSQL with GORM
- 24 tables, auto-migration on startup
- Use UUID v4 for public user IDs

**API Responses**:
```json
// Success
{"data": {...}}

// Error
{"error": "User-friendly message"}
```

---

## Common Tasks

**Add new API endpoint (Go)**:
1. Add route in `main.go` (e.g., `app.Get("/api/photos", requireJWT(), handler)`)
2. Add handler function
3. Update models if needed
4. Add frontend API route proxy

**Add new task type (Python)**:
1. Add task handler in `main.py`
2. Publish task from Go: `queue.PublishTask(taskType, payload)`
3. Worker processes via Redis Streams

**Add new frontend page**:
1. Create `src/app/[route]/page.tsx`
2. Add API route in `src/app/api/[route]/route.ts` if needed
3. Use existing components from `src/components/`

---

## Environment Variables

Required in `.env`:
- `INTERNAL_SECRET` (48+ chars) - Go ↔ Python auth
- `JWT_SECRET` (32+ chars) - JWT signing
- `DB_PASSWORD`, `REDIS_PASSWORD`, `MINIO_PASSWORD`
- `CORS_ALLOW_ORIGIN` (default: http://localhost:3000)

Generate secrets:
```bash
openssl rand -hex 24  # INTERNAL_SECRET
openssl rand -hex 32  # JWT_SECRET
```

---

## Notes

- No CI/CD configured (opportunity to add GitHub Actions)
- No linting config for Python (manual PEP 8)
- Frontend uses Next.js 16 App Router (full CSR)
- Browser-side RAW decoding via libraw-wasm
- Nginx handles rate limiting (5 req/min auth, 60 req/min API)
