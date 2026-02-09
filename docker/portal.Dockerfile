# Portal Dockerfile - Next.js Dashboard
FROM node:20-alpine

WORKDIR /app

# Copy workspace configuration
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml ./
COPY turbo.json ./

# Copy package.json files
COPY apps/portal/package.json apps/portal/
COPY packages/shared/package.json packages/shared/

# Install pnpm and dependencies
RUN npm install -g pnpm && pnpm install --frozen-lockfile || pnpm install

# Copy source code
COPY apps/portal apps/portal
COPY packages/shared packages/shared

WORKDIR /app/apps/portal

EXPOSE 3001

CMD ["pnpm", "dev"]
