param(
  [switch]$WithLiteLLM,
  [switch]$WithObservability,
  [int]$RetryCount = 3
)

$ErrorActionPreference = 'Stop'

function Invoke-Retry {
  param(
    [scriptblock]$Action,
    [string]$Name,
    [int]$Attempts = 3,
    [int]$DelaySeconds = 10
  )

  for ($i = 1; $i -le $Attempts; $i++) {
    try {
      Write-Host "[$Name] attempt $i/$Attempts"
      & $Action
      if ($LASTEXITCODE -ne 0) {
        throw "Native command exited with code $LASTEXITCODE"
      }
      return
    }
    catch {
      if ($i -eq $Attempts) {
        throw
      }
      Write-Warning "[$Name] failed, retrying in $DelaySeconds seconds: $($_.Exception.Message)"
      Start-Sleep -Seconds $DelaySeconds
    }
  }
}

function Wait-ContainerReady {
  param(
    [string]$Name,
    [int]$TimeoutSeconds = 300
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)

  while ((Get-Date) -lt $deadline) {
    $status = (& docker inspect --format "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}" $Name 2>$null)
    if ($LASTEXITCODE -eq 0 -and $status) {
      $status = $status.Trim()
      if ($status -eq 'healthy' -or $status -eq 'running') {
        Write-Host "[$Name] status=$status"
        return
      }
    }
    Start-Sleep -Seconds 5
  }

  throw "Container '$Name' was not ready within $TimeoutSeconds seconds"
}

function Ensure-DatabaseExists {
  param(
    [string]$DatabaseName
  )

  $exists = docker exec ah-postgres psql -U agent_harness -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$DatabaseName'"
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to inspect database '$DatabaseName'"
  }

  if ($exists.Trim() -eq '1') {
    Write-Host "[$DatabaseName] database exists"
    return
  }

  Write-Host "[$DatabaseName] creating database"
  docker exec ah-postgres psql -U agent_harness -d postgres -c "CREATE DATABASE \"$DatabaseName\";" | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to create database '$DatabaseName'"
  }
}

Write-Host "Step 1/6: Build postgres image (classic builder for stability)"
$env:DOCKER_BUILDKIT = '0'
$env:COMPOSE_DOCKER_CLI_BUILD = '0'
Invoke-Retry -Name 'docker-compose-build-postgres' -Attempts $RetryCount -Action {
  docker compose build postgres
}

Write-Host "Step 2/6: Start core services (postgres, redis, minio)"
Invoke-Retry -Name 'docker-compose-up-core' -Attempts $RetryCount -Action {
  docker compose up -d postgres redis minio
}

Write-Host "Step 3/6: Wait for core containers"
Wait-ContainerReady -Name 'ah-postgres' -TimeoutSeconds 420
Wait-ContainerReady -Name 'ah-redis' -TimeoutSeconds 180
Wait-ContainerReady -Name 'ah-minio' -TimeoutSeconds 180

Write-Host "Step 4/6: Run core health checks"
./scripts/health-check-core.ps1

Write-Host "Step 5/6: Run database migration"
npm run db:migrate

if ($WithLiteLLM) {
  Write-Host "Step 6a/6: Start LiteLLM"
  Ensure-DatabaseExists -DatabaseName 'litellm'
  Invoke-Retry -Name 'docker-compose-up-litellm' -Attempts $RetryCount -Action {
    docker compose up -d litellm
  }
  Wait-ContainerReady -Name 'ah-litellm' -TimeoutSeconds 300
}

if ($WithObservability) {
  Write-Host "Step 6b/6: Start observability stack"
  Invoke-Retry -Name 'docker-compose-up-signoz' -Attempts $RetryCount -Action {
    docker compose up -d clickhouse signoz-query-service signoz-otel-collector signoz-frontend
  }
}

Write-Host "Bootstrap completed"
