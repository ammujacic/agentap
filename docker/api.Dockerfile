# API Dockerfile - Cloudflare Workers via Wrangler
# Using Debian-based image because workerd requires glibc (not musl/Alpine)
FROM node:20-slim

WORKDIR /app

# Install wrangler and curl for healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g wrangler

# Copy workspace configuration
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml ./
COPY turbo.json ./

# Copy package.json files for dependency installation
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/

# Install pnpm and dependencies
RUN npm install -g pnpm && pnpm install --frozen-lockfile || pnpm install

# Copy source code
COPY apps/api apps/api
COPY packages/shared packages/shared

# Copy entrypoint script
COPY docker/api-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

WORKDIR /app/apps/api

EXPOSE 8787

ENTRYPOINT ["/entrypoint.sh"]
