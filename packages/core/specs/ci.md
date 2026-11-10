# ci

How CI records the runs of a repository's shared branches: it ingests the test
reports, commits the run file as `casefile-ci` and pushes it to the branch it
tested (ADR ci-commits-run-files). This SPEC gives the rules every CI vendor
follows and the GitHub Actions template that applies them. `casefile spec
ingest` describes the operation itself.

- **Actor:** CI (`CASEFILE_ACTOR=ci`), with the executor `ci:<vendor>`
- **Writes:** `**/context/tests/.runs/<run>.jsonl`, one commit per run, nothing else
- **Before:** the workspace is set up (`casefile spec setup`) and the toolchain
  is pinned with a lockfile in `.casefile/`

## The rules

1. **Only shared branches are recorded:** the branches listed in the workflow's
   `push` trigger (the default branch, release branches). A pull request tests
   code that may never merge: its reports stay CI artifacts, nothing is committed.
2. **One record job per run.** Test jobs and shards upload their reports. One
   job that needs them all, and runs even when they failed (failures are what
   must be recorded), downloads them, merges shard reports, ingests once and
   commits once. Shards ingested by separate jobs would conflict in Git.
3. **The record job works on the branch tip, not the tested commit.** It checks
   out the branch, ingests there and passes the tested commit as
   `--tested-commit`, which becomes the `Tested-Commit:` trailer. A re-run keeps
   its run id (`$GITHUB_RUN_ID`) and must see the run file already there.
4. **It commits exactly what ingest returned**, as `casefile-ci`, staging only
   the run file: `git add <path>`, then
   `git -c user.name=casefile-ci -c user.email=casefile-ci@casefile.invalid commit -F <message> -- <path>`,
   then `git push`. No `commit` in the output means nothing new: stop there.
5. **A rejected push is retried by ingesting again, never by resolving a
   conflict.** Reset to the new tip, ingest the same report again and commit
   what it returns. Ingest is idempotent by content, so the retry appends only
   what the branch still lacks. Give up after a few tries and fail the job.
