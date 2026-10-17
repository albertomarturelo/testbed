# How a release gate is evaluated

## Status

Accepted — 2026-10-17 (#10). Settles the two gaps found by #6 (release naming,
source of `release.build`).

## Context

A project's `context/releases/policy.yaml` lists gates: a DSL `scope` selecting
cases and a `require` block (`executed`, `passed`, `failures`, `executor`,
`build`, `source`) checked against run results. The schema says what each key
means in one line; it does not say which result of a case counts, how a release
is named, or where `release.build` comes from. Three facts force a decision:

- Work items name a release `release:web-1.2.0`; run events store
  `release: web-1.2.0`, without the prefix.
- `build: current` needs `release.build`, but no file declares it.
- `.runs/` is append-only (CONVENTIONS 5): a case can have many results for one
  release, from several executors, and corrections are new events.

Gate results are derived and must be recomputable from the repo (CONVENTIONS 3),
so evaluation is a pure function of cases, runs, policy and release.

## Decision

1. **Release ref.** A gate is evaluated for a release given as `release:<name>`
   or `<name>`; the `release:` prefix is stripped. A run event belongs to the
   release when its `release` equals `<name>`. Gate scopes see
   `release.name = <name>` and `release.build` (point 2).
2. **`release.build`** is the caller's value when given; otherwise the `build` of
   the latest event (by `at`, then file order) among the release's events that
   carry one. With none, `release.build` is unset, and `build: current` is red
   with the reason "no build known for the release".
3. **Latest result.** For each in-scope case, only its events for the release
   count; the latest by `at` (ties: the later in file order) is *the* result.
   Results of other releases never count. A correction is a newer event.
4. **Requirements**, each checked on the latest results:
   - `executed: N` — at least N % of in-scope cases have a result whose status
     is `passed`, `failed` or `blocked` (`skipped`/`not_run` are not executions).
   - `passed: N` — at least N % of in-scope cases have a `passed` result.
   - `failures: none` — no result is `failed` or `blocked`.
     `failures: triaged` — every `failed`/`blocked` result carries a `triage`
     whose `expires` (if any) is not before the evaluation date.
   - `executor: [kinds]` — every result's executor kind (`ci:…` → `ci`) is listed.
   - `build: current` — every result's `build` equals `release.build`; `any`
     (the default) checks nothing.
   - `source: automated | manual` — every result is automated (the event has
     `automation_ref`) or manual (it has none); `any` checks nothing.
5. **Verdict.** A gate is `green` when every present requirement holds, else
   `red` with one reason per failed requirement, naming the offending case ids.
   A scope that selects no case is `red` ("scope selects no cases"): a typo in
   a scope must not pass a release.
6. **Errors.** A scope that does not parse, or uses an unknown `release.*`
   variable, fails the whole evaluation with the DSL error tagged
   `field: "gates.<i>.scope"` and the policy path — never a silent red.
7. **Inputs.** The evaluator takes the resolved cases and run events of one
   project, its `ReleasePolicy`, the release ref, an optional build and the
   evaluation date. It reads no clock and no files.

## Alternatives Considered

- **Store run events with the `release:` prefix** — changes the run schema and
  every ingester for a cosmetic match; the bare name is what CI knows.
- **Declare `release.build` in a release file** — a new file format and a write
  step before every gate run; the runs already say which build they tested.
  Kept open as a later override source.
- **Count every result of a case, not only the latest** — a fixed failure would
  stay red forever, and append-only corrections would never take effect.
- **Count results across releases** — a pass on 1.1.0 says nothing about 1.2.0.
- **Empty scope is green** — vacuously true, but hides a misspelt scope.
- **`source` from the case's derived `automation.status`** — says whether a case
  *can* run automated, not whether *this* result came from automation.
- **`blocked` as not executed** — a blocked case was attempted and is not
  shippable; treating it as a failure forces a triage, which is the safe side.

## Consequences

- The loader reads `<project>/context/releases/policy.yaml`; core gains a pure
  `evaluateGates` (#10). The `gates` CLI command and the `release.*` values for
  plain `query` come with #47.
- `release.name` joins `release.build` as a documented context variable in
  `specs/query-grammar.md`.
- Expired triages turn a gate red on the day they expire, with no file change.
- Sign-off (`sign_off`) is not part of gate evaluation.
