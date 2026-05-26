#!/usr/bin/env python3
"""Context rot guard for Agent Harness docs.

Validates task-level context loading against development/context-graph.json.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Set


@dataclass
class CheckResult:
    ok: bool
    errors: List[str]
    warnings: List[str]
    info: List[str]


def to_list(value: object) -> List[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(v) for v in value]
    return [str(value)]


def normalize(path: str) -> str:
    return path.replace("\\", "/").strip()


def build_layer_index(layers: Dict[str, List[str]]) -> Dict[str, str]:
    idx: Dict[str, str] = {}
    for layer_name, docs in layers.items():
        for doc in docs:
            idx[normalize(doc)] = layer_name
    return idx


def load_json(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def resolve_loaded_docs(manifest: dict) -> Set[str]:
    docs: Set[str] = set()
    for key in (
        "authority_docs",
        "direct_dependencies",
        "execution_doc",
        "loaded_docs",
        "authority",
        "execution",
    ):
        for item in to_list(manifest.get(key)):
            docs.add(normalize(item))
    return docs


def parse_changed(changed_values: Iterable[str]) -> Set[str]:
    out: Set[str] = set()
    for value in changed_values:
        for part in value.split(","):
            p = normalize(part)
            if p:
                out.add(p)
    return out


def evaluate(
    graph_path: Path,
    workspace: Path,
    task_profile: str | None,
    manifest_path: Path | None,
    changed_docs: Set[str],
    allow_l2: bool,
    max_docs_override: int | None,
    max_rounds_override: int | None,
) -> CheckResult:
    graph = load_json(graph_path)
    layers: Dict[str, List[str]] = graph.get("layers", {})
    task_profiles: Dict[str, dict] = graph.get("task_profiles", {})
    authority_map: Dict[str, str] = graph.get("authority_map", {})
    loading_policy = graph.get("loading_policy", {})

    errors: List[str] = []
    warnings: List[str] = []
    info: List[str] = []

    if task_profile and task_profile not in task_profiles:
        return CheckResult(False, [f"Unknown task profile: {task_profile}"], [], [])

    if not task_profile and not manifest_path:
        return CheckResult(
            False,
            ["Provide at least one input: --task-profile or --manifest"],
            [],
            [],
        )

    manifest: dict = {}
    if task_profile:
        manifest.update(task_profiles[task_profile])
        manifest["task_id"] = task_profile
        info.append(f"Loaded task profile: {task_profile}")

    if manifest_path:
        user_manifest = load_json(manifest_path)
        for k, v in user_manifest.items():
            manifest[k] = v
        info.append(f"Loaded manifest: {normalize(str(manifest_path))}")

    loaded_docs = resolve_loaded_docs(manifest)
    if not loaded_docs:
        errors.append("No documents found in manifest/profile payload")

    layer_index = build_layer_index(layers)
    l0 = set(normalize(p) for p in layers.get("L0_authority", []))
    l1 = set(normalize(p) for p in layers.get("L1_execution", []))
    l2 = set(normalize(p) for p in layers.get("L2_governance", []))

    unknown_layer_docs = sorted([d for d in loaded_docs if d not in layer_index])
    for d in unknown_layer_docs:
        warnings.append(f"Document not indexed in graph layers: {d}")

    if not allow_l2:
        l2_hits = sorted([d for d in loaded_docs if d in l2])
        if l2_hits:
            errors.append(
                "L2 governance docs loaded without --allow-l2: " + ", ".join(l2_hits)
            )

    doc_budget = (
        max_docs_override
        if max_docs_override is not None
        else int(loading_policy.get("default_max_docs", 6))
    )
    if len(loaded_docs) > doc_budget:
        errors.append(f"Doc budget exceeded: {len(loaded_docs)} > {doc_budget}")

    rounds = int(manifest.get("context_rounds", 1))
    rounds_budget = (
        max_rounds_override
        if max_rounds_override is not None
        else int(loading_policy.get("default_max_rounds", 2))
    )
    if rounds > rounds_budget:
        errors.append(f"Context rounds exceeded: {rounds} > {rounds_budget}")

    authority_docs = set(normalize(v) for v in authority_map.values())
    selected_authority = set(normalize(v) for v in to_list(manifest.get("authority")))
    selected_authority.update(normalize(v) for v in to_list(manifest.get("authority_docs")))
    if selected_authority:
        not_authority = sorted([d for d in selected_authority if d not in authority_docs and d not in l0])
        if not_authority:
            warnings.append("authority_docs contains non-L0 docs: " + ", ".join(not_authority))
    else:
        if not (loaded_docs & authority_docs):
            errors.append("No authority docs present in loaded set")

    for doc in sorted(loaded_docs):
        doc_path = workspace / doc
        if not doc_path.exists():
            errors.append(f"Document not found in workspace: {doc}")

    # Invalidation checks
    changed = set(changed_docs)
    if changed:
        authority_changed = sorted(changed & authority_docs)
        if authority_changed:
            errors.append(
                "Context invalidated: authority docs changed: " + ", ".join(authority_changed)
            )

        hard_watch = {
            "AH1-15-核心接口与事件契约.md",
            "AH1-16-权限Scope-Policy-Snapshot.md",
        }
        hard_hits = sorted(changed & hard_watch)
        if hard_hits:
            errors.append(
                "Context invalidated: contract/policy changed: " + ", ".join(hard_hits)
            )

        execution_docs = set(normalize(v) for v in to_list(manifest.get("execution")))
        execution_docs.update(normalize(v) for v in to_list(manifest.get("execution_doc")))
        execution_hits = sorted(changed & execution_docs)
        if execution_hits:
            errors.append(
                "Context invalidated: execution doc changed: " + ", ".join(execution_hits)
            )

    # Basic dependency hygiene
    if loaded_docs & l1 and not (loaded_docs & l0):
        errors.append("L1 execution docs loaded without any L0 authority docs")

    if loaded_docs & l2 and not allow_l2:
        errors.append("L2 governance docs require explicit --allow-l2")

    if not errors:
        info.append(
            f"Loaded docs={len(loaded_docs)}, L0={len(loaded_docs & l0)}, L1={len(loaded_docs & l1)}, L2={len(loaded_docs & l2)}"
        )

    return CheckResult(len(errors) == 0, errors, warnings, info)


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate context loading to prevent context rot")
    parser.add_argument(
        "--graph",
        default="development/context-graph.json",
        help="Path to context graph JSON",
    )
    parser.add_argument(
        "--workspace",
        default=".",
        help="Workspace root path",
    )
    parser.add_argument(
        "--task-profile",
        default=None,
        help="Task profile key from context-graph.json",
    )
    parser.add_argument(
        "--manifest",
        default=None,
        help="Optional manifest JSON path overriding profile fields",
    )
    parser.add_argument(
        "--changed",
        action="append",
        default=[],
        help="Changed docs (repeatable or comma-separated)",
    )
    parser.add_argument(
        "--allow-l2",
        action="store_true",
        help="Allow loading L2 governance docs",
    )
    parser.add_argument("--max-docs", type=int, default=None, help="Override max docs budget")
    parser.add_argument(
        "--max-rounds",
        type=int,
        default=None,
        help="Override max rounds budget",
    )
    args = parser.parse_args()

    graph_path = Path(args.graph)
    manifest_path = Path(args.manifest) if args.manifest else None
    workspace = Path(args.workspace)

    result = evaluate(
        graph_path=graph_path,
        workspace=workspace,
        task_profile=args.task_profile,
        manifest_path=manifest_path,
        changed_docs=parse_changed(args.changed),
        allow_l2=args.allow_l2,
        max_docs_override=args.max_docs,
        max_rounds_override=args.max_rounds,
    )

    print("CONTEXT_GUARD:", "PASS" if result.ok else "FAIL")
    for line in result.info:
        print("INFO:", line)
    for line in result.warnings:
        print("WARN:", line)
    for line in result.errors:
        print("ERROR:", line)

    return 0 if result.ok else 1


if __name__ == "__main__":
    sys.exit(main())