6. **The record commit starts no new test run, and is still validated.** The
   test workflow ignores pushes that only touch `**/context/tests/.runs/**`;
   `casefile validate` runs on every push, record commits included, because
   that is where the write-ownership audit (#41) bounds the push credential.
7. **The push credential is the only bypass of the branch's protection**, and
   it is the repository owner's to grant: a deploy key or a GitHub App, never
   a person's token. Without it, CI records no runs on a protected branch.

## GitHub Actions

Two workflows. `paths-ignore` applies to a whole workflow, so `validate` is
in its own file: the tests skip record commits, the validation does not.

The tests workflow, for a Playwright product at the repository root that is
also the casefile workspace (`casefile.yaml` there), sharded in two:

```yaml tests.yml
name: tests

on:
  push:
    branches: [main, "release/**"]   # the recorded branches (rule 1)
    paths-ignore: ["**/context/tests/.runs/**"]   # a record commit runs no tests (rule 6)
  pull_request:

permissions:
  contents: read

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        shard: [1/2, 2/2]
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 24
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npx playwright test --shard=${{ matrix.shard }} --reporter=blob
      - uses: actions/upload-artifact@v7
        if: ${{ !cancelled() }}
        with:
          name: blob-report-${{ strategy.job-index }}
          path: blob-report/
          retention-days: 7

  record:
    needs: test
    if: ${{ always() && github.event_name == 'push' }}   # failures too; never a pull request (rules 1, 2)
    runs-on: ubuntu-latest
    environment: casefile-record   # holds the push credential (see Setup)
    steps:
      - uses: actions/checkout@v7
        with:
          ref: ${{ github.ref_name }}   # the branch tip, not $GITHUB_SHA (rule 3)
          ssh-key: ${{ secrets.CASEFILE_CI_DEPLOY_KEY }}
      - uses: actions/setup-node@v7
        with:
          node-version: 24
      - run: npm ci
      - run: npm ci --prefix .casefile --ignore-scripts
      - uses: actions/download-artifact@v8
        with:
          pattern: blob-report-*
          path: all-blob-reports
          merge-multiple: true
      - name: Merge the shard reports
        run: npx playwright merge-reports --reporter=junit all-blob-reports
        env:
          PLAYWRIGHT_JUNIT_OUTPUT_NAME: results/junit.xml
      - name: Record the run
        env:
          CASEFILE_ACTOR: ci
          BRANCH: ${{ github.ref_name }}
        run: |
          set -euo pipefail
          for attempt in 1 2 3 4 5; do
            out=$(.casefile/node_modules/.bin/casefile ingest junit results/junit.xml \
              --run "$GITHUB_RUN_ID" --executor ci:github-actions \
              --tested-commit "$GITHUB_SHA" --json)
            if [ "$(jq 'has("commit")' <<<"$out")" != true ]; then
              echo "Nothing new to record"; exit 0
            fi
            jq -r '.commit.message' <<<"$out" > "$RUNNER_TEMP/message"
            mapfile -t files < <(jq -r '.commit.files[]' <<<"$out")
            git add -- "${files[@]}"
            git -c user.name=casefile-ci -c user.email=casefile-ci@casefile.invalid \
              commit -F "$RUNNER_TEMP/message" -- "${files[@]}"
            if git push origin "HEAD:$BRANCH"; then exit 0; fi
            # Rejected: someone pushed first. Start again from the new tip (rule 5).
            git fetch --depth=1 origin "$BRANCH"
            git reset --hard FETCH_HEAD
            sleep $((attempt * 5))
          done
          echo "::error::could not push the run file after 5 tries"; exit 1
```

The validation, on every push and pull request:

```yaml casefile-validate.yml
name: casefile validate

on:
  push:
    branches: [main, "release/**"]   # no paths-ignore: record commits are validated (rule 6)
  pull_request:

permissions:
  contents: read

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 24
      - run: npm ci --prefix .casefile --ignore-scripts
      - run: .casefile/node_modules/.bin/casefile validate
```

Adapt it to the repository:

- **The recorded branches** are the same list in both workflows' `push` trigger.
- **A project below the root** (`apps/web`): the report path stays relative to
  the workspace root (`apps/web/results/junit.xml`), and casefile picks the
  project the report's cases belong to with `--project web`. Each project gives
  its own commit: run the record step once per project.
- **Not Playwright:** each shard uploads its JUnit report. The record job
  ingests each report in turn into the same run id, then commits once with
  the `commit` of the last ingest that returned one: for one run and project
  they are the same commit. A test that one shard splits across Playwright
  projects needs the merged report instead (`casefile spec ingest`).
- **The report must be inside the workspace and not committed:** ingest
  refuses a path outside it (`path.outside_workspace`), and `git reset --hard`
  keeps an ignored or untracked report for the retry. Ignore `results/`.
- **No `concurrency:` on the record job.** GitHub keeps one pending job per
  group and cancels the others, so a run's record would be dropped. The retry
  of rule 5 is what serializes the pushes.

## Setup: the push credential

The record job pushes to a protected branch, so the branch must let its
credential through. Do these once, as a repository admin. Pick one of the two.

**A deploy key** (one repository):

1. Make a key pair, with no passphrase:
   `ssh-keygen -t ed25519 -N "" -C casefile-ci -f casefile-ci`.
2. Add the public key with write access:
   `gh repo deploy-key add casefile-ci.pub --allow-write --title casefile-ci`.
3. Create the environment `casefile-record` (Settings → Environments), limit
   its deployment branches to the recorded branches, and store the private key
   there: `gh secret set CASEFILE_CI_DEPLOY_KEY --env casefile-record < casefile-ci`.
   Only a job on a recorded branch can then read it. Delete both local files.
4. In the branch's ruleset (Settings → Rules → Rulesets), add **Deploy keys**
   to the bypass list. Keep `casefile-ci` the only deploy key with write
   access: the bypass applies to every one of them. Classic branch protection
   cannot exempt a deploy key: move the branch to a ruleset, or use an App.

**A GitHub App** (many repositories, or an organization that forbids write
deploy keys):

1. Create an App with the repository permission **Contents: read and write**
   and nothing else, and install it on the repository.
2. Store its client id as the variable `CASEFILE_CI_APP_CLIENT_ID` and its
   private key as the secret `CASEFILE_CI_APP_KEY` in the environment
   `casefile-record`, limited to the recorded branches as above.
3. Add the App to the ruleset's bypass list.
4. In the record job, mint a token before the checkout and check out with it
   instead of `ssh-key`:

   ```yaml
   - uses: actions/create-github-app-token@v3
     id: app
     with:
       client-id: ${{ vars.CASEFILE_CI_APP_CLIENT_ID }}
       private-key: ${{ secrets.CASEFILE_CI_APP_KEY }}
       permission-contents: write
   - uses: actions/checkout@v7
     with:
       ref: ${{ github.ref_name }}
       token: ${{ steps.app.outputs.token }}
   ```

Not `GITHUB_TOKEN`: every workflow in the repository gets one, so a bypass for
it would let any of them push past protection. And its pushes start no
workflow, so `casefile validate` would never see the record commit.

The credential can push anything to the branch. What bounds it is the audit,
not the credential: a `casefile-ci` commit may only add lines to
`.runs/<Casefile-Run>.jsonl`, each with a `ci:*` executor (ADR
ci-commits-run-files §7, #41).

## Other CI vendors

Rules 1–7 apply as written. Use the vendor's run id as `--run` (the same for
every shard and re-run of one run), its name as the executor (`ci:gitlab-ci`,
`ci:buildkite`), its commit variable as `--tested-commit`
(`$CI_COMMIT_SHA`, `$BUILDKITE_COMMIT`), and a credential that only the
recorded branches can use. The author is always `casefile-ci`, whatever the
vendor.

## Errors

The record job fails, and records nothing, when `casefile ingest` fails
(`casefile spec ingest`, Errors) or when the push is still rejected after the
last try. Re-running the job is safe: ingest appends only what the branch
lacks.
