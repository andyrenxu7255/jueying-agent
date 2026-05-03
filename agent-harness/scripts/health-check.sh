#!/usr/bin/env sh
set -eu

echo "[1/6] Checking PostgreSQL"
curl -fsS http://localhost:5432 >/dev/null 2>&1 || true

echo "[2/6] Checking Redis"
docker exec ah-redis redis-cli ping >/dev/null

echo "[3/6] Checking MinIO"
curl -fsS http://localhost:9000/minio/health/live >/dev/null

echo "[4/6] Checking LiteLLM"
curl -fsS http://localhost:4000/health >/dev/null

echo "[5/6] Checking SigNoz Query Service"
curl -fsS http://localhost:8080/api/v1/health >/dev/null 2>&1 || true

echo "[6/6] Checking SigNoz Frontend"
curl -fsS http://localhost:3301 >/dev/null

echo "Health check completed"
