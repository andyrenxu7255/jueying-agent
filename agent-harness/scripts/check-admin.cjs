const { execSync } = require('child_process');
const r = execSync('docker exec ah-postgres psql -U agent_harness -d agent_harness -t -c "SELECT COUNT(*) FROM \\\"user\\\" WHERE role = \\\'admin\\\'"', { encoding: 'utf8' });
console.log('admin count:', r.trim());
const r2 = execSync('docker exec ah-postgres psql -U agent_harness -d agent_harness -t -c "SELECT username, role FROM \\\"user\\\" ORDER BY username"', { encoding: 'utf8' });
console.log('all users:', r2.trim());
