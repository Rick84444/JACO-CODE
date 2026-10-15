---
name: Repo security scan
description: Read-only security review of a public GitHub repository (leaked secrets, risky workflows, unpinned dependencies), reported with the file each finding comes from.
tasks: [web-fetch, mcp-call]
---

# Repo security scan

Review the public GitHub repository named in the operator's input. Read only: never open issues, push,
fork or contact anyone. This is the free operator review; the paid `repo-scan` task is only for a
customer order and is not used here.

## Steps

1. Take the repository URL exactly as written in the input (`https://github.com/<owner>/<repo>`). If
   there is none, output `{"blocked":true,"reason":"no public GitHub repository URL in the input"}`.
2. List its files with `web-fetch` on
   `https://api.github.com/repos/<owner>/<repo>/git/trees/HEAD?recursive=1`.
3. Read the files that matter most with `web-fetch` on
   `https://raw.githubusercontent.com/<owner>/<repo>/HEAD/<path>` (at most four per turn):
   - `.github/workflows/*.yml`: `pull_request_target` with a checkout of the PR head, secrets in `run:`
     lines, unpinned third-party actions (`uses: x/y@main` instead of a tag or SHA).
   - `.env*`, `*.pem`, `id_rsa*`, `config*.json` and similar committed files: anything that looks
     like an API key, token, password or private key.
   - `package.json` / `requirements.txt` / `go.mod`: install scripts and dependencies without versions.
4. Never repeat a secret in the report: name the file, line and kind of value (for example
   "an AWS access key"), and show at most its first four characters.

## Report

Complete with `{"complete":true,"reason":...}` where reason lists each finding as
"severity, file, what and why", each citing the receipt it comes from as [#n]. Say plainly which files
were not read, and state "no findings in the files read" when that is the result: absence of findings in
part of a repository is not a clean bill of health.
