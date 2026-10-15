"""
delivery_gate :: data provenance

Catches the failure this gate exists for: an artifact that presents
quantitative claims which were written by hand rather than produced by a run.

Method: extract the text a reader actually sees (markup and style stripped),
find quantitative claims in it, then check whether the document has any
mechanism that could have produced those numbers — a data literal, a parse,
a fetch, a template substitution. Claims with no such mechanism are hardcoded
by definition, and hardcoded quantitative claims in a report are fabricated
unless the document says where they came from.

Deliberately conservative about what counts as a claim: version strings,
dates, ordinal labels and small bare counts are excluded, because a gate
that cries wolf gets switched off.
"""

import re
from pathlib import Path

BLOCK = "BLOCK"
WARN = "WARN"

# Things a reader reads as a measurement.
CLAIM_PATTERNS = [
    (r"\b\d+(?:\.\d+)?\s*%", "percentage"),
    (r"\b\d{1,3}(?:,\d{3})+\b", "large count"),
    (r"\b\d+(?:\.\d+)?\s*(?:ms|s|sec|seconds|min|hours?|hrs?)\b", "duration"),
    (r"\b\d+(?:\.\d+)?\s*(?:MB|GB|KB|TB|bytes?)\b", "size"),
    (r"\bp\d{2,3}\b", "percentile"),
    (r"\b\d+(?:\.\d+)?\s*x\b(?!\s*\d)", "multiplier"),
    (r"\b0\.\d{2,}\b", "score/ratio"),
    (r"\b\d+(?:\.\d+)?\s*(?:hops?|nodes?|runs?|iterations?|samples?|calls?|"
     r"requests?|rows?|users?|ops)\b", "quantified unit"),
]

# Evidence that numbers could have come from somewhere.
SOURCE_PATTERNS = [
    (r"\bJSON\s*\.\s*parse\b", "JSON.parse"),
    (r"\bfetch\s*\(", "fetch()"),
    (r"\bFileReader\b", "FileReader"),
    (r"\bXMLHttpRequest\b", "XHR"),
    (r"<script[^>]+type\s*=\s*[\"']application/json[\"']", "embedded JSON block"),
    (r"\bconst\s+(?:SEED|DATA|STATE|PAYLOAD|ROWS|DATASET)\b", "data literal"),
    (r"\$\{[^}]+\}", "template substitution"),
    (r"\bdata-(?:source|src|json|value)\s*=", "data attribute"),
    (r"\bwindow\.claude\b", "runtime data call"),
    (r"\brequire\s*\(|^\s*import\s+", "module import"),
]

# Claims that are not measurements.
EXCLUDE_CONTEXT = [
    r"\bv?\d+\.\d+\.\d+\b",                       # semver
    r"\b(?:19|20)\d{2}\b",                        # years
    r"\b\d{1,2}:\d{2}(?::\d{2})?\b",              # clock times
    r"\bstep\s+\d+\b|\bcycle\s+\d+\b|\bpass\s+\d+\b",   # ordinal labels
]


def visible_text(html: str) -> str:
    """Strip script, style, comments and tags — what the reader is left with."""
    s = re.sub(r"<script\b.*?</script\s*>", " ", html, flags=re.S | re.I)
    s = re.sub(r"<style\b.*?</style\s*>", " ", s, flags=re.S | re.I)
    s = re.sub(r"<!--.*?-->", " ", s, flags=re.S)
    s = re.sub(r"<[^>]+>", " ", s)
    return re.sub(r"\s+", " ", s)


def _strip_comments(text: str) -> str:
    """
    Remove JS/HTML comments before looking for data sources. Without this,
    `<script>// JSON.parse</script>` counted as a data source and let a page
    of hand-written numbers through.
    """
    text = re.sub(r"/\*.*?\*/", " ", text, flags=re.S)
    text = re.sub(r"<!--.*?-->", " ", text, flags=re.S)
    # `//` anywhere except inside a URL scheme. Anchoring to line start or to
    # a preceding delimiter missed `<script>// JSON.parse</script>`, which is
    # exactly the shape that faked a data source past this check.
    text = re.sub(r"(?<!:)//[^\n]*", " ", text)
    return text


def find_sources(text: str) -> list[str]:
    """Which data-producing mechanisms the document contains, comments excluded."""
    live = _strip_comments(text)
    return [name for pat, name in SOURCE_PATTERNS
            if re.search(pat, live, re.I | re.M)]


def find_claims(text: str) -> list[tuple[str, str]]:
    """Quantitative claims in reader-visible text, with their kind."""
    out, seen = [], set()
    for pat, kind in CLAIM_PATTERNS:
        for m in re.finditer(pat, text, re.I):
            frag = m.group(0).strip()
            window = text[max(0, m.start() - 40): m.end() + 40]
            if any(re.search(x, window, re.I) for x in EXCLUDE_CONTEXT):
                continue
            key = (frag.lower(), kind)
            if key in seen:
                continue
            seen.add(key)
            out.append((frag, kind))
    return out


def scan_artifact(path: Path) -> list[dict]:
    """
    Report quantitative claims that no mechanism in the document could
    have produced.
    """
    path = Path(path)
    try:
        raw = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as e:
        return [{"file": str(path), "line": 0, "kind": "unreadable",
                 "severity": WARN, "detail": str(e)}]

    text = visible_text(raw) if path.suffix.lower() in (".html", ".htm") else raw
    claims = find_claims(text)
    sources = find_sources(raw)

    if not claims:
        return []
    if sources:
        return [{"file": str(path), "line": 0, "kind": "provenance_ok",
                 "severity": "INFO",
                 "detail": f"{len(claims)} claims, sourced via: {', '.join(sorted(set(sources)))}"}]

    sample = "; ".join(f"{f} ({k})" for f, k in claims[:6])
    more = f" (+{len(claims) - 6} more)" if len(claims) > 6 else ""
    return [{"file": str(path), "line": 0, "kind": "unsourced_claims",
             "severity": BLOCK,
             "detail": f"{len(claims)} quantitative claims with no data source "
                       f"in the document: {sample}{more}"}]


def scan_artifacts(paths) -> list[dict]:
    out = []
    for p in paths:
        out.extend(scan_artifact(Path(p)))
    return out
