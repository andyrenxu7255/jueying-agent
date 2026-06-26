use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet, VecDeque};

use crate::{
    contract::{Task, TaskStatus},
    validation::issue,
    ValidationIssue,
};

pub fn dependency_cycle_issues(tasks: &[Task]) -> Vec<ValidationIssue> {
    let by_id: HashMap<&str, &Task> = tasks.iter().map(|task| (task.id.as_str(), task)).collect();
    let mut visiting = HashSet::new();
    let mut visited = HashSet::new();
    let mut issues = vec![];

    fn visit<'a>(
        task_id: &'a str,
        by_id: &HashMap<&'a str, &'a Task>,
        visiting: &mut HashSet<&'a str>,
        visited: &mut HashSet<&'a str>,
        trail: &mut Vec<&'a str>,
        issues: &mut Vec<ValidationIssue>,
    ) {
        if visiting.contains(task_id) {
            let mut cycle = trail.clone();
            cycle.push(task_id);
            issues.push(issue(
                "$.tasks",
                format!("dependency cycle detected: {}", cycle.join(" -> ")),
            ));
            return;
        }
        if visited.contains(task_id) {
            return;
        }
        let Some(task) = by_id.get(task_id) else {
            return;
        };
        visiting.insert(task_id);
        trail.push(task_id);
        for dependency in &task.depends_on {
            visit(dependency, by_id, visiting, visited, trail, issues);
        }
        trail.pop();
        visiting.remove(task_id);
        visited.insert(task_id);
    }

    for task in tasks {
        let mut trail = vec![];
        visit(
            &task.id,
            &by_id,
            &mut visiting,
            &mut visited,
            &mut trail,
            &mut issues,
        );
    }

    issues
}

