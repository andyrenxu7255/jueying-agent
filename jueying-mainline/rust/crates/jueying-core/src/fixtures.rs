use std::{collections::HashSet, fs, path::Path};

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

use crate::{
    AgentOutput, Evidence, ExternalFactMirror, ExternalWritebackIntent, InformationGap,
    ManagementCommandCenter, SalesGateCheck, SalesGateModel, TaskGraph, Validate, ValidationIssue,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FixtureState {
    pub task_graph: TaskGraph,
    pub gaps: Vec<InformationGap>,
    pub evidence: Vec<Evidence>,
    pub gate_checks: Vec<SalesGateCheck>,
    pub mirrors: Vec<ExternalFactMirror>,
    pub writeback_intents: Vec<ExternalWritebackIntent>,
    pub agent_outputs: Vec<AgentOutput>,
    pub management: ManagementCommandCenter,
}

pub fn load_json<T: DeserializeOwned>(path: &Path) -> Result<T, FixtureError> {
    let text = fs::read_to_string(path).map_err(|source| FixtureError::Read {
        path: path.display().to_string(),
        source,
    })?;
    serde_json::from_str(&text).map_err(|source| FixtureError::Parse {
        path: path.display().to_string(),
        source,
    })
}

pub fn load_p1_fixture_state(root: &Path) -> Result<FixtureState, FixtureError> {
    let dir = root.join("fixtures/p1-demo");
    Ok(FixtureState {
        task_graph: load_json(&dir.join("task-graph.sales-discover.json"))?,
        gaps: load_json(&dir.join("information-gaps.json"))?,
        evidence: load_json(&dir.join("evidence.json"))?,
        gate_checks: load_json(&dir.join("sales-gate-checks.json"))?,
        mirrors: load_json(&dir.join("external-fact-mirrors.json"))?,
        writeback_intents: load_json(&dir.join("external-writeback-intents.json"))?,
        agent_outputs: load_json(&dir.join("agent-outputs.json"))?,
        management: load_json(&dir.join("management-command-center.json"))?,
    })
}

#[cfg(test)]
pub(crate) fn workspace_root() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize()
        .expect("workspace root resolves")
}

pub fn validate_fixture_state(state: &FixtureState) -> Vec<ValidationIssue> {
    let mut issues = vec![];
    issues.extend(prefix("taskGraph", state.task_graph.validate()));
    for item in &state.gaps {
        issues.extend(prefix(
            &format!("informationGap {}", item.id),
            item.validate(),
        ));
    }
    for item in &state.evidence {
        issues.extend(prefix(&format!("evidence {}", item.id), item.validate()));
    }
    for item in &state.gate_checks {
        issues.extend(prefix(
            &format!("salesGateCheck {}", item.id),
            item.validate(),
        ));
    }
    for item in &state.mirrors {
        issues.extend(prefix(
            &format!("externalFactMirror {}", item.id),
            item.validate(),
        ));
    }
    for item in &state.writeback_intents {
        issues.extend(prefix(
            &format!("externalWritebackIntent {}", item.id),
            item.validate(),
        ));
    }
    for item in &state.agent_outputs {
        issues.extend(prefix(&format!("agentOutput {}", item.id), item.validate()));
    }
    issues.extend(prefix(
        "managementCommandCenter",
        state.management.validate(),
    ));
    issues.extend(validate_fixture_references(state));
    issues
}

pub fn validate_fixture_state_with_sales_model(
    state: &FixtureState,
    sales_model: &SalesGateModel,
) -> Vec<ValidationIssue> {
    let mut issues = validate_fixture_state(state);
    issues.extend(validate_sales_gate_authority(state, sales_model));
    issues
}

