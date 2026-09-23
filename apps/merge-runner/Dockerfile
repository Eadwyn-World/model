# Merge runner image for the Cloudflare Container (see apps/aggregator/wrangler.jsonc)
# or any Pod GPU host. Build from the repository root:
#   docker build -f apps/merge-runner/Dockerfile .
FROM node:22-slim AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile --filter "@eadwyn/merge-runner..." \
 && pnpm --filter @eadwyn/merge-runner build

# The build bundles every dependency into dist/index.js; the runtime image is Node alone.
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080 OBJECT_STORE=s3 RUNNER_NAME=container LOG_FORMAT=json
COPY --from=build /repo/apps/merge-runner/dist ./dist
USER node
EXPOSE 8080
CMD ["node", "dist/index.js"]
