FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY libs ./libs
COPY services ./services
COPY apps ./apps
RUN npm ci
RUN npm run build --workspace @agent-harness/shared \
  && npm run build --workspace @agent-harness/audit
RUN npx tsc --project apps/web-portal/tsconfig.json
COPY config ./config

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/libs ./libs
COPY --from=builder /app/config ./config
COPY --from=builder /app/apps/web-portal/dist ./dist
COPY --from=builder /app/apps/web-portal/static ./static
RUN addgroup -g 1001 -S appgroup && \
    adduser -u 1001 -S appuser -G appgroup && \
    mkdir -p /app/logs && chown appuser:appgroup /app/logs && \
    touch /app/.env && chown appuser:appgroup /app/.env
USER appuser
EXPOSE 3000
CMD ["node", "dist/index.js"]
