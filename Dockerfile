# SignalProof — one container: the Vite-built dashboard and the Express/tRPC gateway with the
# relayer and proof worker. No database is required; set DATABASE_URL to persist across restarts.
#
#   docker build -t signalproof .
#   docker run --rm -p 3000:3000 --env-file .env signalproof
#
# The image needs the chain variables from .env.example. With only RPC URLs and the public contract
# addresses it serves a read-only dashboard; add the relayer keys to accept and settle measurements.

FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:22-alpine
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production
COPY package.json pnpm-lock.yaml ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile --prod
COPY --from=build /app/dist ./dist
EXPOSE 3000
# The server picks PORT from the environment (Fly and Render set it); 3000 otherwise.
CMD ["node", "dist/index.js"]
