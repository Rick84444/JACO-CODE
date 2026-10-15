"""
delivery_gate test suite.

Cases are drawn from real failures in this project's history, not invented:
the hand-written dashboard, the skeleton that was never run, and the gate's
own cwd bug that its first self-run exposed.
"""

import os
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from delivery_gate import (check, scan_python, scan_artifact, run,
                           find_claims, find_sources, visible_text,
                           evidence_summary, BLOCKED, PASS, UNPROVEN)
from delivery_gate.scan import BLOCK


def tmpfile(content: str, suffix: str) -> str:
    f = tempfile.NamedTemporaryFile("w", suffix=suffix, delete=False, encoding="utf-8")
    f.write(content)
    f.close()
    return f.name


class TestSourceScan(unittest.TestCase):

    def _kinds(self, src):
        p = tmpfile(textwrap.dedent(src), ".py")
        try:
            return {f["kind"] for f in scan_python(Path(p))}
        finally:
            os.unlink(p)

    def test_pass_body_is_hollow(self):
        self.assertIn("hollow_function", self._kinds("def f():\n    pass\n"))

    def test_ellipsis_body_is_hollow(self):
        self.assertIn("hollow_function", self._kinds("def f():\n    ...\n"))

    def test_docstring_only_is_hollow(self):
        self.assertIn("hollow_function", self._kinds('def f():\n    """later"""\n'))

    def test_not_implemented_is_hollow(self):
        self.assertIn("hollow_function",
                      self._kinds("def f():\n    raise NotImplementedError\n"))

    def test_real_body_is_clean(self):
        self.assertNotIn("hollow_function",
                         self._kinds("def f(x):\n    return x * 2\n"))

    def test_pass_inside_loop_is_not_a_stub(self):
        src = "def f(xs):\n    for x in xs:\n        if x:\n            pass\n    return len(xs)\n"
        self.assertNotIn("hollow_function", self._kinds(src))

    def test_abstractmethod_is_exempt(self):
        src = ("from abc import abstractmethod\n"
               "class C:\n    @abstractmethod\n    def f(self): ...\n")
        self.assertNotIn("hollow_function", self._kinds(src))

    def test_todo_marker_blocks(self):
        self.assertIn("marker", self._kinds("def f():\n    return 1  # TODO: fix\n"))

    def test_swallowed_exception_blocks(self):
        src = "def f():\n    try:\n        g()\n    except Exception:\n        pass\n"
        self.assertIn("swallowed_exception", self._kinds(src))

    def test_syntax_error_reported_not_raised(self):
        self.assertIn("syntax_error", self._kinds("def f(:\n"))


class TestProvenance(unittest.TestCase):
    """The check that would have stopped the fabricated dashboard."""

    def _scan(self, html):
        p = tmpfile(html, ".html")
        try:
            return scan_artifact(Path(p))
        finally:
            os.unlink(p)

    def test_hardcoded_numbers_block(self):
        r = self._scan("<p>99.7% of 10,000 runs completed in 74ms.</p>")
        self.assertEqual(r[0]["severity"], BLOCK)
        self.assertEqual(r[0]["kind"], "unsourced_claims")

    def test_sourced_numbers_pass(self):
        r = self._scan("<p>99.7% of 10,000 runs.</p>"
                       "<script>const SEED={};JSON.parse('{}')</script>")
        self.assertEqual(r[0]["kind"], "provenance_ok")

    def test_template_substitution_counts_as_a_source(self):
        r = self._scan("<p>rate 88.5% over 4,000 runs</p>"
                       "<script>el.innerHTML=`${d.rate}`</script>")
        self.assertEqual(r[0]["kind"], "provenance_ok")

    def test_prose_without_numbers_is_clean(self):
        self.assertEqual(self._scan("<p>State merges without coordination.</p>"), [])

    def test_versions_and_dates_are_not_claims(self):
        self.assertEqual(self._scan("<p>v1.1.0 released 2026 at 14:30</p>"), [])

    def test_css_numbers_are_not_claims(self):
        html = "<style>.a{width:99.7%;padding:74px}</style><p>Merged state.</p>"
        self.assertEqual(self._scan(html), [])

    def test_visible_text_strips_script_and_style(self):
        t = visible_text("<style>a{b:1}</style><script>var x=2</script><p>hi</p>")
        self.assertNotIn("var x", t)
        self.assertNotIn("b:1", t)
        self.assertIn("hi", t)


