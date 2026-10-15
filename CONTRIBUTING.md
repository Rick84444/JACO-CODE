# Contributing to JACO

JACO is a local-first autonomous engineering runtime (IDE, Aura chat, Nova agents, Workplace coordination). It is MIT licensed, and contributions are welcome.

## Set up

You need Node.js 24 or newer (`node --version`) and git.

```sh
git clone https://github.com/Rick84444/jaco-code.git
cd jaco-code
npm ci
npm ci --prefix runtime
cp .env.example .env        # only if you need provider keys; never commit .env
npm test                    # the Nova suite (real SQLite, real local servers, no network)
npm run lint --prefix runtime   # tsc --noEmit
```

Run the IDE with `npm run jaco:start` (see `README.md` and `docs/INSTALLATION.md` for the whole stack). The Lite download is built with `node tools/build-lite.mjs` and checked with `node tools/verify-lite.mjs`.

## Changing something

1. Fork, then branch from `master`.
2. Keep the change focused. A bug fix gets a test that fails without it.
3. Run the tests and the lint above, and any suite for the area you touched.
4. Open a pull request. Say what you ran and what you did **not** run.

## The one rule that matters: say what is verified

Several parts of JACO decide things from evidence, and so do its docs and pull requests. Please keep that standard:

- Write **executed** only for something you ran, and say where (CI, your machine, a phone).
- A test with a stand-in (a fake model, a fake clock) proves the logic, not the real service. Say so.
- Never claim that a feature works on Android/Termux, on Windows, or against a cloud service unless you ran it there.
- Authority never widens by itself: a change must not let an agent run a tool, spend money or deploy that the operator did not allow.

## Security

Do not put keys, tokens or personal data in code, tests, logs or screenshots. Report vulnerabilities privately (see `SECURITY.md`), not as public issues. A test that scans the tracked files for key-shaped strings runs with `npm test`.

## Conduct

Be kind and specific. See `CODE_OF_CONDUCT.md`.

## License

By contributing you agree that your contribution is licensed under the MIT License (`LICENSE`).
