export function evaluateSalesStage({ stage, opportunityId, ownerId, evidence = [], existingGapIds = [] }, salesGateModel) {
  const stageConfig = salesGateModel.stages?.[stage];
  if (!stageConfig) {
    throw new Error(`Unknown sales stage: ${stage}`);
  }

  const evidenceByType = groupEvidenceByType(evidence);
  const checks = [];
  const informationGaps = [];

  for (const gate of stageConfig.gates) {
    const matchingEvidence = [];
    for (const evidenceType of gate.evidence_types ?? []) {
      matchingEvidence.push(...(evidenceByType.get(evidenceType) ?? []));
    }

    const gateIdForObject = gate.id.toLowerCase().replace("-", "_");
    const gapId = `gap_${opportunityId}_${gateIdForObject}`;
    const hasEvidence = matchingEvidence.length > 0;

    if (!hasEvidence) {
      informationGaps.push({
        id: gapId,
        task_id: `task_${opportunityId}_${gateIdForObject}`,
        status: existingGapIds.includes(gapId) ? "collecting" : "open",
        question: gate.questions[0],
        reason: `${gate.id} cannot be confirmed without evidence: ${(gate.evidence_types ?? []).join(", ")}`,
        collector_actor_id: ownerId,
        required_schema: {
          questions: gate.questions,
          recommended_activities: gate.recommended_activities
        },
        expected_evidence_types: gate.evidence_types,
        priority: priorityForGate(gate.id),
        created_at: "2026-05-26T00:00:00+08:00",
        closed_by_evidence_ids: []
      });
    }

    checks.push({
      id: `sgc_${opportunityId}_${gateIdForObject}`,
      opportunity_id: opportunityId,
      stage,
      gate_id: gate.id,
      status: hasEvidence ? "evidence_submitted" : "missing",
      evidence_ids: matchingEvidence.map((item) => item.id),
      information_gap_ids: hasEvidence ? [] : [gapId],
      recommended_activity_ids: hasEvidence ? [] : gate.recommended_activities.map((_, index) => `act_${gateIdForObject}_${index + 1}`),
      owner_id: ownerId,
      updated_at: "2026-05-26T00:00:00+08:00"
    });
  }

  return {
    stage,
    opportunity_id: opportunityId,
    checks,
    information_gaps: informationGaps
  };
}

function groupEvidenceByType(evidence) {
  const groups = new Map();
  for (const item of evidence) {
    if (!groups.has(item.evidence_type)) {
      groups.set(item.evidence_type, []);
    }
    groups.get(item.evidence_type).push(item);
  }
  return groups;
}

function priorityForGate(gateId) {
  if (["D-G1", "D-G4", "D-G7", "S-G5", "G-G1", "G-G4", "N-G4"].includes(gateId)) {
    return "high";
  }
  return "medium";
}
