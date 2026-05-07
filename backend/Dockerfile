FROM oven/bun:1 AS deps
WORKDIR /app

COPY package.json bun.lock ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
COPY worker/package.json worker/package.json

RUN bun install --frozen-lockfile

FROM deps AS build
ARG SOURCE_COMMIT=unknown
ARG SOURCE_COMMIT_SHORT=unknown
COPY backend backend
RUN bun -e "\
  const fs = require('fs');\
  const p = JSON.parse(fs.readFileSync('backend/package.json', 'utf8'));\
  p.commit = process.argv[1];\
  p.commitShort = process.argv[2];\
  p.buildTime = Math.floor(Date.now() / 1000);\
  fs.writeFileSync('backend/package.json', JSON.stringify(p, null, 2));" "$SOURCE_COMMIT" "$SOURCE_COMMIT_SHORT"
RUN bun run --filter '@cleancentive/backend' build

FROM oven/bun:1 AS runtime
WORKDIR /app

ARG SOURCE_COMMIT=unknown
ARG SOURCE_COMMIT_SHORT=unknown
ENV NODE_ENV=production

COPY --from=build /app /app

LABEL org.opencontainers.image.revision=$SOURCE_COMMIT
LABEL org.opencontainers.image.version=$SOURCE_COMMIT_SHORT

WORKDIR /app/backend
EXPOSE 3000
CMD ["bun", "run", "start"]
