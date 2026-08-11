# syntax=docker/dockerfile:1
#
# Image du front Next.js. Construite depuis la RACINE du depot :
#   docker build -f apps/web/Dockerfile -t bacc-web .

FROM node:22-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @bacc/shared --workspace @bacc/web --include-workspace-root

FROM deps AS build
# L'URL du serveur est figee dans le bundle a la compilation : elle doit etre
# fournie au build, pas seulement au runtime.
ARG NEXT_PUBLIC_SERVER_URL=http://localhost:4000
ENV NEXT_PUBLIC_SERVER_URL=$NEXT_PUBLIC_SERVER_URL
ENV NEXT_TELEMETRY_DISABLED=1

COPY tsconfig.base.json eslint.config.js ./
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN npm run build --workspace @bacc/shared \
  && npm run build --workspace @bacc/web

FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev --workspace @bacc/shared --workspace @bacc/web --include-workspace-root \
  && npm cache clean --force

COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/web/.next apps/web/.next
COPY --from=build /app/apps/web/next.config.mjs apps/web/
COPY --from=build /app/apps/web/public apps/web/public

USER node
EXPOSE 3000

CMD ["npm", "run", "start", "--workspace", "@bacc/web"]
