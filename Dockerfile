# Build stage
FROM node:20-slim AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY scripts ./scripts

# Install dependencies (including dev dependencies for build)
RUN npm install

# Copy source code
COPY . .

# Ensure wwebjs patch is applied (postinstall may have run before scripts were present on rebuild caches)
RUN node scripts/patch-wwebjs.mjs

# Build TypeScript
RUN npm run build

# Production stage
FROM node:20-slim

RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    ca-certificates \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Set Chromium path
ENV BROWSER_PATH=/usr/bin/chromium \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production

WORKDIR /app

# Copy package files and lockfile from builder
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json
COPY --from=builder /app/scripts ./scripts

# Install only production dependencies
RUN npm ci --omit=dev

# Copy built files from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/injected ./dist/injected
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json

# Create directory for WhatsApp session data with correct ownership
RUN mkdir -p .wwebjs_auth .wwebjs_cache && \
    chown -R node:node .wwebjs_auth .wwebjs_cache

# Use non-root user
USER node

# Expose port
EXPOSE 3040

# Start the application
CMD ["npm", "start"]
