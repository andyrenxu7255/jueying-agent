const { execSync } = require('child_process');
const result = execSync('docker exec ah-postgres psql -U agent_harness -d agent_harness -c "SELECT id, username, role, status FROM \\\"user\\\" ORDER BY username;"', { encoding: 'utf8', cwd: 'D:\\teamclaw\\agent-harness' });
console.log(result);
