# The fevo dashboard: the API (apps/api) serving the built web app (apps/web) on one origin.
#   docker build -t fevo . && docker run -p 8787:8787 --env-file .env fevo
# Needs DATABASE_URL, AUTH_USER, AUTH_PASSWORD_HASH, SESSION_SECRET and PUBLISH_KEY (see apps/api/src/main.ts).
FROM node:24-slim AS build
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@fevo/web... --filter=@fevo/api...

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8787 WEB_DIST=/app/apps/web/dist
COPY --from=build /app /app
EXPOSE 8787
USER node
CMD ["node", "apps/api/src/main.ts"]
