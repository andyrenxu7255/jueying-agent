use std::collections::{BTreeMap, HashMap, HashSet};

use indexmap::IndexMap;
use serde::{Deserialize, Serialize};

use crate::{
    evidence_types_from_values, Evidence, EvidenceType, InformationGap, InformationGapStatus,
    Priority, SalesGateCheck, SalesGateStatus, SalesStage,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SalesGateModel {
    pub version: String,
    #[serde(default)]
    pub updated_at: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub authority_doc: Option<String>,
    #[serde(default)]
    pub gate_statuses: Vec<String>,
    pub stage_order: Vec<SalesStage>,
    pub stages: IndexMap<SalesStage, SalesStageConfig>,
    #[serde(default)]
    pub p1_exit_gates: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SalesStageConfig {
    pub label: String,
    pub goal: String,
    #[serde(default)]
    pub gates: Vec<SalesGateDefinition>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SalesGateDefinition {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub questions: Vec<String>,
    #[serde(default)]
    pub recommended_activities: Vec<String>,
    #[serde(default)]
    pub evidence_types: Vec<EvidenceType>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SalesGateIndexEntry {
    pub gate: SalesGateDefinition,
    pub stage: SalesStage,
    pub stage_label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SalesStageAudit {
    pub stage: SalesStage,
    pub opportunity_id: String,
    pub checks: Vec<SalesGateCheck>,
    pub information_gaps: Vec<InformationGap>,
}

pub fn build_sales_gate_index(model: &SalesGateModel) -> BTreeMap<String, SalesGateIndexEntry> {
    let mut index = BTreeMap::new();
    for (stage, stage_config) in &model.stages {
        for gate in &stage_config.gates {
            index.insert(
                gate.id.clone(),
                SalesGateIndexEntry {
                    gate: gate.clone(),
                    stage: stage.clone(),
                    stage_label: stage_config.label.clone(),
                },
            );
        }
    }
    index
}

pub fn expected_evidence_types(model: &SalesGateModel) -> Vec<EvidenceType> {
    let mut values = HashSet::new();
    for stage in model.stages.values() {
        for gate in &stage.gates {
            values.extend(gate.evidence_types.iter().cloned());
        }
    }
    let mut values: Vec<_> = values.into_iter().collect();
    values.sort_by_key(|value| serde_json::to_string(value).unwrap_or_default());
    values
}

pub fn gate_ids(model: &SalesGateModel) -> Vec<String> {
    build_sales_gate_index(model).into_keys().collect()
}

pub fn evaluate_sales_stage(
    stage: SalesStage,
    opportunity_id: &str,
    owner_id: &str,
    evidence: &[Evidence],
    existing_gap_ids: &[String],
    model: &SalesGateModel,
) -> Result<SalesStageAudit, String> {
    let Some(stage_config) = model.stages.get(&stage) else {
        return Err(format!("Unknown sales stage: {stage:?}"));
    };
    let evidence_by_type: HashMap<EvidenceType, Vec<&Evidence>> =
        evidence_types_from_values(evidence);
    let existing_gap_ids: HashSet<&str> = existing_gap_ids.iter().map(String::as_str).collect();
    let mut checks = vec![];
    let mut information_gaps = vec![];

    for gate in &stage_config.gates {
        let matching_evidence: Vec<&Evidence> = gate
            .evidence_types
            .iter()
            .flat_map(|kind| evidence_by_type.get(kind).into_iter().flatten().copied())
            .collect();
        let gate_id_for_object = gate.id.to_lowercase().replace('-', "_");
        let gap_id = format!("gap_{opportunity_id}_{gate_id_for_object}");
        let has_evidence = !matching_evidence.is_empty();

        if !has_evidence {
            information_gaps.push(InformationGap {
                id: gap_id.clone(),
                task_id: format!("task_{opportunity_id}_{gate_id_for_object}"),
                status: if existing_gap_ids.contains(gap_id.as_str()) {
                    InformationGapStatus::Collecting
                } else {
                    InformationGapStatus::Open
                },
                question: gate
                    .questions
                    .first()
                    .cloned()
                    .unwrap_or_else(|| format!("What evidence is needed for {}?", gate.id)),
                reason: format!(
                    "{} cannot be confirmed without evidence: {}",
                    gate.id,
                    gate.evidence_types
                        .iter()
                        .map(|kind| serde_json::to_string(kind)
                            .unwrap_or_default()
                            .trim_matches('"')
                            .to_string())
                        .collect::<Vec<_>>()
                        .join(", ")
                ),
                collector_actor_id: owner_id.to_string(),
                required_schema: serde_json::json!({
                    "questions": gate.questions,
                    "recommended_activities": gate.recommended_activities
                }),
                expected_evidence_types: Some(gate.evidence_types.clone()),
                priority: priority_for_gate(&gate.id),
                due_at: None,
                created_at: "2026-05-26T00:00:00+08:00".to_string(),
                closed_by_evidence_ids: vec![],
            });
        }

        checks.push(SalesGateCheck {
            id: format!("sgc_{opportunity_id}_{gate_id_for_object}"),
            opportunity_id: opportunity_id.to_string(),
            stage: stage.clone(),
            gate_id: gate.id.clone(),
            status: if has_evidence {
                SalesGateStatus::EvidenceSubmitted
            } else {
                SalesGateStatus::Missing
            },
            evidence_ids: matching_evidence
                .iter()
                .map(|item| item.id.clone())
                .collect(),
            information_gap_ids: if has_evidence { vec![] } else { vec![gap_id] },
            recommended_activity_ids: if has_evidence {
                vec![]
            } else {
                gate.recommended_activities
                    .iter()
                    .enumerate()
                    .map(|(index, _)| format!("act_{gate_id_for_object}_{}", index + 1))
                    .collect()
            },
            owner_id: owner_id.to_string(),
            updated_at: "2026-05-26T00:00:00+08:00".to_string(),
        });
    }

    Ok(SalesStageAudit {
        stage,
        opportunity_id: opportunity_id.to_string(),
        checks,
        information_gaps,
    })
}

pub fn priority_for_gate(gate_id: &str) -> Priority {
    if matches!(
        gate_id,
        "D-G1" | "D-G4" | "D-G7" | "S-G5" | "G-G1" | "G-G4" | "N-G4"
    ) {
        Priority::High
    } else {
        Priority::Medium
    }
}

#[cfg(test)]
mod tests {
    use crate::{fixtures::load_json, Evidence, SalesStage, Validate};

    use super::{build_sales_gate_index, evaluate_sales_stage, SalesGateModel};

    #[test]
    fn discover_gate_audit_matches_p1_shape() {
        let root = crate::fixtures::workspace_root();
        let model: SalesGateModel =
            load_json(&root.join("docs/sales-six-step-gates.json")).unwrap();
        let evidence: Vec<Evidence> =
            load_json(&root.join("fixtures/p1-demo/evidence.json")).unwrap();
        let audit = evaluate_sales_stage(
            SalesStage::Discover,
            "opp_acme_001",
            "user_sales_andy",
            &evidence,
            &[],
            &model,
        )
        .unwrap();
        assert_eq!(audit.checks.len(), 7);
        assert!(audit.checks.iter().all(|check| check.validate().is_empty()));
        assert_eq!(build_sales_gate_index(&model).len(), 27);
    }
}
