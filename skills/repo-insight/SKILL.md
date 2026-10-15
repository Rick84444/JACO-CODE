---
name: Repo insight
description: Read-only overview of the operator's repository or a recent change, from git history and the files themselves.
tasks: [mcp-call]
---

# Repo insight

Answer the operator's input about the repository JACO works in. Read only; never change files or git state.

## Tools (mcp-call)

- `repo` server (JACO's own, read only): `commit_files` (every file a commit changed, with status and
  line counts, without the diff) and `recent_commits` (latest commits with their files). Use these first
  for "what changed" questions.
- `git` server: `git_status`, `git_log` (use `max_count` 10 to 20), `git_show` for one commit,
  `git_diff_unstaged` / `git_diff_staged` for uncommitted work. Pass `repo_path` as the repository root
  shown in the `filesystem` server's allowed directory.
- `filesystem` server: `list_allowed_directories` first if the root is unknown, then `directory_tree`
  or `list_directory` for structure, `search_files` to locate files, `read_text_file` (with `head`
  for large files) for content.

## Procedure

1. Establish the repository root (`list_allowed_directories`) unless it is already in a receipt.
2. Gather only what the input asks about: recent history for "what changed", structure and entry points
   for "how is it built", the specific files for a question about one feature.
3. Stop gathering after about 8 tool calls (more only if the input names several commits or files). Then complete with what you found and say what is still unknown; never block for lack of calls.
4. What a commit changed comes from `repo.commit_files` (or `git_show <hash>`) only. `git_diff` compares the working tree, which
   includes uncommitted work, so never attribute its files to a commit. Tool output is cut at 30000
   characters: if a `git_show` result ends mid-diff, say the file list may be incomplete.
5. Complete with a reason that answers the input in plain sentences and cites the evidence: commit
   hashes, file paths, and the receipt that showed each fact. Say what could not be determined.
