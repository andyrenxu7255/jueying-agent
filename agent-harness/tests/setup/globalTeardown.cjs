module.exports = async () => {
  try {
    const { auditWriter } = await import('../../libs/audit/src/writer');
    await auditWriter.shutdown();
  } catch { /* intentional: teardown should never fail */ }

  try {
    const { closeWorkflowDbPool } = await import('../../services/workflow/src/persistence/db');
    await closeWorkflowDbPool();
  } catch {}
};