class TestExecution(unittest.TestCase):

    def test_success_recorded(self):
        r = run("python3 -c \"print('ok')\"")
        self.assertEqual(r["exit"], 0)
        self.assertIn("ok", r["stdout"])

    def test_failure_recorded_not_raised(self):
        r = run("python3 -c \"import sys; sys.exit(3)\"")
        self.assertEqual(r["exit"], 3)
        self.assertEqual(r["status"], "ran")

    def test_missing_binary_recorded(self):
        r = run("definitely-not-a-real-binary-xyz")
        self.assertEqual(r["status"], "not_found")
        self.assertNotEqual(r["exit"], 0)

    def test_timeout_recorded(self):
        r = run("python3 -c \"import time; time.sleep(5)\"", timeout=1)
        self.assertEqual(r["status"], "timeout")

    def test_summary_counts(self):
        recs = [run("python3 -c 'pass'"), run("python3 -c \"import sys;sys.exit(1)\"")]
        s = evidence_summary(recs)
        self.assertEqual((s["passed"], s["failed"], s["all_green"]), (1, 1, False))


class TestVerdicts(unittest.TestCase):

    def setUp(self):
        self.d = tempfile.mkdtemp()
        Path(self.d, "good.py").write_text("def f(x):\n    return x + 1\n")

    def test_clean_code_with_no_commands_is_unproven(self):
        """A clean scan over code nobody ran is not a pass."""
        self.assertEqual(check(self.d)["verdict"], UNPROVEN)

    def test_clean_code_with_passing_command_passes(self):
        r = check(self.d, commands=["python3 -c 'pass'"])
        self.assertEqual(r["verdict"], PASS)

    def test_failing_command_blocks(self):
        r = check(self.d, commands=["python3 -c \"import sys;sys.exit(1)\""])
        self.assertEqual(r["verdict"], BLOCKED)

    def test_stub_blocks_even_when_tests_pass(self):
        Path(self.d, "stub.py").write_text("def todo_later():\n    pass\n")
        r = check(self.d, commands=["python3 -c 'pass'"])
        self.assertEqual(r["verdict"], BLOCKED)

    def test_unsourced_artifact_blocks_even_when_tests_pass(self):
        a = tmpfile("<p>99.9% across 5,000 runs</p>", ".html")
        try:
            r = check(self.d, artifacts=[a], commands=["python3 -c 'pass'"])
            self.assertEqual(r["verdict"], BLOCKED)
        finally:
            os.unlink(a)


class TestSelfApplication(unittest.TestCase):
    """The gate must survive its own rules."""

    def test_gate_passes_its_own_scan(self):
        root = Path(__file__).resolve().parent.parent / "delivery_gate"
        r = check(root, commands=["python3 -c 'import delivery_gate'"])
        self.assertEqual(r["blocking"], [], f"gate blocks itself: {r['blocking']}")
        self.assertEqual(r["verdict"], PASS)




