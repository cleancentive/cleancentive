FROM oven/bun:1 AS deps
WORKDIR /app

COPY package.json bun.lock ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
COPY worker/package.json worker/package.json

RUN bun install --frozen-lockfile

FROM deps AS build
WORKDIR /app

ARG SOURCE_COMMIT=unknown
COPY frontend frontend
RUN bun run --filter '@cleancentive/frontend' build

FROM nginx:1.27-alpine AS runtime
ARG SOURCE_COMMIT=unknown

COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html

LABEL org.opencontainers.image.revision=$SOURCE_COMMIT

EXPOSE 80
