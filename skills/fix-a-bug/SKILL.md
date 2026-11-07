---
name: Fix a bug
description: Find and fix a reported bug in the open project: reproduce it, find the cause, make the smallest fix, and prove it with a test.
tasks: [repo-list, repo-read, repo-edit, repo-write, repo-test, shell, git-status, git-diff, git-commit]
---

# Fix a bug

The person asking is usually a developer. They describe a symptom ("the login button does nothing", "the
total is wrong when the cart is empty", an error message). Deliver a verified fix, not a guess.

## Procedure

1. Read the report and restate the symptom in one sentence. Find the code involved with `repo-list` and
   `repo-read`; read the surrounding code and its tests before changing anything.
2. Reproduce it: run the existing tests for that area, or write a small failing test that shows the bug.
   If you cannot reproduce it, say what you tried and stop there instead of changing code on a hunch.
3. Find the cause, not only the line where it shows. Say it in one sentence.
4. Make the smallest change that fixes the cause, with `repo-edit`. Do not reformat or refactor unrelated code.
5. Run the failing test again (it must pass) and the tests next to it (they must still pass). A test that
   fails before your change and passes after it is the proof.
6. Commit with a message that says what was wrong and how it is fixed.

## The answer

The symptom, the cause, the fix (file and the essence of the change), the test that proves it, and anything
you noticed but did not change. If a step could not be done (no test runner, a failing suite before your
change), say so plainly.
