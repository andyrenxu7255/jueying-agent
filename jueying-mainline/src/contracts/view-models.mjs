export function buildOperatingConsoleViewModel({ taskGraph, gateChecks, mirrors, writebackIntents }) {
  const taskCounts = countBy(taskGraph.tasks, "status");
  const gateCounts = countBy(gateChecks, "status");
  const staleMirrors = mirrors.filter((mirror) => mirror.freshness !== "fresh");
  const pendingWritebacks = writebackIntents.filter((intent) => intent.policy_decision !== "auto_execute");

  return {
    run_id: taskGraph.run_id,
    task_graph_id: taskGraph.id,
    task_graph_status: taskGraph.status,
    task_counts: taskCounts,
    gate_counts: gateCounts,
    stale_mirror_count: staleMirrors.length,
    pending_writeback_count: pendingWritebacks.length,
    primary_alerts: [
      ...alertIf(taskCounts.needs_info > 0, `${taskCounts.needs_info} task(s) need information`),
      ...alertIf(gateCounts.missing > 0, `${gateCounts.missing} sales gate(s) missing evidence`),
      ...alertIf(staleMirrors.length > 0, `${staleMirrors.length} external mirror(s) stale`),
      ...alertIf(pendingWritebacks.length > 0, `${pendingWritebacks.length} writeback intent(s) need confirmation`)
    ]
  };
}

export function buildTaskGraphViewModel({ taskGraph, evidence, gaps }) {
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const gapsById = new Map(gaps.map((gap) => [gap.id, gap]));

  return {
    id: taskGraph.id,
    run_id: taskGraph.run_id,
    version: taskGraph.version,
    status: taskGraph.status,
    tasks: taskGraph.tasks.map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      owner: {
        type: task.owner_actor_type,
        id: task.owner_actor_id
      },
      depends_on: task.depends_on ?? [],
      evidence: (task.evidence_ids ?? []).map((id) => evidenceById.get(id)).filter(Boolean),
      information_gaps: (task.information_gap_ids ?? []).map((id) => gapsById.get(id)).filter(Boolean),
      acceptance_criteria: task.acceptance_criteria,
      due_at: task.due_at
    }))
  };
}

export function buildInformationGapInboxViewModel({ gaps, taskGraph }) {
  const tasksById = new Map(taskGraph.tasks.map((task) => [task.id, task]));
  return {
    open_count: gaps.filter((gap) => !["closed", "waived"].includes(gap.status)).length,
    gaps: gaps.map((gap) => {
      const task = tasksById.get(gap.task_id);
      return {
        id: gap.id,
        status: gap.status,
        priority: gap.priority,
        question: gap.question,
        reason: gap.reason,
        collector_actor_id: gap.collector_actor_id,
        task: task ? { id: task.id, title: task.title } : null,
        expected_evidence_types: gap.expected_evidence_types,
        due_at: gap.due_at
      };
    })
  };
}

export function buildExternalSyncConsoleViewModel({ mirrors, writebackIntents }) {
  return {
    mirrors: mirrors.map((mirror) => ({
      id: mirror.id,
      system_type: mirror.system_type,
      provider: mirror.provider,
      object_type: mirror.object_type,
      external_id: mirror.external_id,
      external_url: mirror.external_url,
      freshness: mirror.freshness,
      mirrored_at: mirror.mirrored_at
    })),
    writeback_queue: writebackIntents.map((intent) => ({
      id: intent.id,
      system_type: intent.system_type,
      provider: intent.provider,
      operation: intent.operation,
      target: intent.target,
      risk_level: intent.risk_level,
      policy_decision: intent.policy_decision,
      created_at: intent.created_at
    }))
  };
}

function countBy(items, field) {
  const counts = {};
  for (const item of items) {
    const key = item[field];
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function alertIf(condition, message) {
  return condition ? [message] : [];
}
