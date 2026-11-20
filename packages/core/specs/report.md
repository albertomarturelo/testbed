# report

A Markdown summary of the workspace's cases, for a GitHub Actions job summary
or a pull-request comment: per project, one row per feature with its cases,
drafts, P0 and automation; the drafts awaiting review; the cases whose latest
run failed; and what `casefile validate` finds. It never writes. The evidence
of a milestone is `casefile milestone report` (`casefile spec milestone`).

- **Actor:** human, agent, CI
- **CLI:** `casefile report [--query <query>] [--project <name>] [--json]`
- **Writes:** nothing

## Input

| Field | Type | Meaning |
|---|---|---|
| `project` | project name | Only that project. Filled by the host from `--project` or the project containing `--cwd`; absent: every project. |
| `query` | query text | Only the cases it selects (`casefile spec query`); absent: every resolved case, retired ones too. |

## Output

```json
{ "markdown": "# casefile report\n\n## web\n\n| Feature | Cases | …",
  "projects": [{ "name": "web", "path": ".", "cases": 8, "drafts": 1, "p0": 1,
                 "automated": 3, "linked": 0, "no_test": 2, "not_eligible": 3,
                 "failed": 2 }],
  "cases": { "total": 8, "drafts": 1, "p0": 1, "failed": 2 },
  "findings": { "errors": 0, "warnings": 0 },
  "left_out": 0 }
```

Without `--json` the CLI prints only `markdown`, as-is (ADR cli-generic-host
§6), so it can be redirected to a file. `--json` prints the whole result: a
script decides on the counts (`cases.failed > 0`, `findings.errors > 0`)
without parsing the Markdown.

The Markdown, per project in `casefile.yaml` order:

- **A table**, one row per feature in tree order (parents before children,
  siblings by name), with a **Total** row when there are several:
  - `Cases`, `Drafts` (`state = draft`), `P0`.
  - The automation columns, counted as the viewer's badges show them:
    `Automated` (`automated` or `flaky`, proven by runs), `Linked` (a test is
    linked in `automation.ref` and no run reported it yet), `No test` (could
    be automated, `manual`, no test linked) and `Not eligible`
    (`automation.eligible: false`). `candidate`, `in_progress` and `retired`
    count in none.
  - `Failed`: cases whose latest run event, any executor, is `failed`.
- **Drafts awaiting review**, `ref` and title, when there are any.
- **Latest run failed**, `ref` and title, when there are any.

A project with no run event at all is documentation only: its table has no
`Automated` and no `Failed` column, it has no failed list, and its `failed`
count is `null`. Nothing says "never ran"; a case with no run is complete (ADR
authoring-loop-first).

It ends with one line: `` `casefile validate`: N errors, N warnings. `` over
the same projects. The report itself succeeds when validate finds errors; it
reports them.

Case titles and feature names are data: they are printed on one line, with
Markdown's markup characters escaped.

### Size

A pull-request comment holds at most 65,536 characters, and so does
`markdown`. Headings, table headers, totals and the closing line always stay;
table rows and list lines are kept in reading order while they fit, and a
block that lost some ends with a line saying how many were not shown.
`left_out` is how many rows and lines were cut, 0 when none was.

## In a workflow

Append it to the job summary, after the steps that test and ingest:

```yaml
- name: casefile report
  if: always()
  run: .casefile/node_modules/.bin/casefile report >> "$GITHUB_STEP_SUMMARY"
```

Or post it on a pull request (the job needs `pull-requests: write`):

```yaml
- name: Comment the casefile report
  if: github.event_name == 'pull_request'
  env:
    GH_TOKEN: ${{ github.token }}
  run: |
    .casefile/node_modules/.bin/casefile report > casefile-report.md
    gh pr comment "${{ github.event.pull_request.number }}" --body-file casefile-report.md
```

## Errors

| Code | When |
|---|---|
| `project.unknown` | `project` names no project |
| query codes | `query` does not parse; the error has `field: "query"` and its `column` |
| loader codes | `casefile.yaml` cannot be read; run `casefile validate` |
