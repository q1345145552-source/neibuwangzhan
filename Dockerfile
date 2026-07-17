FROM node:22-alpine
WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm install

# Copy source and build
COPY . .
RUN npm run build

# Symlinks are created at runtime via start.sh
CMD ["/app/start.sh"]
