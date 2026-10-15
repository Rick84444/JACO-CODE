"""
delivery_gate :: source scanning

Detects the shapes that make a delivery look finished while being hollow:
unimplemented bodies, deferred-work markers, swallowed errors.

AST-based rather than regex-based for the structural checks, so a function
whose body is a docstring plus `pass` is caught while a legitimate `pass`
inside a loop is not.
"""

import ast
import re
from pathlib import Path

# severity: BLOCK stops a delivery, WARN is reported and passes
BLOCK = "BLOCK"
WARN = "WARN"

# Deferred-work markers, matched as markers rather than as vocabulary.
# Case-sensitive (the convention is uppercase, and linters treat it that way)
# and required to open the comment or be followed by ':' or '(' — otherwise
# prose *about* stubs trips it. This scanner blocked its own source for
# containing the words "stub" and "placeholder" inside explanatory comments.
MARKER_RE = re.compile(
    r"(?:^|[#/*]\s*|\s)"
    r"(?P<kind>TODO|FIXME|XXX|HACK|STUB|PLACEHOLDER)"
    r"(?=\s*[:(]|\s*$)"
)


def _finding(path, line, kind, severity, detail):
    return {"file": str(path), "line": line, "kind": kind,
            "severity": severity, "detail": detail}


def _is_hollow_body(node) -> str | None:
    """Return a reason if a function/class body carries no implementation."""
    body = list(node.body)
    if body and isinstance(body[0], ast.Expr) and isinstance(
            getattr(body[0], "value", None), ast.Constant) and isinstance(
            body[0].value.value, str):
        body = body[1:]                       # drop docstring
    if not body:
        return "body is only a docstring"
    if len(body) == 1:
        only = body[0]
        if isinstance(only, ast.Pass):
            return "body is `pass`"
        if isinstance(only, ast.Expr) and isinstance(only.value, ast.Constant) \
                and only.value.value is Ellipsis:
            return "body is `...`"
        if isinstance(only, ast.Raise):
            exc = only.exc
            name = ""
            if isinstance(exc, ast.Call) and isinstance(exc.func, ast.Name):
                name = exc.func.id
            elif isinstance(exc, ast.Name):
                name = exc.id
            if name == "NotImplementedError":
                return "raises NotImplementedError"
        if isinstance(only, ast.Return):
            v = only.value
            if v is None or (isinstance(v, ast.Constant) and v.value is None):
                return "returns None and nothing else"
            # A function whose whole body returns a fixed literal and never
            # reads its own parameters is a stub with a body. This is the most
            # common stub shape after `pass`, and the first version of this
            # scanner missed all of them: return {}, return [], return 0,
            # return "", return True.
            if isinstance(v, (ast.Constant, ast.Dict, ast.List, ast.Set, ast.Tuple)):
                if _is_empty_literal(v) and not _uses_params(node):
                    return f"returns a fixed {type(v).__name__.lower()} and ignores its arguments"
    return None


def _is_empty_literal(v) -> bool:
    """Empty container, or a bare constant: the shapes a placeholder returns."""
    if isinstance(v, (ast.Dict, ast.List, ast.Set, ast.Tuple)):
        return not (getattr(v, "elts", None) or getattr(v, "keys", None))
    return isinstance(v, ast.Constant)


def _uses_params(node) -> bool:
    """True if the body reads any parameter — then a literal return is a real branch."""
    names = {a.arg for a in (list(node.args.args) + list(node.args.kwonlyargs) +
                             list(node.args.posonlyargs))}
    if not names:
        return False
    for sub in ast.walk(node):
        if isinstance(sub, ast.Name) and isinstance(sub.ctx, ast.Load) and sub.id in names:
            return True
    return False


def _handles(handler) -> bool:
    """
    An except block handles its error if it re-raises, returns, continues,
    breaks, or assigns something the caller can see. Printing is not handling:
    `except Exception: print(e)` discards the failure exactly as `pass` does,
    and the first version of this scanner passed it.
    """
    for sub in ast.walk(handler):
        if isinstance(sub, (ast.Raise, ast.Return, ast.Continue, ast.Break)):
            return True
        if isinstance(sub, (ast.Assign, ast.AugAssign, ast.AnnAssign)):
            return True
    return False


def scan_python(path: Path) -> list[dict]:
    """Structural + marker scan of one Python file."""
    try:
        src = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as e:
        return [_finding(path, 0, "unreadable", WARN, str(e))]

    out: list[dict] = []

    for i, line in enumerate(src.splitlines(), 1):
        m = MARKER_RE.search(line)
        if m:
            out.append(_finding(path, i, "marker", BLOCK,
                                f"{m.group('kind').upper()}: {line.strip()[:90]}"))

    try:
        tree = ast.parse(src, filename=str(path))
    except SyntaxError as e:
        out.append(_finding(path, e.lineno or 0, "syntax_error", BLOCK, str(e.msg)))
        return out

    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            reason = _is_hollow_body(node)
            if reason:
                # A Protocol / ABC / typing overload legitimately has no body.
                decorators = {getattr(d, "id", getattr(d, "attr", ""))
                              for d in node.decorator_list}
                if decorators & {"abstractmethod", "overload"}:
                    continue
                out.append(_finding(path, node.lineno, "hollow_function", BLOCK,
                                    f"{node.name}(): {reason}"))
        elif isinstance(node, ast.ExceptHandler):
            body = [s for s in node.body if not isinstance(s, ast.Pass)]
            if not body:
                out.append(_finding(path, node.lineno, "swallowed_exception", BLOCK,
                                    "except block silently passes"))
            elif not _handles(node):
                out.append(_finding(path, node.lineno, "swallowed_exception", BLOCK,
                                    "except block logs or prints but neither re-raises "
                                    "nor returns — the error is discarded"))
    return out


def scan_tree(root: Path, patterns=("*.py",), skip=("__pycache__", ".git", "node_modules")) -> list[dict]:
    """Scan a directory tree, skipping build and vendor directories."""
    root = Path(root)
    files: list[Path] = []
    if root.is_file():
        files = [root]
    else:
        for pat in patterns:
            files.extend(root.rglob(pat))

    out: list[dict] = []
    for f in sorted(set(files)):
        if any(part in skip for part in f.parts):
            continue
        if f.suffix == ".py":
            out.extend(scan_python(f))
    return out
