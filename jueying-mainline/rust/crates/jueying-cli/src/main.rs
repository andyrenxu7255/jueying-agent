use std::path::PathBuf;

use anyhow::Context;
use clap::{Parser, Subcommand};
use jueying_core::{
    build_external_sync_console_view_model, build_legacy_bridge_preview,
    build_management_command_center_view_model_with_context, build_operating_console_view_model,
    build_task_graph_view_model, decide_writeback_policy, evaluate_sales_stage,
    expected_evidence_types, gate_ids, load_json, load_p1_fixture_state, plan_task_graph,
    validate_fixture_state_with_sales_model, SalesGateModel, SalesStage,
};
use serde_json::json;

#[derive(Debug, Parser)]
#[command(name = "jueying")]
#[command(about = "JueYing Rust mainline verification tools")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    Verify {
        #[arg(long, default_value = "..")]
        root: PathBuf,
        #[arg(long)]
        json: bool,
    },
}

fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Command::Verify { root, json } => verify(root, json),
    }
}

fn verify(root: PathBuf, emit_json: bool) -> anyhow::Result<()> {
    let root = root.canonicalize().unwrap_or(root);
    let state = load_p1_fixture_state(&root)
        .with_context(|| format!("loading P1 fixtures from {}", root.display()))?;
    let sales_model: SalesGateModel = load_json(&root.join("docs/sales-six-step-gates.json"))
        .context("loading sales gate model")?;
    let contract_issues = validate_fixture_state_with_sales_model(&state, &sales_model);
    let graph_plan = plan_task_graph(&state.task_graph.tasks)
        .map_err(|issues| anyhow::anyhow!("TaskGraph planning failed: {issues:?}"))?;
    let sales_audit = evaluate_sales_stage(
        SalesStage::Discover,
        "opp_acme_001",
        "user_sales_andy",
        &state.evidence,
        &state
            .gaps
            .iter()
            .map(|gap| gap.id.clone())
            .collect::<Vec<_>>(),
        &sales_model,
    )
    .map_err(|message| anyhow::anyhow!(message))?;
    let writeback_decisions = state
        .writeback_intents
        .iter()
        .map(decide_writeback_policy)
        .collect::<Vec<_>>();
    let bridge = build_legacy_bridge_preview(
        Some(&state.task_graph),
        &state.gaps,
        &state.evidence,
        &state.writeback_intents,
        &writeback_decisions,
    );
    let operating_console = build_operating_console_view_model(&state);
    let task_graph = build_task_graph_view_model(&state.task_graph, &state.evidence, &state.gaps);
    let external_sync =
        build_external_sync_console_view_model(&state.mirrors, &state.writeback_intents);
    let management = build_management_command_center_view_model_with_context(
        &state.management,
        Some(&state.task_graph),
        &state.gaps,
        &state.evidence,
        Some(&bridge),
    );
    let report_ok = contract_issues.is_empty() && bridge.ok && management.ok;

    let report = json!({
        "ok": report_ok,
        "root": root,
        "contract_issue_count": contract_issues.len(),
        "contract_issues": contract_issues,
        "task_graph": {
            "task_count": state.task_graph.tasks.len(),
            "topological_order": graph_plan.topological_order,
            "parallel_layers": graph_plan.parallel_layers,
            "blocked_by": graph_plan.blocked_by
        },
        "sales": {
            "stage_count": sales_model.stages.len(),
            "gate_count": gate_ids(&sales_model).len(),
            "evidence_type_count": expected_evidence_types(&sales_model).len(),
            "discover_check_count": sales_audit.checks.len(),
            "discover_gap_count": sales_audit.information_gaps.len()
        },
        "writeback": {
            "intent_count": state.writeback_intents.len(),
            "decisions": writeback_decisions
        },
        "view_models": {
            "operating_console": operating_console,
            "task_graph": task_graph,
            "external_sync_console": external_sync,
            "management_command_center": management
        },
        "legacy_bridge": bridge,
    });

    if emit_json {
        println!("{}", serde_json::to_string_pretty(&report)?);
        if !report_ok {
            anyhow::bail!("Rust verify failed");
        }
    } else if report_ok {
        println!(
            "Rust verify OK: {} tasks, {} sales gates, {} evidence types, {} role actions, {} legacy stages",
            report["task_graph"]["task_count"],
            report["sales"]["gate_count"],
            report["sales"]["evidence_type_count"],
            report["view_models"]["operating_console"]["role_action_count"],
            report["legacy_bridge"]["summary"]["workflow_stage_count"]
        );
    } else {
        println!("{}", serde_json::to_string_pretty(&report)?);
        anyhow::bail!("Rust verify failed");
    }
    Ok(())
}
