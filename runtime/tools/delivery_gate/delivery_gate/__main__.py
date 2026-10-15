"""CLI: python -m delivery_gate <source> [--artifact F]... [--run CMD]..."""

import argparse
import sys

from .gate import check, render, write_report, write_json, BLOCKED, UNPROVEN


def main() -> int:
    ap = argparse.ArgumentParser(
        prog="delivery_gate",
        description="Block a delivery that contains stubs, unsourced numbers, "
                    "or claims nothing ran.")
    ap.add_argument("source", help="file or directory to scan")
    ap.add_argument("--artifact", "-a", action="append", default=[],
                    help="report/HTML to check for unsourced quantitative claims")
    ap.add_argument("--run", "-r", action="append", default=[],
                    help="command that must pass; repeatable")
    ap.add_argument("--cwd", default=None, help="working directory for commands")
    ap.add_argument("--report", default=None, help="write the text report here")
    ap.add_argument("--json", dest="json_out", default=None, help="write full JSON here")
    ap.add_argument("--allow-unproven", action="store_true",
                    help="exit 0 when no command was declared (default: exit 2)")
    a = ap.parse_args()

    result = check(a.source, artifacts=a.artifact, commands=a.run, cwd=a.cwd)
    print(render(result))

    if a.report:
        write_report(result, a.report)
    if a.json_out:
        write_json(result, a.json_out)

    if result["verdict"] == BLOCKED:
        return 1
    if result["verdict"] == UNPROVEN:
        return 0 if a.allow_unproven else 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
