# syntax=docker/dockerfile:1

# Two runtime targets from one build:
#   web    the Next.js server, from the traced standalone output
#   tools  the full app with its dependencies, for the sync loop, migrations and the maintenance scripts
# docker-compose.self-host.yml builds both. See docs/SELF-HOST.md.

FROM node:24-alpine AS base
ENV COREPACK_HOME=/opt/corepack \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NEXT_TELEMETRY_DISABLED=1
# pnpm comes from the packageManager field in package.json, fetched once at build time.
COPY package.json /tmp/package.json
RUN corepack enable \
    && cd /tmp && corepack install \
    && chmod -R a+rX "$COREPACK_HOME" \
    && rm /tmp/package.json
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    pnpm config set store-dir /pnpm-store \
    && pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
# lib/db requires DATABASE_URL at import. Nothing connects during the build, so a placeholder is enough;
# the real value comes from the environment at runtime.
RUN STANDALONE_BUILD=1 DATABASE_URL=postgres://build:build@127.0.0.1:5432/build pnpm build

FROM base AS tools
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
USER node
CMD ["pnpm", "sync"]

FROM node:24-alpine AS web
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
CMD ["node", "server.js"]
