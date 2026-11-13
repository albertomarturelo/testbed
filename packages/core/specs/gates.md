# gates

Shows, for one milestone, whether each release gate of the project is green or
red, and why. The gates are the project's `context/releases/policy.yaml`; the
results are the executions recorded in the milestone (`casefile spec milestone`).
It never writes.

- **Actor:** human, agent, CI
- **CLI:** `casefile gates <milestone> [--date <YYYY-MM-DD>] [--build <build>] [--project <name>] [--json]`
- **Writes:** nothing

## Input

| Field | Type | Meaning |
|---|---|---|
| `milestone` | slug | The milestone, `web-1.2.0`. The ref of releases before `0.2.0`, `release:web-1.2.0`, names the same one. |
| `date` | `YYYY-MM-DD` | The evaluation date: a triage that expires before it no longer counts. Default: today, in UTC. |
| `build` | text | `milestone.build` in gate scopes and for `build: current`. Default: the latest build among the milestone's executions. |
| `project` | project name | The project whose policy, cases and runs are evaluated. Filled by the host from `--project` or the project containing `--cwd`; required in a workspace of several. |

## The policy

```yaml context/releases/policy.yaml
gates:
  - name: smoke
    scope: labels.smoke = true AND state = active
    require:
      executed: 100
      failures: none
      executor: [ci]
```

Each gate has a `scope` (a query, `casefile spec query-grammar`; it may read
`milestone.name` and `milestone.build`, or the older `release.name` and
`release.build`) and the requirements its cases' results must meet:

| Requirement | Green when |
|---|---|
| `executed: N` | at least N % of the cases in scope have a result |
| `passed: N` | at least N % of them passed |
| `failures: none` | no result is `failed` or `blocked` |
| `failures: triaged` | every `failed` or `blocked` result has a triage not expired on `date` |
| `executor: [kinds]` | every result was recorded by one of those kinds (`ci`, `human`, `agent`) |
| `build: current` | every result is on `milestone.build` |
| `source: automated` / `manual` | every result is automated (it names a test) / manual |

A case's result is its latest `passed`, `failed` or `blocked` execution in the
milestone; other milestones never count. A scope that selects no case is red:
a typo must not pass a release. The rules in full: ADR release-gate-evaluation.

## What it does

1. Refuses a `milestone` that names nothing (`release:` alone):
   `gates.invalid_milestone`.
2. Finds the project (`project.required`, `project.unknown`) and its policy:
   none is `gates.no_policy`; one that does not match its schema returns that
   file's errors.
3. Evaluates every gate over the project's cases and the milestone's
   executions. A scope that does not parse fails the whole evaluation, every
   bad scope located at `gates.<i>.scope` (`casefile validate` reports them
   too, as `policy.invalid_scope`).
4. Answers each gate's verdict, the cases its scope selects and, when red, one
   reason per failed requirement naming the offending cases. `green` is true
   when every gate is.

Red gates are a result, not an error: the exit code is 0 either way. A
pipeline that must stop on red gates reads `value.green` from the `--json`
output (`casefile gates web-1.2.0 --json | jq -e .value.green`).

A milestone no file declares still evaluates (run files from before `0.2.0`
name free-text releases), and `next` suggests opening it; `next` also says
when no execution names it yet, which is usually a typo. A closed milestone is
evaluated now; the record of its close is its frozen evidence (`casefile
milestone report <slug>`), where triages counted until the close.

## Output

```json
{ "project": "web",
  "milestone": "web-1.2.0",
  "state": "open",
  "date": "2026-10-20",
  "build": "web-1.2.0+101",
  "green": false,
  "gates": [
    { "name": "smoke", "verdict": "red", "cases": ["TC-0001", "TC-0007"],
      "reasons": [{ "requirement": "failures", "message": "failures are not allowed", "cases": ["TC-0007"] }] },
    { "name": "auth", "verdict": "green", "cases": ["TC-0001", "TC-0002"], "reasons": [] } ],
  "next": [] }
```

`state` is `open`, `closed`, or `undeclared` (no milestone file).

## Errors

| Code | When |
|---|---|
| `gates.invalid_milestone` | `milestone` names nothing (`release:` alone) |
| `gates.no_policy` | the project has no `context/releases/policy.yaml` |
| `query.*` (`field: gates.<i>.scope`) | a gate scope does not parse or reads an unknown variable |
| `project.required` / `project.unknown` | as in `casefile spec query` |
| `operation.invalid_input` | `date` is not `YYYY-MM-DD` |
