FROM node:22-alpine
WORKDIR /app

# Build-time JWT secret (needed for Next.js pre-rendering)
ARG JWT_SECRET=xiangtai-build-secret
ENV JWT_SECRET=$JWT_SECRET

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm install

# Copy source and build
COPY . .
RUN npm run build

# Symlinks are created at runtime via start.sh
CMD ["/app/start.sh"]
