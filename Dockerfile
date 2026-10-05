FROM node:22-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

FROM base AS build
WORKDIR /repo/apps/jobs/reprocessar-keywords
COPY apps/api/prisma/schema.prisma /repo/apps/api/prisma/schema.prisma
COPY apps/jobs/reprocessar-keywords/package.json apps/jobs/reprocessar-keywords/package-lock.json ./
COPY apps/jobs/reprocessar-keywords/scripts ./scripts
RUN npm ci
COPY apps/jobs/reprocessar-keywords/tsconfig.json ./
COPY apps/jobs/reprocessar-keywords/src ./src
RUN npm run build

FROM base AS deps
WORKDIR /repo/apps/jobs/reprocessar-keywords
COPY apps/api/prisma/schema.prisma /repo/apps/api/prisma/schema.prisma
COPY apps/jobs/reprocessar-keywords/package.json apps/jobs/reprocessar-keywords/package-lock.json ./
COPY apps/jobs/reprocessar-keywords/scripts ./scripts
RUN npm ci --omit=dev
RUN npm prune --omit=dev --omit=optional --ignore-scripts

FROM base
WORKDIR /app
ENV NODE_ENV=production
RUN chown node:node /app
COPY --from=deps /repo/apps/jobs/reprocessar-keywords/node_modules ./node_modules
COPY --from=build /repo/apps/jobs/reprocessar-keywords/dist ./dist
USER node
CMD ["node", "dist/main.js"]
