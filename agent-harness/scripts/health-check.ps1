$ErrorActionPreference = 'Stop'

Write-Host "[1/5] Checking MinIO"
Invoke-WebRequest -UseBasicParsing "http://localhost:9000/minio/health/live" | Out-Null

Write-Host "[2/5] Checking LiteLLM"
Invoke-WebRequest -UseBasicParsing "http://localhost:4000/health/liveliness" | Out-Null

Write-Host "[3/5] Checking SigNoz Frontend"
Invoke-WebRequest -UseBasicParsing "http://localhost:3301" | Out-Null

Write-Host "[4/5] Checking Redis container"
docker exec ah-redis redis-cli ping | Out-Null

Write-Host "[5/5] Checking PostgreSQL container"
docker exec ah-postgres pg_isready -U agent_harness -d agent_harness | Out-Null

Write-Host "Health check completed"