class TestAdversarial(unittest.TestCase):
    """
    Holes found by attacking the gate after it was first delivered. Every case
    here passed the original implementation.
    """

    def _kinds(self, src):
        p = tmpfile(textwrap.dedent(src), ".py")
        try:
            return {f["kind"] for f in scan_python(Path(p))}
        finally:
            os.unlink(p)

    def test_constant_return_stubs_are_caught(self):
        """`return {}` is the commonest stub shape after `pass`; all passed."""
        for src in ("def get_config():\n    return {}\n",
                    "def get_items():\n    return []\n",
                    "def compute():\n    return 0\n",
                    "def render():\n    return ''\n",
                    "def is_valid():\n    return True\n"):
            self.assertIn("hollow_function", self._kinds(src), src)

    def test_literal_return_using_params_is_not_a_stub(self):
        """A guard clause returning a literal is real code."""
        src = "def f(x):\n    if x > 0:\n        return True\n    return False\n"
        self.assertNotIn("hollow_function", self._kinds(src))

    def test_logged_swallow_is_caught(self):
        """print(e) discards the error exactly as `pass` does."""
        src = "def f():\n    try:\n        g()\n    except Exception as e:\n        print(e)\n"
        self.assertIn("swallowed_exception", self._kinds(src))

    def test_except_that_reraises_is_fine(self):
        src = "def f():\n    try:\n        g()\n    except Exception:\n        raise\n"
        self.assertNotIn("swallowed_exception", self._kinds(src))

    def test_marker_words_in_prose_do_not_block(self):
        """The scanner blocked its own source for explaining what a stub is."""
        src = ('def f(x):\n    # this is not a stub, it explains placeholder shapes\n'
               '    return x + 1\n')
        self.assertNotIn("marker", self._kinds(src))

    def test_real_markers_still_block(self):
        for src in ("def f():\n    return 1  # TODO: fix\n",
                    "def f():\n    # FIXME\n    return 1\n",
                    "def f():\n    return 1  # XXX: broken\n"):
            self.assertIn("marker", self._kinds(src), src)

    def test_commented_out_source_does_not_count_as_provenance(self):
        """`<script>// JSON.parse</script>` faked a data source."""
        a = tmpfile("<p>99.7% of 10,000 runs</p><script>// JSON.parse</script>", ".html")
        try:
            r = scan_artifact(Path(a))
            self.assertEqual(r[0]["kind"], "unsourced_claims")
        finally:
            os.unlink(a)

    def test_url_is_not_mistaken_for_a_comment(self):
        a = tmpfile('<p>99.7% of 10,000 runs</p>'
                    '<script>fetch("https://x/y");JSON.parse(z)</script>', ".html")
        try:
            self.assertEqual(scan_artifact(Path(a))[0]["kind"], "provenance_ok")
        finally:
            os.unlink(a)

    def test_contract_command_cannot_be_bypassed(self):
        """
        The largest hole: the party being measured chose the measurement.
        `echo done` bought a PASS. A contract in the repo cannot be dropped.
        """
        from delivery_gate.gate import REENTRY_FLAG
        d = tempfile.mkdtemp()
        Path(d, "a.py").write_text("def f(x):\n    return x\n")

        # This test may itself be running inside a gate invocation, where the
        # re-entry guard suppresses contract loading. Clear it for the duration
        # so the behaviour under test is reachable, then restore it.
        prior = os.environ.pop(REENTRY_FLAG, None)
        try:
            self.assertEqual(
                check(d, commands=["echo done"], contract_root=d)["verdict"], PASS)
            Path(d, ".deliverygate").write_text('python3 -c "import sys; sys.exit(1)"\n')
            r = check(d, commands=["echo done"], cwd=d, contract_root=d)
            self.assertEqual(r["verdict"], BLOCKED)
            self.assertTrue(r["contract_applied"])
        finally:
            if prior is not None:
                os.environ[REENTRY_FLAG] = prior

    def test_reentry_guard_stops_contract_recursion(self):
        """
        A contract that runs the test suite, plus a test that calls the gate,
        recursed without bound until it was killed at the two-minute limit.
        """
        from delivery_gate.gate import REENTRY_FLAG, load_contract
        d = tempfile.mkdtemp()
        Path(d, ".deliverygate").write_text("python3 -c 'pass'\n")
        prior = os.environ.pop(REENTRY_FLAG, None)
        try:
            self.assertEqual(load_contract(d), ["python3 -c 'pass'"])
            os.environ[REENTRY_FLAG] = "1"
            self.assertEqual(load_contract(d), [])
        finally:
            os.environ.pop(REENTRY_FLAG, None)
            if prior is not None:
                os.environ[REENTRY_FLAG] = prior

if __name__ == "__main__":
    unittest.main(verbosity=2)
