# syntax=docker/dockerfile:1

FROM --platform=$BUILDPLATFORM node:24-slim AS base
WORKDIR /app
RUN corepack enable

FROM base AS fetch
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm fetch

FROM fetch AS build
COPY package.json tsconfig.json ./
COPY scripts ./scripts
COPY src ./src
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --offline --frozen-lockfile && pnpm run build

FROM node:24-slim AS production-deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod

FROM node:24-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --link --from=production-deps /app/node_modules ./node_modules
COPY --link --from=build /app/dist ./dist
COPY --link package.json ./

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/.well-known/oauth-protected-resource').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
