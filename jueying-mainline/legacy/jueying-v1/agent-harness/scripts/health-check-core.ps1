$ErrorActionPreference = 'Stop'

Write-Host "[1/3] Checking Redis container"
docker exec ah-redis redis-cli ping | Out-Null

Write-Host "[2/3] Checking PostgreSQL container"
docker exec ah-postgres pg_isready -U agent_harness -d agent_harness | Out-Null

Write-Host "[3/3] Checking MinIO"
Invoke-WebRequest -UseBasicParsing "http://localhost:9000/minio/health/live" | Out-Null

Write-Host "Core health check completed"
