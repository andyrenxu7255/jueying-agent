const { execSync } = require('child_process');

async function main() {
  // Check DB users via psql
  console.log('=== DB Users ===');
  try {
    const r = execSync('docker exec ah-postgres psql -U agent_harness -d agent_harness -t -c "SELECT id, username, role, status FROM \\\"user\\\" LIMIT 10;"', { encoding: 'utf8' });
    console.log(r);
  } catch(e) { console.log('psql error:', e.message); }

  // Check Redis sessions
  console.log('=== Redis Sessions ===');
  try {
    const r = execSync('docker exec ah-redis redis-cli KEYS "ah:session:*"', { encoding: 'utf8' });
    console.log('Session keys:', r.trim());
    if (r.trim()) {
      const keys = r.trim().split('\n').filter(k => k);
      for (const key of keys.slice(0, 3)) {
        const val = execSync(`docker exec ah-redis redis-cli GET "${key}"`, { encoding: 'utf8' });
        console.log(`  ${key} = ${val.trim()}`);
      }
    }
  } catch(e) { console.log('redis error:', e.message); }
}
main();
