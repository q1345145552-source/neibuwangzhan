FROM node:22-alpine
WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm install

# Copy source and build
COPY . .

# 构建期需要一个占位密钥（Next.js 预渲染会 import auth.ts，NODE_ENV=production
# 下没有 JWT_SECRET 会直接 throw）。这个值只存在于 build 这一条命令的进程环境里，
# 不写成 ENV —— 写成 ENV 会烧进镜像成为运行时默认密钥，等于把密钥公开。
# 运行时的真实密钥由 docker-compose 的 env_file 注入，start.sh 启动前会校验。
RUN JWT_SECRET=build-time-placeholder-not-used-at-runtime npm run build

# Symlinks are created at runtime via start.sh
CMD ["/app/start.sh"]
