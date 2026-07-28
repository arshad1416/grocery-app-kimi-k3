# GroceryApp Relay Server — Dockerfile
# Multi-arch: builds for linux/amd64 and linux/arm64 via Docker Buildx

# Use official Node.js LTS image (multi-arch)
FROM --platform=$TARGETPLATFORM node:20-alpine AS build

ARG TARGETPLATFORM
RUN echo "Building for $TARGETPLATFORM"

FROM node:20-alpine

WORKDIR /app

# Copy package files and install dependencies
COPY package.json ./
RUN npm install --omit=dev && \
    npm cache clean --force

# Copy server source
COPY server.js ./

# Expose WebSocket port
EXPOSE 8080 8081

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:8080/health || exit 1

# Run the server (non-root user)
USER node
CMD ["node", "server.js"]
