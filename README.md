# Chess Opening Trainer

A mobile-friendly web app that teaches chess openings with interactive lessons, free play, and AI coaching.

## Prerequisites

- Node.js 24
- pnpm

## Setup

```bash
pnpm install
cp .env.example .env
# Edit .env and set OPENAI_API_KEY
```

## Development

Start the API server and frontend together:

```bash
pnpm dev
```

- Frontend: http://localhost:3000
- API health check: http://localhost:8080/api/healthz

Or run them separately:

```bash
pnpm dev:api   # API server on port 8080
pnpm dev:web   # Frontend on port 3000 (proxies /api to localhost:8080)
```

## Build & typecheck

```bash
pnpm run typecheck   # Full typecheck across all packages
pnpm run build       # Typecheck + build all packages
```

## Other commands

```bash
pnpm --filter @workspace/api-spec run codegen   # Regenerate API hooks and Zod schemas
```

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React 19, Vite, Tailwind CSS
- API: Express 5
- Validation: Zod
- API codegen: Orval (from OpenAPI spec)

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | Yes (for coach/realtime) | OpenAI API key |
| `PORT` | No (defaults in scripts) | API server port |
