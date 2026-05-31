import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = resolve(".");

function readText(path) {
  return readFileSync(path, "utf8");
}

function readJson(path) {
  return JSON.parse(readText(path));
}

function markdownLinkTargets(path) {
  const text = readText(path);
  return new Set([...text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)]
    .map((match) => match[1].trim().replace(/^<|>$/g, "").split("#")[0])
    .filter(Boolean)
    .filter((target) => !/^(https?:|mailto:|#)/.test(target))
    .map((target) => normalizePath(resolve(dirname(resolve(root, path)), target))));
}

function activeDocPaths() {
  return readdirSync(resolve(root, "docs"))
    .filter((name) => name.endsWith(".md") && name !== "README.md")
    .map((name) => `docs/${name}`)
    .sort();
}

function collectWorkspacePaths(value, paths = new Set()) {
  if (typeof value === "string") {
    if (looksLikeWorkspacePath(value)) paths.add(value);
    return paths;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectWorkspacePaths(item, paths);
    return paths;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectWorkspacePaths(item, paths);
  }
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

function normalizePath(path) {
  return path.replace(root, "").replaceAll("\\", "/").replace(/^\//, "");
}

test("README indexes expose every active documentation and graph asset", () => {
  const rootLinks = markdownLinkTargets("README.md");
  const docsLinks = markdownLinkTargets("docs/README.md");
  const requiredAssets = [
    ...activeDocPaths(),
    "docs/context-graph.json",
    "docs/context-routing.json",
    "docs/scenario-coverage.json",
    "docs/sales-six-step-gates.json",
    "docs/role-storyline-acceptance.json"
  ];

  for (const asset of requiredAssets) {
    assert.equal(rootLinks.has(asset), true, `root README should link ${asset}`);
    assert.equal(docsLinks.has(asset), true, `docs README should link ${asset}`);
  }
});

test("context graph and routing cover active docs and critical runtime assets", () => {
  const graph = readJson("docs/context-graph.json");
  const routing = readJson("docs/context-routing.json");
  const graphPaths = collectWorkspacePaths(graph);
  const routingPaths = collectWorkspacePaths(routing);

  for (const docPath of activeDocPaths()) {
    assert.equal(graphPaths.has(docPath), true, `context graph should reference ${docPath}`);
    assert.equal(routingPaths.has(docPath), true, `context routing should reference ${docPath}`);
  }

  for (const asset of [
    "docs/role-storyline-acceptance.json",
    "scripts/run-storyline-acceptance.mjs",
    "scripts/live-legacy-bridge-smoke.mjs",
    "src/integrations/jueying-v1/runtime-client.mjs",
    "reports/live-legacy-bridge-smoke.json"
  ]) {
    assert.equal(graphPaths.has(asset) || routingPaths.has(asset), true, `${asset} should be recallable`);
  }
});

test("context graph authorities and concept dependencies resolve to workspace paths", () => {
  const graph = readJson("docs/context-graph.json");
  const paths = collectWorkspacePaths(graph);

  for (const [key, authorityPath] of Object.entries(graph.authority_map ?? {})) {
    assert.equal(existsSync(resolve(root, authorityPath)), true, `authority ${key} should resolve`);
  }

  for (const [name, concept] of Object.entries(graph.concepts ?? {})) {
    assert.equal(existsSync(resolve(root, concept.authority)), true, `concept ${name} authority should resolve`);
  }

  for (const path of paths) {
    if (path.includes("*")) continue;
    assert.equal(existsSync(resolve(root, path)), true, `graph path should resolve: ${path}`);
  }
});
