FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json tsconfig.json ./
COPY libs ./libs
COPY apps/gateway-adapter ./apps/gateway-adapter
RUN npm install
RUN npm run build --workspace @agent-harness/contracts \
  && npm run build --workspace @agent-harness/shared \
  && npm run build --workspace @agent-harness/policy
RUN npx tsc --project apps/gateway-adapter/tsconfig.json
COPY config ./config

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/libs ./libs
COPY --from=builder /app/config ./config
COPY --from=builder /app/apps/gateway-adapter/dist ./dist
RUN addgroup -g 1001 -S appgroup && \
    adduser -u 1001 -S appuser -G appgroup && \
    mkdir -p /app/.runtime && chown appuser:appgroup /app/.runtime
USER appuser
EXPOSE 3000
CMD ["node", "dist/index.js"]
