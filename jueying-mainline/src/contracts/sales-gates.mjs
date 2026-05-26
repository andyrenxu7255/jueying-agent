import { readFileSync } from "node:fs";

export function loadSalesGateModel(path = "docs/sales-six-step-gates.json") {
  const model = JSON.parse(readFileSync(path, "utf8"));
  return model;
}

export function buildSalesGateIndex(model) {
  const index = new Map();
  for (const [stage, stageConfig] of Object.entries(model.stages ?? {})) {
    for (const gate of stageConfig.gates ?? []) {
      index.set(gate.id, {
        ...gate,
        stage,
        stage_label: stageConfig.label
      });
    }
  }
  return index;
}

export function expectedEvidenceTypes(model) {
  const values = new Set();
  for (const stageConfig of Object.values(model.stages ?? {})) {
    for (const gate of stageConfig.gates ?? []) {
      for (const evidenceType of gate.evidence_types ?? []) {
        values.add(evidenceType);
      }
    }
  }
  return [...values].sort();
}

export function gateIds(model) {
  return [...buildSalesGateIndex(model).keys()].sort();
}
