"""
sim_trace :: did the simulation do any work?

A multi-step simulation produces a trace. A trace is trivially faked: label
five steps, write "step 3 improved error handling", and the output looks like
deliberation whether or not anything changed. That is the same defect as a
model scoring its own output.

So the trace is not read, it is measured. Two independent conditions, both
required before a step counts:

  grounded    the challenge that drove the step carries a real execution
              (command + exit code). An objection nobody ran is asserted.
  substantive the artifact actually changed in a way that survives
              normalisation — comments, whitespace and formatting stripped,
              Python compared as AST. Renaming a variable is not progress.

A step that is grounded but not substantive means the challenge landed and
nothing was fixed. A step that is substantive but not grounded means
something changed on an objection nobody verified. Both are reported.

Verdict over a whole trace:
  VALUE       at least one step both grounded and substantive
  DRIFT       steps ran, none changed anything of substance
  UNGROUNDED  no step carries an execution — the objections were invented
  TRIVIAL     fewer than two steps: nothing was iterated
"""

import ast
import difflib
import re
from dataclasses import dataclass, field

VALUE = "VALUE"
DRIFT = "DRIFT"
UNGROUNDED = "UNGROUNDED"
TRIVIAL = "TRIVIAL"

COSMETIC_THRESHOLD = 0.02   # text-fallback only; AST comparison needs no floor

SUBSTANTIVE = "substantive"
COSMETIC = "cosmetic"
NONE = "none"


@dataclass(frozen=True)
class Step:
    """
    n          step index
    artifacts  {name: text} — the state of the work after this step
    challenge  what U raised that produced this step
    runs       [{cmd, exit}] — executions behind the challenge
    """
    n: int
    artifacts: dict
    challenge: str = ""
    runs: tuple = ()

    @property
    def grounded(self) -> bool:
        return bool(self.runs)


class _AlphaRename(ast.NodeTransformer):
    """
    Rename locally-bound names to positional slots, so renaming a variable
    stops reading as a change. Only names bound inside a function are
    touched: parameters, assignment targets, loop targets, comprehension
    and except-handler bindings. Globals, imports, attributes and calls keep
    their names, because changing those IS a change.

    Without this, `for l in xs` -> `for line in xs` scored as substantive
    work in the first run of this module.
    """

    def __init__(self):
        self.scopes: list[dict] = []

    def _bind(self, name: str) -> str:
        if not self.scopes:
            return name
        scope = self.scopes[-1]
        if name not in scope:
            scope[name] = f"_v{len(scope)}"
        return scope[name]

    def _lookup(self, name: str) -> str:
        for scope in reversed(self.scopes):
            if name in scope:
                return scope[name]
        return name

    def _collect(self, node) -> dict:
        bound: dict = {}
        for arg in getattr(node.args, "args", []) + \
                   getattr(node.args, "kwonlyargs", []) + \
                   getattr(node.args, "posonlyargs", []):
            bound.setdefault(arg.arg, f"_v{len(bound)}")
        for sub in ast.walk(node):
            if isinstance(sub, ast.Name) and isinstance(sub.ctx, ast.Store):
                bound.setdefault(sub.id, f"_v{len(bound)}")
            elif isinstance(sub, ast.ExceptHandler) and sub.name:
                bound.setdefault(sub.name, f"_v{len(bound)}")
        return bound

    def visit_FunctionDef(self, node):
        self.scopes.append(self._collect(node))
        for arg in node.args.args + node.args.kwonlyargs + node.args.posonlyargs:
            arg.arg = self._lookup(arg.arg)
        node.body = [self.visit(s) for s in node.body]
        self.scopes.pop()
        return node

    visit_AsyncFunctionDef = visit_FunctionDef

    def visit_Name(self, node):
        node.id = self._lookup(node.id)
        return node

    def visit_ExceptHandler(self, node):
        if node.name:
            node.name = self._lookup(node.name)
        self.generic_visit(node)
        return node


def _normalise_python(src: str) -> str | None:
    """AST dump — drops comments, docstrings, whitespace, and local names."""
    try:
        tree = ast.parse(src)
    except SyntaxError:
        return None
    tree = _AlphaRename().visit(tree)
    # Sort top-level definitions by name so moving a function up or down the
    # file stops reading as work. Measured before this: reordering two
    # functions scored magnitude 0.568 and was reported as substantive.
    _defs = [n for n in tree.body
             if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))]
    _rest = [n for n in tree.body if n not in _defs]
    tree.body = _rest + sorted(_defs, key=lambda n: n.name)
    for node in ast.walk(tree):
        # strip docstrings so rewording prose does not read as a change
        if isinstance(node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef,
                             ast.ClassDef)) and node.body:
            first = node.body[0]
            if isinstance(first, ast.Expr) and isinstance(first.value, ast.Constant) \
                    and isinstance(first.value.value, str):
                node.body = node.body[1:] or [ast.Pass()]
    return ast.dump(tree, annotate_fields=False)


def _normalise_text(src: str) -> str:
    """Strip comment lines and collapse whitespace for non-Python artifacts."""
    lines = []
    for line in src.splitlines():
        s = line.strip()
        if not s or s.startswith(("#", "//", "*", "<!--")):
            continue
        lines.append(re.sub(r"\s+", " ", s))
    return "\n".join(lines)


