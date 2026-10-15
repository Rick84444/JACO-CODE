"""
delivery_gate — mechanical check on whether a delivery is what it claims.

  scan       : hollow function bodies, deferred-work markers, swallowed errors
  provenance : quantitative claims in artifacts that no data source produced
  execute    : evidence records captured from real runs
  gate       : combined verdict — BLOCKED / PASS / UNPROVEN

Usage:
    from delivery_gate import check, render
    result = check("src/", artifacts=["report.html"], commands=["python -m pytest -q"])
    print(render(result))

CLI:
    python -m delivery_gate src/ --artifact report.html --run "python -m pytest -q"
"""

from .gate import check, render, write_report, write_json, BLOCKED, PASS, UNPROVEN
from .scan import scan_tree, scan_python
from .provenance import scan_artifact, find_claims, find_sources, visible_text
from .execute import run, run_all, render_evidence, evidence_summary

__all__ = [
    "check", "render", "write_report", "write_json",
    "BLOCKED", "PASS", "UNPROVEN",
    "scan_tree", "scan_python",
    "scan_artifact", "find_claims", "find_sources", "visible_text",
    "run", "run_all", "render_evidence", "evidence_summary",
]
