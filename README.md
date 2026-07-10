# Chess Opening Trainer

**[Try it live → chessmaster.alirizasaral.com](https://chessmaster.alirizasaral.com/)**

A mobile-friendly web app that teaches chess openings with interactive lessons, free play, and a real-time AI coach.

My first experiment with vibe coding — built with AI-assisted development, deployed as a hobby project. Contributions are welcome.

## Features

- **Voice coach** — listens, talks, explains ideas, and watches every move on the board in real time
- **Opening lessons** — move-by-move guided lines with notes (Italian Game, Ruy Lopez, Queen's Gambit, London System, Sicilian, Caro-Kann)
- **Free play** — casual games against the coach with in-character reactions to your moves
- **No account required** — progress is stored locally in your browser

## Support

This is a hobby project. Hosting and OpenAI API usage have real costs. If you enjoy the app, you can help keep it running:

**[buymeacoffee.com/alirizasara](https://buymeacoffee.com/alirizasara)**

## Contributing

Issues and pull requests are welcome. Good first contributions:

- New opening lessons
- Bug fixes and UX improvements
- Documentation and deployment notes

Fork the repo, make your changes under `app/`, and open a PR.

## Prerequisites

- Node.js 24
- pnpm

## Setup

```bash
cd app
pnpm install
cp .env.example .env
# Edit .env and set OPENAI_API_KEY
```

## Development

Start the API server and frontend together:

```bash
cd app
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
cd app
pnpm run typecheck   # Full typecheck across all packages
pnpm run build       # Typecheck + build all packages
```

## Docker

Build and run from the repository root:

```bash
docker build -t chess-opening-trainer .
docker run --rm -p 8080:8080 -e OPENAI_API_KEY=sk-... chess-opening-trainer
```

The container serves the API and static frontend on port 8080.

## Other commands

```bash
cd app
pnpm --filter @workspace/api-spec run codegen   # Regenerate API hooks and Zod schemas
```

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React 19, Vite, Tailwind CSS
- API: Express 5
- Coach: OpenAI Realtime API
- Validation: Zod
- API codegen: Orval (from OpenAPI spec)

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | Yes (for coach/realtime) | OpenAI API key |
| `PORT` | No (defaults to 8080) | API server port |

## License

MIT