def _normalise(name: str, src: str) -> tuple[str, bool]:
    """
    Return (normalised, structural).

    structural=True means the AST comparison applied, and it already
    distinguishes work from renaming exactly — local names are erased, API
    names are not. No size threshold is needed or wanted there: a one-token
    change to a called function is real work in a three-line file, and a
    magnitude floor was suppressing exactly that case.

    structural=False means the text fallback ran, which is coarser, so the
    threshold still guards it.
    """
    if name.endswith(".py"):
        dumped = _normalise_python(src)
        if dumped is not None:
            return dumped, True
    return _normalise_text(src), False


def diff_step(a: Step, b: Step) -> dict:
    """Measure the change between consecutive steps, after normalisation."""
    names = sorted(set(a.artifacts) | set(b.artifacts))
    changed, added, removed, ratio_sum, compared = [], [], [], 0.0, 0
    any_structural = False

    for name in names:
        old, new = a.artifacts.get(name), b.artifacts.get(name)
        if old is None:
            added.append(name)
            continue
        if new is None:
            removed.append(name)
            continue
        na, sa = _normalise(name, old)
        nb, _ = _normalise(name, new)
        any_structural = any_structural or sa
        if na != nb:
            changed.append(name)
            ratio_sum += 1.0 - difflib.SequenceMatcher(None, na, nb).ratio()
        compared += 1

    raw_changed = any(
        a.artifacts.get(n) != b.artifacts.get(n)
        for n in names if n in a.artifacts and n in b.artifacts
    )

    magnitude = round(ratio_sum / compared, 4) if compared else 0.0

    # Structural comparison is exact, so any surviving difference is work.
    # The threshold applies only to the coarser text fallback.
    if (changed or added or removed) and (
            added or removed or any_structural or magnitude >= COSMETIC_THRESHOLD):
        kind = SUBSTANTIVE
    elif raw_changed:
        kind = COSMETIC          # bytes moved, meaning did not
    else:
        kind = NONE

    return {
        "from": a.n, "to": b.n, "kind": kind,
        "changed": changed, "added": added, "removed": removed,
        "magnitude": magnitude,
        "grounded": b.grounded,
        "runs": [f"{r.get('cmd', '?')} -> exit {r.get('exit', '?')}" for r in b.runs],
        "challenge": b.challenge,
    }


def analyse(steps: list) -> dict:
    if len(steps) < 2:
        return {"verdict": TRIVIAL, "deltas": [], "steps": len(steps),
                "reason": "fewer than two steps — nothing was iterated"}

    deltas = [diff_step(steps[i], steps[i + 1]) for i in range(len(steps) - 1)]
    grounded = [d for d in deltas if d["grounded"]]
    productive = [d for d in deltas if d["grounded"] and d["kind"] == SUBSTANTIVE]
    unfixed = [d for d in deltas if d["grounded"] and d["kind"] != SUBSTANTIVE]
    unverified = [d for d in deltas if not d["grounded"] and d["kind"] == SUBSTANTIVE]

    if not grounded:
        verdict, reason = UNGROUNDED, ("no step carries an execution — every "
                                       "objection was asserted, none observed")
    elif productive:
        verdict = VALUE
        reason = (f"{len(productive)} of {len(deltas)} steps were both grounded "
                  f"and changed the work substantively")
    else:
        verdict = DRIFT
        reason = (f"{len(grounded)} grounded steps, none changed anything "
                  f"beyond formatting")

    return {
        "verdict": verdict,
        "reason": reason,
        "steps": len(steps),
        "deltas": deltas,
        "productive": len(productive),
        "grounded_unfixed": len(unfixed),
        "unverified_changes": len(unverified),
    }


def render(result: dict) -> str:
    v = result["verdict"]
    L = ["=" * 56,
         f"SIMULATION TRACE: {v}",
         "=" * 56,
         result["reason"], ""]

    mark = {SUBSTANTIVE: "CHANGED", COSMETIC: "cosmetic only", NONE: "no-op"}
    for d in result["deltas"]:
        g = "grounded" if d["grounded"] else "UNGROUNDED"
        L.append(f"  step {d['from']} -> {d['to']}   {mark[d['kind']]:<14} "
                 f"[{g}]  magnitude {d['magnitude']:.3f}")
        if d["challenge"]:
            L.append(f"      challenge: {d['challenge'][:78]}")
        for r in d["runs"]:
            L.append(f"      ran: {r}")
        if d["changed"]:
            L.append(f"      changed: {', '.join(d['changed'][:5])}")
        if d["added"]:
            L.append(f"      added:   {', '.join(d['added'][:5])}")

    L.append("")
    if result.get("grounded_unfixed"):
        L.append(f"  {result['grounded_unfixed']} challenge(s) landed but produced "
                 f"no substantive change")
    if result.get("unverified_changes"):
        L.append(f"  {result['unverified_changes']} change(s) made on an objection "
                 f"nobody ran")
    if v == DRIFT:
        L.append("  The simulation produced steps, not progress.")
    if v == UNGROUNDED:
        L.append("  Objections must carry a command and its exit code.")
    return "\n".join(L)
