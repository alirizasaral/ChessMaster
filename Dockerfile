# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@10.33.4 --activate

FROM base AS deps
WORKDIR /app

COPY app/package.json app/pnpm-lock.yaml app/pnpm-workspace.yaml app/.npmrc ./
COPY app/artifacts/api-server/package.json artifacts/api-server/
COPY app/artifacts/chess-trainer/package.json artifacts/chess-trainer/
COPY app/artifacts/mockup-sandbox/package.json artifacts/mockup-sandbox/
COPY app/lib/api-zod/package.json lib/api-zod/
COPY app/lib/api-client-react/package.json lib/api-client-react/
COPY app/lib/api-spec/package.json lib/api-spec/
COPY app/scripts/package.json scripts/

RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY app/tsconfig.json app/tsconfig.base.json ./
COPY app/lib/ lib/
COPY app/artifacts/api-server/ artifacts/api-server/
COPY app/artifacts/chess-trainer/ artifacts/chess-trainer/

RUN pnpm --filter @workspace/api-server run build
RUN PORT=3000 BASE_PATH=/ pnpm --filter @workspace/chess-trainer run build

FROM node:24-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080
ENV STATIC_DIR=/app/public

RUN apt-get update \
  && apt-get install -y --no-install-recommends tini \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/artifacts/api-server/dist/*.mjs ./api/
COPY --from=build /app/artifacts/chess-trainer/dist/public ./public

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 8080) + '/api/healthz').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

USER node

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--enable-source-maps", "api/index.mjs"]
