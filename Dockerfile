# Build stage
FROM node:20-alpine

RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    font-noto-emoji

# Set Chromium path
ENV BROWSER_PATH=/usr/bin/chromium-browser \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

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
