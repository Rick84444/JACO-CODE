"""
delivery_gate :: execution evidence

The point of this module: an evidence record is produced by running the
command, never by writing down what the command would have said.

Every claim of the form "the tests pass" must be backed by a record here,
carrying the command, its exit status and its real output. A claim without a
matching record is unsupported, and the gate says so.
"""

import shlex
import subprocess
import time
from pathlib import Path


def run(cmd: str, cwd: str | Path | None = None, timeout: int = 300) -> dict:
    """
    Execute one command and capture what actually happened.

    Never raises on a failing command — a failure is evidence too, and
    swallowing it would defeat the purpose.
    """
    t0 = time.monotonic()
    try:
        proc = subprocess.run(
            shlex.split(cmd),
            cwd=str(cwd) if cwd else None,
            capture_output=True, text=True, timeout=timeout,
        )
        return {
            "cmd": cmd,
            "exit": proc.returncode,
            "stdout": proc.stdout,
            "stderr": proc.stderr,
            "seconds": round(time.monotonic() - t0, 3),
            "status": "ran",
        }
    except FileNotFoundError as e:
        return {"cmd": cmd, "exit": 127, "stdout": "", "stderr": str(e),
                "seconds": round(time.monotonic() - t0, 3), "status": "not_found"}
    except subprocess.TimeoutExpired:
        return {"cmd": cmd, "exit": 124, "stdout": "", "stderr": f"timeout after {timeout}s",
                "seconds": float(timeout), "status": "timeout"}


def run_all(cmds: list[str], cwd=None, timeout: int = 300) -> list[dict]:
    return [run(c, cwd=cwd, timeout=timeout) for c in cmds]


def tail(text: str, lines: int = 12) -> str:
    parts = [l for l in text.splitlines() if l.strip()]
    return "\n".join(parts[-lines:])


def render_evidence(records: list[dict]) -> str:
    """
    Render an evidence block from execution records.

    The text here is assembled from captured fields only. There is no
    parameter through which a narrative could be supplied, which is the
    whole design: the report cannot claim more than the runs showed.
    """
    if not records:
        return "EVIDENCE: none — no commands were executed.\n"

    out = ["EVIDENCE (captured from execution, not authored)", "=" * 52]
    for r in records:
        verdict = "PASS" if r["exit"] == 0 else f"FAIL(exit {r['exit']})"
        out.append(f"\n$ {r['cmd']}")
        out.append(f"  -> {verdict}  [{r['status']}, {r['seconds']}s]")
        body = tail(r["stdout"]) or tail(r["stderr"])
        for line in body.splitlines():
            out.append(f"  | {line}")
    return "\n".join(out) + "\n"


def evidence_summary(records: list[dict]) -> dict:
    return {
        "commands": len(records),
        "passed": sum(1 for r in records if r["exit"] == 0),
        "failed": sum(1 for r in records if r["exit"] != 0),
        "all_green": bool(records) and all(r["exit"] == 0 for r in records),
    }
