use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{
    ExternalWritebackIntent, WritebackOperation, WritebackPolicyDecision, WritebackRiskLevel,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WritebackPolicyResult {
    pub decision: WritebackPolicyDecision,
    pub reasons: Vec<String>,
}

pub fn decide_writeback_policy(intent: &ExternalWritebackIntent) -> WritebackPolicyResult {
    let mut reasons = vec![];

    if intent.risk_level == WritebackRiskLevel::High {
        reasons.push("high-risk intent requires human confirmation".to_string());
        return result(WritebackPolicyDecision::NeedsConfirmation, reasons);
    }

    if matches!(
        intent.operation,
        WritebackOperation::UpdateField | WritebackOperation::UpdateStatus
    ) {
        reasons.push(format!("{:?} is a high-risk operation", intent.operation));
        return result(WritebackPolicyDecision::NeedsConfirmation, reasons);
    }

    let payload_fields = flatten_payload_keys(&intent.payload);
    let risky_fields: Vec<String> = payload_fields
        .into_iter()
        .filter(|field| {
            matches!(
                field.as_str(),
                "amount"
                    | "stage"
                    | "expected_close_date"
                    | "close_date"
                    | "status"
                    | "assignee"
                    | "due_date"
                    | "priority"
                    | "owner"
                    | "budget"
            )
        })
        .collect();
    if !risky_fields.is_empty() {
        reasons.push(format!(
            "payload touches high-risk field(s): {}",
            risky_fields.join(", ")
        ));
        return result(WritebackPolicyDecision::NeedsConfirmation, reasons);
    }

    if intent.risk_level == WritebackRiskLevel::Medium {
        reasons.push("medium-risk intent defaults to confirmation".to_string());
        return result(WritebackPolicyDecision::NeedsConfirmation, reasons);
    }

    if matches!(
        intent.operation,
        WritebackOperation::CreateNote
            | WritebackOperation::CreateTask
            | WritebackOperation::CreateComment
            | WritebackOperation::AddLink
    ) {
        reasons.push(format!("{:?} is low-risk and auditable", intent.operation));
        return result(WritebackPolicyDecision::AutoExecute, reasons);
    }

    reasons.push("operation is not explicitly allowed for automatic execution".to_string());
    result(WritebackPolicyDecision::ManualOnly, reasons)
}

pub fn policy_decision_allows(
    stored: &WritebackPolicyDecision,
    required: &WritebackPolicyDecision,
) -> bool {
    policy_decision_rank(stored) >= policy_decision_rank(required)
}

fn policy_decision_rank(decision: &WritebackPolicyDecision) -> u8 {
    match decision {
        WritebackPolicyDecision::AutoExecute => 0,
        WritebackPolicyDecision::NeedsConfirmation => 1,
        WritebackPolicyDecision::ManualOnly => 2,
        WritebackPolicyDecision::Reject => 3,
    }
}

fn result(decision: WritebackPolicyDecision, reasons: Vec<String>) -> WritebackPolicyResult {
    WritebackPolicyResult { decision, reasons }
}

pub fn flatten_payload_keys(value: &Value) -> Vec<String> {
    let Some(object) = value.as_object() else {
        return vec![];
    };
    let mut keys = vec![];
    for (key, child) in object {
        keys.push(key.clone());
        if child.as_object().is_some() {
            keys.extend(flatten_payload_keys(child));
        }
    }
    keys
}

#[cfg(test)]
mod tests {
    use crate::{fixtures::load_json, ExternalWritebackIntent, WritebackPolicyDecision};

    use super::{decide_writeback_policy, policy_decision_allows};

    #[test]
    fn allows_low_risk_notes_and_blocks_risky_fields() {
        let root = crate::fixtures::workspace_root();
        let intents: Vec<ExternalWritebackIntent> =
            load_json(&root.join("fixtures/p1-demo/external-writeback-intents.json")).unwrap();
        let low = decide_writeback_policy(&intents[0]);
        assert_eq!(low.decision, WritebackPolicyDecision::AutoExecute);
        let mut risky = intents[0].clone();
        risky.payload = serde_json::json!({ "amount": 1000000 });
        let high = decide_writeback_policy(&risky);
        assert_eq!(high.decision, WritebackPolicyDecision::NeedsConfirmation);
    }

    #[test]
    fn stored_policy_may_be_more_conservative_but_not_more_permissive() {
        assert!(policy_decision_allows(
            &WritebackPolicyDecision::ManualOnly,
            &WritebackPolicyDecision::NeedsConfirmation
        ));
        assert!(!policy_decision_allows(
            &WritebackPolicyDecision::AutoExecute,
            &WritebackPolicyDecision::NeedsConfirmation
        ));
    }
}
