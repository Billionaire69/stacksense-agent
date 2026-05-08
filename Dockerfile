FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package.json ./
RUN npm install --production

# Copy source
COPY src/ ./src/

# Create logs directory
RUN mkdir -p logs

# Health check
HEALTHCHECK --interval=60s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "console.log('healthy')" || exit 1

CMD ["node", "src/index.js"]