fn validate_fixture_references(state: &FixtureState) -> Vec<ValidationIssue> {
    let mut issues = vec![];
    let task_ids: HashSet<&str> = state
        .task_graph
        .tasks
        .iter()
        .map(|task| task.id.as_str())
        .collect();
    let gap_ids: HashSet<&str> = state.gaps.iter().map(|gap| gap.id.as_str()).collect();
    let evidence_ids: HashSet<&str> = state.evidence.iter().map(|item| item.id.as_str()).collect();
    let mirror_ids: HashSet<&str> = state.mirrors.iter().map(|item| item.id.as_str()).collect();

    for task in &state.task_graph.tasks {
        for gap_id in &task.information_gap_ids {
            if !gap_ids.contains(gap_id.as_str()) {
                issues.push(ValidationIssue::new(
                    format!(
                        "fixtureReferences taskGraph.tasks.{}.information_gap_ids",
                        task.id
                    ),
                    format!("unknown information gap: {gap_id}"),
                ));
            }
        }
        for evidence_id in &task.evidence_ids {
            if !evidence_ids.contains(evidence_id.as_str()) {
                issues.push(ValidationIssue::new(
                    format!("fixtureReferences taskGraph.tasks.{}.evidence_ids", task.id),
                    format!("unknown evidence: {evidence_id}"),
                ));
            }
        }
        for external_ref in &task.external_refs {
            if !mirror_ids.contains(external_ref.mirror_id.as_str()) {
                issues.push(ValidationIssue::new(
                    format!(
                        "fixtureReferences taskGraph.tasks.{}.external_refs",
                        task.id
                    ),
                    format!("unknown external mirror: {}", external_ref.mirror_id),
                ));
            }
        }
    }

    for gap in &state.gaps {
        if !task_ids.contains(gap.task_id.as_str()) {
            issues.push(ValidationIssue::new(
                format!("fixtureReferences informationGap {} $.task_id", gap.id),
                format!("unknown task: {}", gap.task_id),
            ));
        }
        for evidence_id in &gap.closed_by_evidence_ids {
            if !evidence_ids.contains(evidence_id.as_str()) {
                issues.push(ValidationIssue::new(
                    format!(
                        "fixtureReferences informationGap {} $.closed_by_evidence_ids",
                        gap.id
                    ),
                    format!("unknown evidence: {evidence_id}"),
                ));
            }
        }
    }

    for evidence in &state.evidence {
        if let Some(task_id) = &evidence.task_id {
            if !task_ids.contains(task_id.as_str()) {
                issues.push(ValidationIssue::new(
                    format!("fixtureReferences evidence {} $.task_id", evidence.id),
                    format!("unknown task: {task_id}"),
                ));
            }
        }
        if let Some(gap_id) = &evidence.gap_id {
            if !gap_ids.contains(gap_id.as_str()) {
                issues.push(ValidationIssue::new(
                    format!("fixtureReferences evidence {} $.gap_id", evidence.id),
                    format!("unknown information gap: {gap_id}"),
                ));
            }
        }
    }

    for check in &state.gate_checks {
        for evidence_id in &check.evidence_ids {
            if !evidence_ids.contains(evidence_id.as_str()) {
                issues.push(ValidationIssue::new(
                    format!(
                        "fixtureReferences salesGateCheck {} $.evidence_ids",
                        check.id
                    ),
                    format!("unknown evidence: {evidence_id}"),
                ));
            }
        }
        for gap_id in &check.information_gap_ids {
            if !gap_ids.contains(gap_id.as_str()) {
                issues.push(ValidationIssue::new(
                    format!(
                        "fixtureReferences salesGateCheck {} $.information_gap_ids",
                        check.id
                    ),
                    format!("unknown information gap: {gap_id}"),
                ));
            }
        }
    }

    for intent in &state.writeback_intents {
        if let Some(task_id) = &intent.source.task_id {
            if !task_ids.contains(task_id.as_str()) {
                issues.push(ValidationIssue::new(
                    format!(
                        "fixtureReferences externalWritebackIntent {} $.source.task_id",
                        intent.id
                    ),
                    format!("unknown task: {task_id}"),
                ));
            }
        }
        for evidence_id in &intent.source.evidence_ids {
            if !evidence_ids.contains(evidence_id.as_str()) {
                issues.push(ValidationIssue::new(
                    format!(
                        "fixtureReferences externalWritebackIntent {} $.source.evidence_ids",
                        intent.id
                    ),
                    format!("unknown evidence: {evidence_id}"),
                ));
            }
        }
    }

    issues
}

