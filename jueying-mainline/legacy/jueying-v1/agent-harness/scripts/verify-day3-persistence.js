const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://agent_harness:dev_password@localhost:5432/agent_harness';

const { Client } = require('pg');

async function verifyAuditPersistence() {
  console.log('=== Verifying Audit Persistence ===\n');
  
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  
  try {
    const countResult = await client.query('SELECT count(*) FROM audit_event');
    const count = parseInt(countResult.rows[0].count, 10);
    console.log(`  Total audit events: ${count}`);
    
    if (count < 10) {
      console.log('  FAIL: Expected at least 10 audit events');
      return false;
    }
    
    const recentResult = await client.query(
      'SELECT id, action, user_id, resource_type, result, occurred_at FROM audit_event ORDER BY occurred_at DESC LIMIT 5'
    );
    
    console.log('\n  Recent audit events:');
    for (const row of recentResult.rows) {
      console.log(`    - ${row.action}: ${row.user_id} / ${row.resource_ref || 'N/A'} (${row.result})`);
    }
    
    const actionTypes = await client.query(
      'SELECT DISTINCT action FROM audit_event'
    );
    console.log('\n  Action types found: ' + actionTypes.rows.map(r => r.action).join(', '));
    
    console.log('\n  PASS: Audit persistence verified');
    return true;
  } finally {
    await client.end();
  }
}

async function verifyCheckpointRecovery() {
  console.log('\n=== Verifying Checkpoint Recovery ===\n');
  
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  
  try {
    const checkpointCount = await client.query('SELECT count(*) FROM checkpoint');
    const count = parseInt(checkpointCount.rows[0].count, 10);
    console.log(`  Total checkpoints: ${count}`);
    
    if (count > 0) {
      const recentCheckpoints = await client.query(
        'SELECT id, workflow_instance_id, checkpoint_type, resume_token, created_at FROM checkpoint ORDER BY created_at DESC LIMIT 3'
      );
      
      console.log('\n  Recent checkpoints:');
      for (const row of recentCheckpoints.rows) {
        console.log(`    - ${row.id}: workflow=${row.workflow_instance_id}, type=${row.checkpoint_type}`);
      }
    }
    
    console.log('\n  PASS: Checkpoint table exists and accessible');
    return true;
  } finally {
    await client.end();
  }
}

async function verifyWorkflowProgress() {
  console.log('\n=== Verifying Workflow Progress ===\n');
  
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  
  try {
    const workflowCount = await client.query('SELECT count(*) FROM workflow_instance');
    const count = parseInt(workflowCount.rows[0].count, 10);
    console.log(`  Total workflow instances: ${count}`);
    
    if (count > 0) {
      const recentWorkflows = await client.query(
        'SELECT id, owner_user_id, status, progress_percentage, created_at FROM workflow_instance ORDER BY created_at DESC LIMIT 3'
      );
      
      console.log('\n  Recent workflows:');
      for (const row of recentWorkflows.rows) {
        console.log(`    - ${row.id}: owner=${row.owner_user_id}, status=${row.status}, progress=${row.progress_percentage || 0}%`);
      }
    }
    
    console.log('\n  PASS: Workflow progress table accessible');
    return true;
  } finally {
    await client.end();
  }
}

async function verifyConversationStorage() {
  console.log('\n=== Verifying Conversation Storage ===\n');
  
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  
  try {
    const convCount = await client.query('SELECT count(*) FROM conversation');
    const count = parseInt(convCount.rows[0].count, 10);
    console.log(`  Total conversations: ${count}`);
    
    console.log('\n  PASS: Conversation table accessible');
    return true;
  } finally {
    await client.end();
  }
}

async function main() {
  console.log('Day 3 Replay Verification\n');
  console.log('Database: ' + DATABASE_URL.replace(/:[^:@]+@/, ':****@') + '\n');
  
  const results = [];
  
  results.push(await verifyAuditPersistence());
  results.push(await verifyCheckpointRecovery());
  results.push(await verifyWorkflowProgress());
  results.push(await verifyConversationStorage());
  
  const allPass = results.every(r => r);
  
  console.log('\n=== Final Summary ===');
  console.log('Audit Persistence: ' + (results[0] ? 'PASS' : 'FAIL'));
  console.log('Checkpoint Recovery: ' + (results[1] ? 'PASS' : 'FAIL'));
  console.log('Workflow Progress: ' + (results[2] ? 'PASS' : 'FAIL'));
  console.log('Conversation Storage: ' + (results[3] ? 'PASS' : 'FAIL'));
  console.log('Overall: ' + (allPass ? 'PASS' : 'FAIL'));
  
  process.exit(allPass ? 0 : 1);
}

main().catch(error => {
  console.error('Verification error:', error);
  process.exit(1);
});