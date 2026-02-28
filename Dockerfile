FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

# Copy source
COPY src/ ./src/
COPY tsconfig.json bunfig.toml ./

# Create data directory
RUN mkdir -p /app/data

# Default SSH key mount point
RUN mkdir -p /app/ssh

# Config file mount point
RUN mkdir -p /app/config

# Run as the default bun user (UID 1000) which matches typical host user
USER bun

CMD ["bun", "run", "src/index.ts"]
