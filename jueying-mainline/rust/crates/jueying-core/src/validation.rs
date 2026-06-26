use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ValidationIssue {
    pub path: String,
    pub message: String,
}

impl ValidationIssue {
    pub fn new(path: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            path: path.into(),
            message: message.into(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ValidationReport {
    pub ok: bool,
    pub issues: Vec<ValidationIssue>,
}

impl ValidationReport {
    pub fn from_issues(issues: Vec<ValidationIssue>) -> Self {
        Self {
            ok: issues.is_empty(),
            issues,
        }
    }
}

#[derive(Debug, Error, Serialize)]
#[error("invalid {kind} contract")]
pub struct ValidationError {
    pub kind: &'static str,
    pub issues: Vec<ValidationIssue>,
}

pub trait Validate {
    fn validate(&self) -> Vec<ValidationIssue>;
}

pub fn validate_contract<T: Validate>(value: &T) -> ValidationReport {
    ValidationReport::from_issues(value.validate())
}

pub fn assert_contract<T: Validate>(kind: &'static str, value: T) -> Result<T, ValidationError> {
    let issues = value.validate();
    if issues.is_empty() {
        Ok(value)
    } else {
        Err(ValidationError { kind, issues })
    }
}

pub(crate) fn issue(path: impl Into<String>, message: impl Into<String>) -> ValidationIssue {
    ValidationIssue::new(path, message)
}

pub(crate) fn require_non_empty(issues: &mut Vec<ValidationIssue>, path: &str, value: &str) {
    if value.trim().is_empty() {
        issues.push(issue(path, "expected length >= 1"));
    }
}

pub(crate) fn validate_id(issues: &mut Vec<ValidationIssue>, path: &str, value: &str) {
    let mut chars = value.chars();
    let Some(first) = chars.next() else {
        issues.push(issue(path, "does not match id pattern"));
        return;
    };
    if !first.is_ascii_alphabetic()
        || chars.any(|ch| !(ch.is_ascii_alphanumeric() || matches!(ch, '_' | ':' | '-')))
    {
        issues.push(issue(path, "does not match id pattern"));
    }
}

pub(crate) fn validate_iso_datetime(issues: &mut Vec<ValidationIssue>, path: &str, value: &str) {
    if chrono::DateTime::parse_from_rfc3339(value).is_err() {
        issues.push(issue(path, "does not match ISO datetime pattern"));
    }
}
