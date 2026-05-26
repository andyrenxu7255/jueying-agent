@echo off
cd /d D:\teamclaw\agent-harness

set PORT=3001
set LITELLM_URL=http://localhost:4000
set EXECUTOR_URL=http://localhost:3002
start /b node services\workflow\dist\index.js

set PORT=3002
start /b node services\executor-gateway\dist\index.js

set PORT=3000
set WORKFLOW_URL=http://localhost:3001
start /b node apps\gateway-adapter\dist\index.js

echo Services started. Waiting 5 seconds...
timeout /t 5 /nobreak > nul
echo Running tests...
node tests\poc\m1-poc-test.js