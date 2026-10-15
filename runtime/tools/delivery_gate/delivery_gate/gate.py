"""
delivery_gate :: verdict

Combines source scanning, artifact provenance and execution evidence into a
single pass/block decision, and writes a report whose factual content comes
from the checks rather than from whoever is presenting the work.

Verdict rules:
  BLOCKED  any BLOCK finding, or a declared command that failed
  PASS     no BLOCK findings and every declared command exited 0
  UNPROVEN no commands were declared — nothing was demonstrated

UNPROVEN exists as a separate outcome on purpose. A clean scan over code
nobody ran is not a passing delivery; the first build in this project would
have scanned clean and been entirely broken.
"""

import json
import os
from pathlib import Path

from .scan import scan_tree, BLOCK
from .provenance import scan_artifacts
from .execute import run_all, render_evidence, evidence_summary

BLOCKED = "BLOCKED"
PASS = "PASS"
UNPROVEN = "UNPROVEN"


CONTRACT_FILE = ".deliverygate"
REENTRY_FLAG = "DELIVERY_GATE_ACTIVE"


def load_contract(root: str | Path) -> list[str]:
    """
    Read the commands a delivery must pass from a file in the repository.

    This closes the largest hole in the first version: commands were supplied
    by whoever invoked the gate, so the party being measured chose the
    measurement. `echo done`, `pytest || true` and `python -c "assert True"`
    all produced PASS. A command list that lives in the repo is version
    controlled and reviewed, and cannot be swapped per invocation.

    Format: one command per line, '#' comments and blank lines ignored.
    """
    # Search upward from `root`, the way git and most linters locate their
    # config. Looking only in the directory being scanned meant a contract at
    # the project root was invisible whenever a subpackage was scanned, and
    # the gate silently returned UNPROVEN instead of running it.
    # A contract command typically runs the test suite, and a test suite that
    # exercises the gate calls check() again — which would load the contract
    # and run the suite again, without bound. Observed: this recursed until it
    # was killed at the two-minute limit. Contract loading is a top-level act
    # only; nested invocations still honour explicitly passed commands.
    if os.environ.get(REENTRY_FLAG):
        return []
    start = Path(root).resolve()
    f = None
    for d in (start, *start.parents):
        candidate = d / CONTRACT_FILE
        if candidate.exists():
            f = candidate
            break
    if f is None:
        return []
    out = []
    for line in f.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            out.append(line)
    return out


def check(
    source_root: str | Path,
    artifacts: list[str] | None = None,
    commands: list[str] | None = None,
    cwd: str | Path | None = None,
    contract_root: str | Path | None = None,
) -> dict:
    """
    Run every check and return the full result.

    When a contract file is present, its commands are appended to whatever the
    caller passed and the result records that the contract applied. Ad-hoc
    commands cannot remove a contract command.
    """
    contract = load_contract(contract_root or cwd or source_root)
    findings = scan_tree(Path(source_root))
    findings += scan_artifacts(artifacts or [])
    # Commands run from the project root by default, not from the scanned
    # source directory — `python -m unittest discover -s tests` is declared
    # relative to the root, and defaulting to source_root broke it.
    declared = list(commands or []) + contract
    prior = os.environ.get(REENTRY_FLAG)
    os.environ[REENTRY_FLAG] = "1"
    try:
        records = run_all(declared, cwd=cwd)
    finally:
        if prior is None:
            os.environ.pop(REENTRY_FLAG, None)
        else:
            os.environ[REENTRY_FLAG] = prior

    blocking = [f for f in findings if f["severity"] == BLOCK]
    ev = evidence_summary(records)

    if blocking or ev["failed"]:
        verdict = BLOCKED
    elif not records:
        verdict = UNPROVEN
    else:
        verdict = PASS

    return {
        "verdict": verdict,
        "findings": findings,
        "blocking": blocking,
        "records": records,
        "evidence": ev,
        "source_root": str(source_root),
        "artifacts": list(artifacts or []),
        "contract_commands": contract,
        "contract_applied": bool(contract),
    }


def render(result: dict) -> str:
    """Human-readable report. Every number below is counted, not asserted."""
    v = result["verdict"]
    ev = result["evidence"]
    blocking = result["blocking"]
    info = [f for f in result["findings"] if f["severity"] == "INFO"]
    warn = [f for f in result["findings"] if f["severity"] == "WARN"]

    banner = {BLOCKED: "DELIVERY BLOCKED",
              PASS: "DELIVERY PASSES",
              UNPROVEN: "UNPROVEN — nothing was executed"}[v]

    L = ["=" * 52, banner, "=" * 52,
         f"source        : {result['source_root']}",
         f"artifacts     : {len(result['artifacts'])}",
         f"blocking      : {len(blocking)}",
         f"warnings      : {len(warn)}",
         f"commands run  : {ev['commands']}  ({ev['passed']} passed, {ev['failed']} failed)",
         f"contract      : {len(result.get('contract_commands', []))} command(s) from "
         f"{CONTRACT_FILE}" if result.get("contract_applied")
         else f"contract      : none — no {CONTRACT_FILE}, commands were caller-supplied",
         ""]

    if blocking:
        L += ["BLOCKING FINDINGS", "-" * 52]
        by_kind: dict[str, list] = {}
        for f in blocking:
            by_kind.setdefault(f["kind"], []).append(f)
        for kind, group in sorted(by_kind.items()):
            L.append(f"  [{kind}] x{len(group)}")
            for f in group[:8]:
                loc = f"{Path(f['file']).name}:{f['line']}" if f["line"] else Path(f["file"]).name
                L.append(f"    {loc}  {f['detail'][:110]}")
            if len(group) > 8:
                L.append(f"    ... {len(group) - 8} more")
        L.append("")

    if info:
        L += ["PROVENANCE", "-" * 52]
        for f in info:
            L.append(f"  {Path(f['file']).name}: {f['detail'][:110]}")
        L.append("")

    L.append(render_evidence(result["records"]))

    if v == UNPROVEN:
        L += ["", "No command was declared, so nothing here is demonstrated.",
              "Declare the commands that prove the work with --run."]
    return "\n".join(L)


def write_report(result: dict, path: str | Path) -> Path:
    path = Path(path)
    path.write_text(render(result), encoding="utf-8")
    return path


def write_json(result: dict, path: str | Path) -> Path:
    path = Path(path)
    path.write_text(json.dumps(result, indent=2, default=str), encoding="utf-8")
    return path
