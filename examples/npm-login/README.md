# npm-login: the first real case of casefile

This example is **not affiliated with, endorsed by or sponsored by npm, Inc. or
GitHub, Inc.** "npm" is their trademark. The example only loads the public
sign-in page at <https://www.npmjs.com/login> to check its front end. It holds no
logos or screenshots of their brand, and no test submits a username or a
password.

It models a product repository whose sign-in page is covered by casefile cases.
Those cases were produced through the real flow, not by hand (#35): setup skill,
`qa-cover`, the product's own Playwright run, then `casefile ingest junit`. It
also shows the boundary:
- the **product** owns its runner (Playwright) and its specs (`e2e/`);
- **casefile** stores the cases, links them to tests with `automation.ref`, and
  ingests the results.

## Layout

```
package.json, package-lock.json   the product's own dev dependency: @playwright/test
playwright.config.ts              baseURL https://www.npmjs.com, JUnit to results/junit.xml
e2e/login.spec.ts                 six front-end checks, no credentials
casefile.yaml                     workspace: one project, npm-login, at `.`
.casefile/package.json            toolchain pin: @casefile/cli
context/tests/
  _common.yaml                    surfaces [web], e2e, P2, eligible, review required
  login/TC-0001 … TC-0009.md      nine drafts from qa-cover
  .runs/local-2026-10-17-1.jsonl  the ingested Playwright run
```

## How it was built

Every step ran from the repository root. Before the first publish, casefile runs
from source, with the toolchain linked to `apps/cli` (ADR npm-scope-casefile §6).

1. **Human:** `pnpm casefile init --cwd examples/npm-login` and
   `node scripts/link-toolchain.mjs examples/npm-login`.
2. **Agent, `casefile-setup`:**
   - Read `casefile spec setup`.
   - Asked the human once to confirm the plan: project `npm-login` at `.`;
     commons `surfaces: [web]`, `layer: e2e`, `priority: P2`,
     `automation.eligible: true`, `review.mode: required`; no Dependabot entry.
   - Ran `casefile project add npm-login --path .` and filled the five `TODO`s.
   - `validate` exited 0 on round 1.
   - Committed as `casefile-agent` with `git commit -- <paths>`.
3. **Agent, `qa-cover login`**, asked: *"cover the front end of the sign-in
   page: render, empty-submit validation, masked password, keyboard,
   accessibility, links; whatever needs an account as manual"*.
   - One `casefile cover login --json --cases "$(cat cases.json)"` call wrote
     nine drafts.
   - The commit used the returned message, with `Requested-by`, `Agent` and
     `Casefile-Change` trailers.
4. **Product run:** `npm install` and `npx playwright test` in this directory
   wrote `results/junit.xml`.
5. **Agent, ingest:**
   `casefile ingest junit results/junit.xml --run local-2026-10-17-1 --executor agent:claude-code`.
   All six results matched a case by `automation.ref`. Re-ingesting wrote
   nothing. The run file was committed as `casefile-agent`.

## What it is designed to show

| Try | Expected |
|---|---|
| `casefile overview --cwd examples/npm-login` | 9 drafts in `login`: 6 `automated` (P1 render, P3 links, the rest P2), 3 `manual` |
| `TC-0001`, `TC-0004`, `TC-0005` | last run `passed` |
| `TC-0002`, `TC-0003`, `TC-0006` | last run `failed`: the page answered those tests with a Cloudflare "security verification" challenge, not the form (#67). Their assertions were then checked by hand on the live page and hold: an empty submit leaves Username `valueMissing` on `/login`, Show password turns the field to `text` (the button becomes Hide password), and the links point to `/forgot` and `/signup` |
| `TC-0007` … `TC-0009` | `manual`, `automation.eligible: false`: they need a real account (sign in, wrong password, second factor) |
| `casefile validate --cwd examples/npm-login` | exit 0 once the toolchain is linked (step 1) |

`packages/core/src/demo.fixture.ts` exports these outcomes as
`NPM_LOGIN_EXPECTED`, and `packages/core/src/npm-login.test.ts` checks them.

## Run the specs

Playwright is a dependency of this example only. The repository's
`pnpm install` does not install it, and the framework's CI never runs these
specs.

```bash
cd examples/npm-login && npm install && npx playwright install chromium && npx playwright test
```

The tests hit the live site, so results depend on it. Its bot protection may
challenge a headless browser; casefile never tries to get around that.

## Open it in the UI

```bash
pnpm build && pnpm ui --cwd examples/npm-login
```

Then open <http://127.0.0.1:4321>. The UI lists the cases, automated vs manual,
and each case's last run.

## Gaps this case found

- **#63:** the npm name `casefile` was taken. Solved with the `@casefile` scope
  and `scripts/link-toolchain.mjs`.
- **#67:** environment-blocked results (the bot challenge) are ingested as
  product `failed`.
- **#68:** the UI shows no run history and no failure reason.
- **#69:** the UI does not tell "linked, never ran" from manual, and the table
  hides "Last run" at narrow widths.
- **#70:** nothing says how a CI job gets its run file into the repository.
  This run was ingested locally by the agent for that reason.