fn validate_sales_gate_authority(
    state: &FixtureState,
    sales_model: &SalesGateModel,
) -> Vec<ValidationIssue> {
    let gate_index = crate::sales::build_sales_gate_index(sales_model);
    let mut issues = vec![];

    for check in &state.gate_checks {
        let Some(gate) = gate_index.get(&check.gate_id) else {
            issues.push(ValidationIssue::new(
                format!("salesGateAuthority salesGateCheck {} $.gate_id", check.id),
                format!("unknown gate id: {}", check.gate_id),
            ));
            continue;
        };
        if gate.stage != check.stage {
            issues.push(ValidationIssue::new(
                format!("salesGateAuthority salesGateCheck {} $.stage", check.id),
                format!("gate {} belongs to {:?}", check.gate_id, gate.stage),
            ));
        }
    }

    issues
}

fn prefix(kind: &str, issues: Vec<ValidationIssue>) -> Vec<ValidationIssue> {
    issues
        .into_iter()
        .map(|mut issue| {
            issue.path = format!("{kind} {}", issue.path);
            issue
        })
        .collect()
}

#[derive(Debug, thiserror::Error)]
pub enum FixtureError {
    #[error("failed to read {path}: {source}")]
    Read {
        path: String,
        source: std::io::Error,
    },
    #[error("failed to parse {path}: {source}")]
    Parse {
        path: String,
        source: serde_json::Error,
    },
}

#[cfg(test)]
mod tests {
    use super::{
        load_json, load_p1_fixture_state, validate_fixture_state,
        validate_fixture_state_with_sales_model, workspace_root,
    };

    #[test]
    fn p1_fixture_state_passes_rust_contracts() {
        let root = workspace_root();
        let state = load_p1_fixture_state(&root).unwrap();
        let issues = validate_fixture_state(&state);
        assert!(issues.is_empty(), "{issues:?}");
    }

    #[test]
    fn fixture_reference_validation_rejects_dangling_ids() {
        let root = workspace_root();
        let mut state = load_p1_fixture_state(&root).unwrap();
        state.task_graph.tasks[0]
            .evidence_ids
            .push("ev_missing_fixture_reference".to_string());
        state.gaps[0].task_id = "task_missing_fixture_reference".to_string();
        let issues = validate_fixture_state(&state);
        let messages = issues
            .into_iter()
            .map(|issue| issue.message)
            .collect::<Vec<_>>()
            .join("\n");

        assert!(messages.contains("unknown evidence: ev_missing_fixture_reference"));
        assert!(messages.contains("unknown task: task_missing_fixture_reference"));
    }

    #[test]
    fn fixture_sales_gate_authority_rejects_unknown_gate_and_stage_mismatch() {
        let root = workspace_root();
        let mut state = load_p1_fixture_state(&root).unwrap();
        let sales_model: crate::SalesGateModel =
            load_json(&root.join("docs/sales-six-step-gates.json")).unwrap();
        state.gate_checks[0].gate_id = "D-G999".to_string();
        state.gate_checks[1].stage = crate::SalesStage::Scope;

        let issues = validate_fixture_state_with_sales_model(&state, &sales_model);
        let messages = issues
            .into_iter()
            .map(|issue| issue.message)
            .collect::<Vec<_>>()
            .join("\n");

        assert!(messages.contains("unknown gate id: D-G999"));
        assert!(messages.contains("gate D-G7 belongs to Discover"));
    }
}
