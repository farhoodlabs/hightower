#
# Shannon API Server — minimal Node.js image (no security tools)
#

FROM node:22-alpine AS builder

RUN npm install -g pnpm@10.33.0

WORKDIR /app

# Copy workspace manifests for install layer caching
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY apps/api/package.json ./apps/api/
COPY apps/worker/package.json ./apps/worker/
COPY apps/cli/package.json ./apps/cli/

RUN pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY apps/worker/ ./apps/worker/
COPY apps/api/ ./apps/api/

# Build worker first (API depends on it for types), then API
RUN pnpm --filter @trebuchet/worker run build && pnpm --filter @trebuchet/api run build

# Production-only deps
RUN rm -rf node_modules apps/*/node_modules && pnpm install --frozen-lockfile --prod

# Runtime stage
FROM node:22-alpine

WORKDIR /app

COPY --from=builder /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml /app/.npmrc /app/
COPY --from=builder /app/node_modules /app/node_modules
COPY --from=builder /app/apps/api/dist /app/apps/api/dist
COPY --from=builder /app/apps/api/package.json /app/apps/api/package.json
COPY --from=builder /app/apps/api/node_modules /app/apps/api/node_modules
COPY --from=builder /app/apps/worker/dist /app/apps/worker/dist
COPY --from=builder /app/apps/worker/package.json /app/apps/worker/package.json
COPY --from=builder /app/apps/worker/node_modules /app/apps/worker/node_modules

RUN mkdir -p /app/workspaces

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "apps/api/dist/index.js"]
