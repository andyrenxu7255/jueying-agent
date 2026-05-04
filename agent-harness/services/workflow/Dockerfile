FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json tsconfig.json ./
COPY libs ./libs
COPY services/workflow ./services/workflow
RUN npm install
RUN npm run build --workspace @agent-harness/contracts \
  && npm run build --workspace @agent-harness/shared \
  && npm run build --workspace @agent-harness/policy \
  && npm run build --workspace @agent-harness/audit
RUN npx tsc --project services/workflow/tsconfig.json
COPY config ./config

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
RUN npm prune --production 2>/dev/null; exit 0
COPY --from=builder /app/libs ./libs
COPY --from=builder /app/config ./config
COPY --from=builder /app/services/workflow/dist ./dist
RUN addgroup -g 1001 -S appgroup && \
    adduser -u 1001 -S appuser -G appgroup && \
    mkdir -p /app/.runtime && chown appuser:appgroup /app/.runtime && mkdir -p /app/logs && chown appuser:appgroup /app/logs
USER appuser
EXPOSE 3000
CMD ["node", "dist/index.js"]
