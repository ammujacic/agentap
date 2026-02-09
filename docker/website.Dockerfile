# Website Dockerfile - Next.js
FROM node:20-alpine

WORKDIR /app

# Copy workspace configuration
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml ./
COPY turbo.json ./

# Copy package.json files
COPY apps/website/package.json apps/website/
COPY packages/shared/package.json packages/shared/

# Install pnpm and dependencies
RUN npm install -g pnpm && pnpm install --frozen-lockfile || pnpm install

# Copy source code
COPY apps/website apps/website
COPY packages/shared packages/shared

WORKDIR /app/apps/website

EXPOSE 3000

CMD ["pnpm", "dev"]
