FROM node:20-alpine

# Set working directory
WORKDIR /app

# Install dependencies first (cached layer)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy source code and dashboard
COPY src/ ./src/
COPY public/ ./public/

# Create persistent logs directory
RUN mkdir -p /app/logs

# Expose dashboard port
EXPOSE 3001

# Real HTTP health check against the dashboard
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3001/api/status || exit 1

# Run the agent
CMD ["node", "src/index.js"]
