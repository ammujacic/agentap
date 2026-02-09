# Integration Tests Dockerfile - Playwright
FROM mcr.microsoft.com/playwright:v1.40.0-focal

WORKDIR /app

# Copy tests package
COPY tests/package.json tests/package-lock.json* tests/

# Install dependencies
RUN cd tests && npm install

# Copy tests source
COPY tests tests

WORKDIR /app/tests

CMD ["npx", "playwright", "test"]
