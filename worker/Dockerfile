FROM oven/bun:1 AS deps
WORKDIR /app

COPY package.json bun.lock ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
COPY worker/package.json worker/package.json

RUN bun install --frozen-lockfile

FROM deps AS build
ARG SOURCE_COMMIT=unknown
COPY worker worker
RUN bun -e "\
  const fs = require('fs');\
  const p = JSON.parse(fs.readFileSync('worker/package.json', 'utf8'));\
  p.version = process.argv[1];\
  p.buildTime = Math.floor(Date.now() / 1000);\
  fs.writeFileSync('worker/package.json', JSON.stringify(p, null, 2));" "$SOURCE_COMMIT"
RUN bun run --filter '@cleancentive/worker' build

FROM oven/bun:1 AS runtime
WORKDIR /app

ARG SOURCE_COMMIT=unknown
ENV NODE_ENV=production

COPY --from=build /app /app

LABEL org.opencontainers.image.revision=$SOURCE_COMMIT

WORKDIR /app/worker
CMD ["bun", "run", "start"]
