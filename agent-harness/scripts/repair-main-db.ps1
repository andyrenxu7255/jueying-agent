$ErrorActionPreference = 'Stop'

Write-Host "[1/4] Recreating public schema in agent_harness"
docker exec ah-postgres psql -U agent_harness -d agent_harness -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;" | Out-Null

Write-Host "[2/4] Re-applying database extensions"
Get-Content "./db/init/001_init_extensions.sql" | docker exec -i ah-postgres psql -U agent_harness -d agent_harness | Out-Null

Write-Host "[3/4] Re-applying application migrations"
node scripts/apply-sql-migrations.js

Write-Host "[4/4] Verifying public tables"
docker exec ah-postgres psql -U agent_harness -d agent_harness -c "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename;"

Write-Host "Main database repair completed"
