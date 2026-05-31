import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = resolve(".");
const docsDir = join(root, "docs");
const errors = [];

function readJson(relativePath) {
  return JSON.parse(readFileSync(join(root, relativePath), "utf8"));
}

function readText(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

function addError(message) {
  errors.push(message);
}

function docByPrefix(prefix) {
  const match = readdirSync(docsDir).find((name) => name.startsWith(prefix));
  return match ? `docs/${match}` : null;
}

function normalizeRelativePath(basePath, target) {
  const withoutHash = target.split("#")[0];
  if (!withoutHash) {
    return null;
  }
  return resolve(dirname(join(root, basePath)), withoutHash);
}

function checkJsonFiles() {
  for (const relativePath of [
    "docs/context-graph.json",
    "docs/context-routing.json",
    "docs/scenario-coverage.json",
    "docs/sales-six-step-gates.json",
    "docs/role-storyline-acceptance.json",
    "fixtures/p1-demo/management-command-center.json"
  ]) {
    try {
      readJson(relativePath);
    } catch (error) {
      addError(`JSON parse failed: ${relativePath}: ${error.message}`);
    }
  }
}

function markdownLinkTargets(relativePath) {
  const text = readText(relativePath);
  const targets = [];
  const matches = text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g);
  for (const match of matches) {
    let target = match[1].trim();
    if (/^(https?:|mailto:|#)/.test(target)) {
      continue;
    }
    if (target.startsWith("<") && target.endsWith(">")) {
      target = target.slice(1, -1);
    }
    const withoutHash = target.split("#")[0];
    if (!withoutHash) {
      continue;
    }
    const normalized = resolve(dirname(join(root, relativePath)), withoutHash)
      .replace(root, "")
      .replaceAll("\\", "/")
      .replace(/^\//, "");
    targets.push(normalized);
  }
  return targets;
}

function checkMarkdownLinks() {
  const markdownFiles = [
    "README.md",
    ...readdirSync(docsDir)
      .filter((name) => name.endsWith(".md"))
      .map((name) => `docs/${name}`)
  ];

  for (const relativePath of markdownFiles) {
    const text = readText(relativePath);
    const matches = text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g);
    for (const match of matches) {
      let target = match[1].trim();
      if (/^(https?:|mailto:|#)/.test(target)) {
        continue;
      }
      if (target.startsWith("<") && target.endsWith(">")) {
        target = target.slice(1, -1);
      }
      const resolved = normalizeRelativePath(relativePath, target);
      if (resolved && !existsSync(resolved)) {
        addError(`Broken markdown link in ${relativePath}: ${target}`);
      }
    }
  }
}

function activeDocPaths() {
  return readdirSync(docsDir)
    .filter((name) => name.endsWith(".md") && name !== "README.md")
    .map((name) => `docs/${name}`)
    .sort();
}

function checkDocEntryIndexes() {
  const rootLinks = new Set(markdownLinkTargets("README.md"));
  const docsLinks = new Set(markdownLinkTargets("docs/README.md"));

  for (const docPath of activeDocPaths()) {
    if (!rootLinks.has(docPath)) {
      addError(`Active doc missing from README.md: ${docPath}`);
    }
    if (!docsLinks.has(docPath)) {
      addError(`Active doc missing from docs/README.md: ${docPath}`);
    }
  }

  for (const jsonPath of [
    "docs/context-graph.json",
    "docs/context-routing.json",
    "docs/scenario-coverage.json",
    "docs/sales-six-step-gates.json",
    "docs/role-storyline-acceptance.json",
    "fixtures/p1-demo/management-command-center.json"
  ]) {
    if (!rootLinks.has(jsonPath)) {
      addError(`Machine-readable asset missing from README.md: ${jsonPath}`);
    }
    if (!docsLinks.has(jsonPath)) {
      addError(`Machine-readable asset missing from docs/README.md: ${jsonPath}`);
    }
  }
}

function checkGraphPaths() {
  for (const relativePath of [
    "docs/context-graph.json",
    "docs/context-routing.json",
    "docs/scenario-coverage.json"
  ]) {
    const text = readText(relativePath);
    const matches = text.matchAll(/"((?:README\.md|docs\/[^" ]+|legacy\/[^" ]+))"/g);
    for (const match of matches) {
      const referenced = match[1];
      if (referenced.includes("*")) {
        continue;
      }
      if (!existsSync(join(root, referenced))) {
        addError(`Missing referenced path in ${relativePath}: ${referenced}`);
      }
    }
  }
}

function collectGraphPaths(graph) {
  const paths = new Set();

  function visit(value) {
    if (typeof value === "string" && looksLikeWorkspacePath(value)) {
      paths.add(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item);
      }
      return;
    }
    if (value && typeof value === "object") {
      for (const item of Object.values(value)) {
        visit(item);
      }
    }
  }

  visit(graph);
  return paths;
}

function looksLikeWorkspacePath(value) {
  return value === "README.md" ||
    value.startsWith("docs/") ||
    value.startsWith("src/") ||
    value.startsWith("scripts/") ||
    value.startsWith("apps/") ||
    value.startsWith("fixtures/") ||
    value.startsWith("reports/") ||
    value.startsWith("legacy/");
}

function checkGraphCoverage() {
  const graph = readJson("docs/context-graph.json");
  const routing = readJson("docs/context-routing.json");
  const graphPaths = collectGraphPaths(graph);
  const routingPaths = collectGraphPaths(routing);
  const activeDocs = activeDocPaths();

  for (const docPath of activeDocs) {
    if (!graphPaths.has(docPath)) {
      addError(`Active doc missing from context-graph.json: ${docPath}`);
    }
    if (!routingPaths.has(docPath)) {
      addError(`Active doc missing from context-routing.json: ${docPath}`);
    }
  }

  for (const jsonPath of [
    "docs/scenario-coverage.json",
    "docs/sales-six-step-gates.json",
    "docs/role-storyline-acceptance.json",
    "fixtures/p1-demo/management-command-center.json"
  ]) {
    if (!graphPaths.has(jsonPath)) {
      addError(`Machine-readable asset missing from context-graph.json: ${jsonPath}`);
    }
    if (!routingPaths.has(jsonPath)) {
      addError(`Machine-readable asset missing from context-routing.json: ${jsonPath}`);
    }
  }

  for (const [key, value] of Object.entries(graph.authority_map ?? {})) {
    if (!looksLikeWorkspacePath(value) || !existsSync(join(root, value))) {
      addError(`Invalid authority_map path for ${key}: ${value}`);
    }
  }

  for (const [name, concept] of Object.entries(graph.concepts ?? {})) {
    if (!concept.authority || !existsSync(join(root, concept.authority))) {
      addError(`Concept ${name} has invalid authority: ${concept.authority}`);
    }
  }
}

function collectGateIdsFromModel(model) {
  const ids = new Set();
  for (const stage of Object.values(model.stages ?? {})) {
    for (const gate of stage.gates ?? []) {
      ids.add(gate.id);
    }
  }
  return ids;
}

function checkSalesGateIds() {
  const model = readJson("docs/sales-six-step-gates.json");
  const jsonGateIds = collectGateIdsFromModel(model);
  const dev30Path = docByPrefix("DEV-30-");
  const dev30 = readText(dev30Path);
  const docGateIds = new Set([...dev30.matchAll(/\b[DSGVBN]-G\d+\b/g)].map((match) => match[0]));

  for (const gateId of jsonGateIds) {
    if (!docGateIds.has(gateId)) {
      addError(`Gate id in sales-six-step-gates.json missing from DEV-30: ${gateId}`);
    }
  }
  for (const gateId of docGateIds) {
    if (!jsonGateIds.has(gateId)) {
      addError(`Gate id in DEV-30 missing from sales-six-step-gates.json: ${gateId}`);
    }
  }
}

function checkEvidenceVocabulary() {
  const model = readJson("docs/sales-six-step-gates.json");
  const expectedEvidenceTypes = new Set();
  for (const stage of Object.values(model.stages ?? {})) {
    for (const gate of stage.gates ?? []) {
      for (const evidenceType of gate.evidence_types ?? []) {
        expectedEvidenceTypes.add(evidenceType);
      }
    }
  }

  const dev29 = readText(docByPrefix("DEV-29-"));
  const dev31 = readText(docByPrefix("DEV-31-"));
  for (const evidenceType of expectedEvidenceTypes) {
    if (!dev29.includes(evidenceType)) {
      addError(`Evidence type missing from DEV-29: ${evidenceType}`);
    }
    if (!dev31.includes(evidenceType)) {
      addError(`Evidence type missing from DEV-31: ${evidenceType}`);
    }
  }
}

function checkScenarioCoverage() {
  const coverageText = readText("docs/scenario-coverage.json");
  const dev28 = readText(docByPrefix("DEV-28-"));
  const ids = new Set([...coverageText.matchAll(/\b(?:SS|PD|XS)-\d+[A-Z]?\b/g)].map((match) => match[0]));
  for (const id of ids) {
    if (!dev28.includes(id)) {
      addError(`Scenario id in scenario-coverage.json missing from DEV-28: ${id}`);
    }
  }
}

function checkRootShape() {
  const allowed = new Set(["apps", "docs", "fixtures", "legacy", "ops", "output", "package.json", "README.md", "reports", "schemas", "scripts", "src", "tests"]);
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!allowed.has(entry.name)) {
      addError(`Unexpected root item: ${entry.name}`);
    }
  }
}

checkJsonFiles();
checkMarkdownLinks();
checkDocEntryIndexes();
checkGraphPaths();
checkGraphCoverage();
checkSalesGateIds();
checkEvidenceVocabulary();
checkScenarioCoverage();
checkRootShape();

if (errors.length > 0) {
  console.error("Documentation audit failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("Documentation audit OK");
