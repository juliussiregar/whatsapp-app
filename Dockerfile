# Build stage
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
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# Copy source code
COPY . .

# Install dependencies
RUN npm ci

# Create directory for WhatsApp session data
RUN mkdir -p .wwebjs_auth && chown -R node:node .wwebjs_auth
RUN mkdir -p .wwebjs_cache && chown -R node:node .wwebjs_cache

# Use non-root user
USER node

# Expose port
EXPOSE 3000

# Start the application
CMD ["npm", "dev"]
