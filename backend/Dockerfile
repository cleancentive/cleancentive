FROM oven/bun:1 AS deps
WORKDIR /app

COPY package.json bun.lock ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
COPY worker/package.json worker/package.json

RUN bun install --frozen-lockfile

FROM deps AS build
COPY backend backend
RUN bun run --filter '@cleancentive/backend' build

FROM oven/bun:1 AS runtime
WORKDIR /app

ARG SOURCE_COMMIT=unknown
ENV NODE_ENV=production

COPY --from=build /app /app

LABEL org.opencontainers.image.revision=$SOURCE_COMMIT

WORKDIR /app/backend
EXPOSE 3000
CMD ["bun", "run", "start"]
