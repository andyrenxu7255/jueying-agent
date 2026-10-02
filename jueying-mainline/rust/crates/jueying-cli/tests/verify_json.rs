use std::process::Command;

#[test]
fn missing_fixture_root_reports_machine_readable_failure() {
    let output = Command::new(env!("CARGO_BIN_EXE_jueying"))
        .args(["verify", "--root", "/nonexistent/jueying-root", "--json"])
        .output()
        .expect("run CLI");

    assert!(!output.status.success());
    let report: serde_json::Value = serde_json::from_slice(&output.stdout).expect("JSON error");
    assert_eq!(report["ok"], false);
    assert!(report["error"]
        .as_str()
        .unwrap_or_default()
        .contains("loading P1 fixtures"));
}
