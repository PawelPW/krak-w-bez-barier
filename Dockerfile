FROM node:22-slim
# Wersja pnpm pochodzi z "packageManager" w package.json.
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
COPY data ./data
RUN pnpm install --frozen-lockfile && pnpm build
ENV NODE_ENV=production DATA_DIR=/data
EXPOSE 3000
# Serwer czyta PORT (domyślnie 3000) i nasłuchuje na 0.0.0.0; API działa przez tsx (zależność apps/api).
CMD ["pnpm", "start"]
