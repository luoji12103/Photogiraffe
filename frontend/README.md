# Frontend

Photogiraffe uses a Next.js App Router frontend as the browser-facing application shell.

## Responsibilities

- render the authenticated photo-management UI
- expose `/api/*` proxy routes that normalize auth, CSRF, and upstream pathing
- host public share pages under `/share/*`
- maintain the SSE connection used for export and backup toasts

## Local Development

```bash
cd frontend
npm install
npm run dev
```

The app expects `INTERNAL_API_URL` to point at Go Core. In Docker this is `http://go-core:8080`.

## Quality Gates

```bash
cd frontend
npm run lint
npm run typecheck
```

## Important Files

- [src/app/layout.tsx](/root/code/Photogiraffe/frontend/src/app/layout.tsx): app shell
- [src/components/ClientLayout.tsx](/root/code/Photogiraffe/frontend/src/components/ClientLayout.tsx): authenticated navigation and chrome
- [src/context/AuthContext.tsx](/root/code/Photogiraffe/frontend/src/context/AuthContext.tsx): access-token lifecycle and authenticated fetch wrapper
- [src/components/SSEListener.tsx](/root/code/Photogiraffe/frontend/src/components/SSEListener.tsx): export and backup event toasts
- [src/app/api/_utils/proxy.ts](/root/code/Photogiraffe/frontend/src/app/api/_utils/proxy.ts): shared proxy-header helpers

## Routing Contract

Production should route both `/api/*` and `/share/*` through Next.js, not directly to Go Core. That keeps refresh-token rotation, CSRF forwarding, and share-page behavior consistent across local and deployed environments.
