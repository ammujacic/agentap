# Daemon Dockerfile - Bun runtime
FROM oven/bun:1-alpine

WORKDIR /app

# Copy workspace config for Bun
COPY package.json ./
RUN echo '{ "workspaces": ["packages/*"] }' > package.json

# Copy all packages
COPY packages packages

# Install from root with workspace resolution
RUN bun install

WORKDIR /app/packages/daemon

EXPOSE 9876

CMD ["bun", "run", "src/cli.ts", "start", "--no-tunnel", "--port", "9876"]
