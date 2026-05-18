FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY libs ./libs
COPY services ./services
COPY apps ./apps
RUN npm ci
RUN npm run build --workspace @agent-harness/contracts \
  && npm run build --workspace @agent-harness/shared
RUN npx tsc --project services/hermes-adapter/tsconfig.json
COPY config ./config

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/libs ./libs
COPY --from=builder /app/config ./config
COPY --from=builder /app/services/hermes-adapter/dist ./dist
RUN addgroup -g 1001 -S appgroup && \
    adduser -u 1001 -S appuser -G appgroup && \
    mkdir -p /app/logs && chown appuser:appgroup /app/logs
USER appuser
EXPOSE 3000
CMD ["node", "dist/index.js"]