pub fn dependency_status_issues(tasks: &[Task]) -> Vec<ValidationIssue> {
    let by_id: HashMap<&str, &Task> = tasks.iter().map(|task| (task.id.as_str(), task)).collect();
    let mut issues = vec![];

    for task in tasks {
        let unresolved_dependencies: Vec<String> = task
            .depends_on
            .iter()
            .filter_map(|dependency_id| {
                by_id
                    .get(dependency_id.as_str())
                    .filter(|dependency| !dependency_satisfied(&dependency.status))
                    .map(|dependency| {
                        format!(
                            "{}({})",
                            dependency.id,
                            serde_json::to_string(&dependency.status)
                                .unwrap_or_else(|_| "unknown".to_string())
                                .trim_matches('"')
                        )
                    })
            })
            .collect();

        if !unresolved_dependencies.is_empty() && task_requires_satisfied_dependencies(&task.status)
        {
            issues.push(issue(
                format!("$.tasks.{}.depends_on", task.id),
                format!(
                    "active or accepted task has unresolved dependencies: {}",
                    unresolved_dependencies.join(", ")
                ),
            ));
        }
    }

    issues
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GraphPlan {
    pub topological_order: Vec<String>,
    pub parallel_layers: Vec<Vec<String>>,
    pub blocked_by: BTreeMap<String, Vec<String>>,
}

pub fn plan_task_graph(tasks: &[Task]) -> Result<GraphPlan, Vec<ValidationIssue>> {
    let structural_issues = dependency_structural_issues(tasks);
    if !structural_issues.is_empty() {
        return Err(structural_issues);
    }

    let cycle_issues = dependency_cycle_issues(tasks);
    if !cycle_issues.is_empty() {
        return Err(cycle_issues);
    }

    let ids: BTreeSet<String> = tasks.iter().map(|task| task.id.clone()).collect();
    let mut indegree: BTreeMap<String, usize> = ids.iter().map(|id| (id.clone(), 0)).collect();
    let mut dependents: BTreeMap<String, Vec<String>> =
        ids.iter().map(|id| (id.clone(), vec![])).collect();
    let mut blocked_by: BTreeMap<String, Vec<String>> = BTreeMap::new();

    for task in tasks {
        let mut unique_dependencies = BTreeSet::new();
        for dependency in &task.depends_on {
            if !ids.contains(dependency) {
                return Err(vec![issue(
                    format!("$.tasks.{}.depends_on", task.id),
                    format!("unknown dependency: {dependency}"),
                )]);
            }
            if !unique_dependencies.insert(dependency.clone()) {
                continue;
            }
            *indegree.entry(task.id.clone()).or_default() += 1;
            dependents
                .entry(dependency.clone())
                .or_default()
                .push(task.id.clone());
            blocked_by
                .entry(task.id.clone())
                .or_default()
                .push(dependency.clone());
        }
    }

    for values in blocked_by.values_mut() {
        values.sort();
    }
    for values in dependents.values_mut() {
        values.sort();
    }

    let mut ready: VecDeque<String> = indegree
        .iter()
        .filter_map(|(id, count)| (*count == 0).then_some(id.clone()))
        .collect();
    let mut order = vec![];
    let mut layers = vec![];

    while !ready.is_empty() {
        let layer: Vec<String> = ready.drain(..).collect();
        let mut next_ready = vec![];
        for id in &layer {
            order.push(id.clone());
            for dependent in dependents.get(id).into_iter().flatten() {
                let count = indegree.get_mut(dependent).expect("dependent exists");
                *count -= 1;
                if *count == 0 {
                    next_ready.push(dependent.clone());
                }
            }
        }
        next_ready.sort();
        ready.extend(next_ready);
        layers.push(layer);
    }

    if order.len() != tasks.len() {
        return Err(vec![issue("$.tasks", "dependency cycle detected")]);
    }

    Ok(GraphPlan {
        topological_order: order,
        parallel_layers: layers,
        blocked_by,
    })
}

fn dependency_structural_issues(tasks: &[Task]) -> Vec<ValidationIssue> {
    let mut issues = vec![];
    let ids: HashSet<&str> = tasks.iter().map(|task| task.id.as_str()).collect();
    let mut seen_task_ids = HashSet::new();

    for task in tasks {
        if !seen_task_ids.insert(task.id.as_str()) {
            issues.push(issue("$.tasks", format!("duplicate task id: {}", task.id)));
        }

        let mut seen_dependencies = HashSet::new();
        for dependency_id in &task.depends_on {
            if !ids.contains(dependency_id.as_str()) {
                issues.push(issue(
                    format!("$.tasks.{}.depends_on", task.id),
                    format!("unknown dependency: {dependency_id}"),
                ));
            }
            if dependency_id == &task.id {
                issues.push(issue(
                    format!("$.tasks.{}.depends_on", task.id),
                    "task cannot depend on itself",
                ));
            }
            if !seen_dependencies.insert(dependency_id.as_str()) {
                issues.push(issue(
                    format!("$.tasks.{}.depends_on", task.id),
                    format!("duplicate dependency: {dependency_id}"),
                ));
            }
        }
    }

    issues
}

fn dependency_satisfied(status: &TaskStatus) -> bool {
    matches!(status, TaskStatus::Accepted | TaskStatus::Waived)
}

fn task_requires_satisfied_dependencies(status: &TaskStatus) -> bool {
    matches!(
        status,
        TaskStatus::Ready
            | TaskStatus::Assigned
            | TaskStatus::InProgress
            | TaskStatus::NeedsInfo
            | TaskStatus::NeedsSupplement
            | TaskStatus::Accepted
    )
}

#[cfg(test)]
mod tests {
    use crate::{ActorType, AutonomyLevel, Task, TaskGraph, TaskGraphStatus, TaskStatus, Validate};

    use super::{dependency_status_issues, plan_task_graph};

    fn task(id: &str, depends_on: &[&str]) -> Task {
        Task {
            id: id.to_string(),
            title: id.to_string(),
            status: TaskStatus::Ready,
            owner_actor_type: ActorType::PmAgent,
            owner_actor_id: "pm_agent_ops_001".to_string(),
            depends_on: depends_on.iter().map(|value| value.to_string()).collect(),
            required_evidence: vec![],
            information_gap_ids: vec![],
            evidence_ids: vec![],
            acceptance_criteria: "done".to_string(),
            due_at: None,
            replan_reason: None,
            external_refs: vec![],
        }
    }

    #[test]
    fn builds_parallel_layers_without_linearizing_the_domain_graph() {
        let tasks = vec![task("a", &[]), task("b", &[]), task("c", &["a", "b"])];
        let plan = plan_task_graph(&tasks).unwrap();
        assert_eq!(plan.parallel_layers[0], vec!["a", "b"]);
        assert_eq!(plan.parallel_layers[1], vec!["c"]);
        assert_eq!(plan.blocked_by["c"], vec!["a", "b"]);
    }

    #[test]
    fn task_graph_validation_rejects_cycles() {
        let graph = TaskGraph {
            id: "tg_cycle".to_string(),
            run_id: "run_cycle".to_string(),
            version: 1,
            status: TaskGraphStatus::Active,
            generated_by: None,
            autonomy_level: AutonomyLevel::L1,
            business_refs: None,
            tasks: vec![task("a", &["b"]), task("b", &["a"])],
        };
        let issues = graph.validate();
        assert!(issues
            .iter()
            .any(|issue| issue.message.contains("dependency cycle detected")));
    }

    #[test]
    fn planner_rejects_duplicate_dependencies_before_building_layers() {
        let issues = plan_task_graph(&[task("a", &[]), task("b", &["a", "a"])])
            .expect_err("duplicate dependencies should be invalid");

        assert!(issues
            .iter()
            .any(|issue| issue.message.contains("duplicate dependency: a")));
    }

    #[test]
    fn active_tasks_cannot_outrun_unresolved_dependencies() {
        let issues = dependency_status_issues(&[
            task("collect_champion", &[]),
            task("confirm_next_action", &["collect_champion"]),
        ]);

        assert!(issues.iter().any(|issue| issue
            .message
            .contains("active or accepted task has unresolved dependencies")));
    }
}
