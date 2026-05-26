const { execSync } = require('child_process');

async function main() {
  console.log('=== Checking DB tables ===');

  function psql(query) {
    try {
      const r = execSync(`docker exec ah-postgres psql -U agent_harness -d agent_harness -t -c "${query}"`, { encoding: 'utf8' });
      return r.trim();
    } catch(e) {
      return 'ERROR: ' + e.message;
    }
  }

  // Check org_policy table
  const p = psql("SELECT COUNT(*) FROM org_policy");
  console.log('org_policy count:', p);

  // Check org_invitation table
  const i = psql("SELECT COUNT(*) FROM org_invitation");
  console.log('org_invitation count:', i);

  // Check migrations that have been run
  const m = psql("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('org_policy', 'org_invitation')");
  console.log('Existing tables:', m);
}
main();
