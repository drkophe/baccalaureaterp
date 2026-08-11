# syntax=docker/dockerfile:1
#
# Image du serveur temps reel. Construite depuis la RACINE du depot :
#   docker build -f apps/server/Dockerfile -t bacc-server .
# (le workspace `@bacc/shared` doit etre dans le contexte de build)

FROM node:22-alpine AS base
ENV PNPM_HOME=/usr/local/bin
WORKDIR /app

# --------------------------------------------------------------------------
# Dependances : couche mise en cache tant que les manifestes ne bougent pas.
# --------------------------------------------------------------------------
FROM base AS deps
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
RUN npm ci --workspace @bacc/shared --workspace @bacc/server --include-workspace-root

# --------------------------------------------------------------------------
# Compilation TypeScript (shared puis server).
# --------------------------------------------------------------------------
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/server apps/server
RUN npm run build --workspace @bacc/shared \
  && npm run build --workspace @bacc/server

# --------------------------------------------------------------------------
# Image finale : uniquement les dependances de production et le JS compile.
# --------------------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
RUN npm ci --omit=dev --workspace @bacc/shared --workspace @bacc/server --include-workspace-root \
  && npm cache clean --force

COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/server/dist apps/server/dist

# Le process ne tourne pas en root.
USER node
EXPOSE 4000

# Le health check reflete l'etat reel du store, pas seulement celui du process.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/server/dist/index.js"]
