"""
sim_trace tests.

Cases are the ways a simulation trace can look like work without being work.
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sim_trace import (Step, analyse, diff_step,
                       VALUE, DRIFT, UNGROUNDED, TRIVIAL,
                       SUBSTANTIVE, COSMETIC, NONE)

FRAGILE = ("def parse(t):\n"
           "    for l in t.splitlines():\n"
           "        if l.startswith('SCORE:'):\n"
           "            return float(l.split(':')[1])\n"
           "    return 0.5\n")

RENAMED = ("def parse(t):\n"
           "    # tidier\n"
           "    for line in t.splitlines():\n"
           "        if line.startswith('SCORE:'):\n"
           "            return float(line.split(':')[1])\n"
           "    return 0.5\n")

FIXED = ("import re\n"
         "def parse(t):\n"
         "    m = re.search(r'\\*{0,2}SCORE\\*{0,2}\\s*:', t)\n"
         "    if not m:\n"
         "        return None\n"
         "    return float(re.search(r'[\\d.]+', t[m.end():]).group())\n")

RAN_FAIL = ({"cmd": "python3 -m pytest", "exit": 1},)


def steps(*specs):
    return [Step(i + 1, a, challenge=c, runs=r)
            for i, (a, c, r) in enumerate(specs)]


class TestNormalisation(unittest.TestCase):

    def test_comment_change_is_not_work(self):
        d = diff_step(Step(1, {"a.py": "def f():\n    return 1\n"}),
                      Step(2, {"a.py": "def f():\n    # note\n    return 1\n"},
                           runs=RAN_FAIL))
        self.assertEqual(d["kind"], COSMETIC)

    def test_variable_rename_is_not_work(self):
        """The case that exposed the bug on first run of this module."""
        d = diff_step(Step(1, {"p.py": FRAGILE}),
                      Step(2, {"p.py": RENAMED}, runs=RAN_FAIL))
        self.assertEqual(d["kind"], COSMETIC)
        self.assertLess(d["magnitude"], 0.02)

    def test_docstring_reword_is_not_work(self):
        a = 'def f():\n    """Old wording."""\n    return 1\n'
        b = 'def f():\n    """Completely different wording here."""\n    return 1\n'
        d = diff_step(Step(1, {"a.py": a}), Step(2, {"a.py": b}, runs=RAN_FAIL))
        self.assertEqual(d["kind"], COSMETIC)

    def test_reformatting_is_not_work(self):
        a = "def f(x):\n    return x+1\n"
        b = "def f(x):\n\n    return x + 1\n\n"
        d = diff_step(Step(1, {"a.py": a}), Step(2, {"a.py": b}, runs=RAN_FAIL))
        self.assertEqual(d["kind"], COSMETIC)

    def test_logic_change_is_work(self):
        d = diff_step(Step(1, {"p.py": FRAGILE}),
                      Step(2, {"p.py": FIXED}, runs=RAN_FAIL))
        self.assertEqual(d["kind"], SUBSTANTIVE)
        self.assertGreater(d["magnitude"], 0.02)

    def test_renaming_a_called_function_is_work(self):
        """Local names are normalised; API names are not."""
        a = "def f():\n    return helper(1)\n"
        b = "def f():\n    return other_helper(1)\n"
        d = diff_step(Step(1, {"a.py": a}), Step(2, {"a.py": b}, runs=RAN_FAIL))
        self.assertEqual(d["kind"], SUBSTANTIVE)

    def test_new_file_is_work(self):
        d = diff_step(Step(1, {"a.py": "x = 1\n"}),
                      Step(2, {"a.py": "x = 1\n", "b.py": "y = 2\n"}, runs=RAN_FAIL))
        self.assertEqual(d["kind"], SUBSTANTIVE)
        self.assertEqual(d["added"], ["b.py"])

    def test_syntax_error_falls_back_to_text(self):
        d = diff_step(Step(1, {"a.py": "def f(:\n"}),
                      Step(2, {"a.py": "def f(:\n    broken more\n"}, runs=RAN_FAIL))
        self.assertIn(d["kind"], (SUBSTANTIVE, COSMETIC))

    def test_non_python_uses_text_normalisation(self):
        d = diff_step(Step(1, {"a.md": "# Title\nBody text\n"}),
                      Step(2, {"a.md": "# Title\n\n   Body text   \n"}, runs=RAN_FAIL))
        self.assertEqual(d["kind"], COSMETIC)


class TestVerdicts(unittest.TestCase):

    def test_grounded_and_substantive_is_value(self):
        r = analyse(steps(({"p.py": FRAGILE}, "", ()),
                          ({"p.py": FIXED}, "bold breaks startswith", RAN_FAIL)))
        self.assertEqual(r["verdict"], VALUE)
        self.assertEqual(r["productive"], 1)

    def test_grounded_but_cosmetic_is_drift(self):
        r = analyse(steps(({"p.py": FRAGILE}, "", ()),
                          ({"p.py": RENAMED}, "seems fragile", RAN_FAIL)))
        self.assertEqual(r["verdict"], DRIFT)
        self.assertEqual(r["grounded_unfixed"], 1)

    def test_no_change_at_all_is_drift(self):
        r = analyse(steps(({"p.py": FRAGILE}, "", ()),
                          ({"p.py": FRAGILE}, "looks fine",
                           ({"cmd": "pytest", "exit": 0},))))
        self.assertEqual(r["verdict"], DRIFT)

    def test_change_without_execution_is_ungrounded(self):
        r = analyse(steps(({"p.py": FRAGILE}, "", ()),
                          ({"p.py": FIXED}, "feels brittle", ())))
        self.assertEqual(r["verdict"], UNGROUNDED)
        self.assertEqual(r["unverified_changes"], 1)

    def test_single_step_is_trivial(self):
        self.assertEqual(analyse([Step(1, {"p.py": FRAGILE})])["verdict"], TRIVIAL)

    def test_one_real_step_among_no_ops_still_counts(self):
        r = analyse(steps(({"p.py": FRAGILE}, "", ()),
                          ({"p.py": FRAGILE}, "nothing", RAN_FAIL),
                          ({"p.py": FIXED}, "bold breaks it", RAN_FAIL),
                          ({"p.py": FIXED}, "nothing more", RAN_FAIL)))
        self.assertEqual(r["verdict"], VALUE)
        self.assertEqual(r["productive"], 1)
        self.assertEqual(r["grounded_unfixed"], 2)




class TestAdversarial(unittest.TestCase):
    """Holes found by attacking sim_trace after first delivery."""

    def test_reordering_functions_is_not_work(self):
        """Moving a function up the file scored magnitude 0.568 as substantive."""
        a = "def parse(t):\n    return _inner(t)\ndef _inner(t):\n    return 0.5\n"
        b = "def _inner(t):\n    return 0.5\ndef parse(t):\n    return _inner(t)\n"
        d = diff_step(Step(1, {"p.py": a}), Step(2, {"p.py": b}, runs=RAN_FAIL))
        self.assertEqual(d["kind"], COSMETIC)

    def test_reordering_does_not_hide_a_real_edit(self):
        a = "def parse(t):\n    return _inner(t)\ndef _inner(t):\n    return 0.5\n"
        b = "def _inner(t):\n    return 0.9\ndef parse(t):\n    return _inner(t)\n"
        d = diff_step(Step(1, {"p.py": a}), Step(2, {"p.py": b}, runs=RAN_FAIL))
        self.assertEqual(d["kind"], SUBSTANTIVE)

if __name__ == "__main__":
    unittest.main(verbosity=2)
